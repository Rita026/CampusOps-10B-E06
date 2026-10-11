/** @jest-environment node */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request as httpRequest } from 'node:http';

import { SessionManager } from '../src/application/session/SessionManager';
import type { SessionCredentialStore, SessionCredentials } from '../src/domain/session/SessionCredentialStore';
import { CourseIncidentClient } from '../src/infrastructure/incidents/CourseIncidentClient';
import { CourseSessionGateway } from '../src/infrastructure/session/CourseSessionGateway';

let server: ChildProcessWithoutNullStreams;
let baseUrl: string;

// The Node environment still inherits jest-expo's fetch stub; use actual loopback HTTP.
const localTransport: typeof fetch = async (input, init) => new Promise<Response>((resolve, reject) => {
  const request = httpRequest(String(input), {
    method: init?.method,
    headers: init?.headers as Record<string, string>,
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => {
      const status = response.statusCode ?? 0;
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => JSON.parse(body) as unknown,
      } as Response);
    });
  });
  request.on('error', reject);
  init?.signal?.addEventListener('abort', () => request.destroy(new Error('aborted')), { once: true });
  request.end(init?.body as string | undefined);
});

class MemoryCredentials implements SessionCredentialStore {
  public value: SessionCredentials | null = null;

  public async save(value: SessionCredentials): Promise<void> {
    this.value = { accessToken: value.accessToken, refreshToken: value.refreshToken };
  }

  public async load(): Promise<SessionCredentials | null> {
    return this.value;
  }

  public async clear(): Promise<void> {
    this.value = null;
  }
}

function sessionClient(options: { scenario?: string; transport?: typeof fetch; clock?: { now(): number } } = {}) {
  const credentialStore = new MemoryCredentials();
  const gateway = new CourseSessionGateway({
    baseUrl,
    transport: options.transport ?? localTransport,
    ...(options.scenario === undefined ? {} : { scenario: options.scenario }),
  });
  const session = new SessionManager({
    gateway,
    credentialStore,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const client = new CourseIncidentClient({
    baseUrl,
    session,
    transport: options.transport ?? localTransport,
  });
  return { client, session, credentialStore };
}

async function directAction(
  incidentId: string,
  actorId: string,
  body: Record<string, unknown>,
  key: string,
): Promise<Response> {
  return localTransport(`${baseUrl}/v1/incidents/${encodeURIComponent(incidentId)}/actions`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer course-valid-token',
      'X-Course-Actor': actorId,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  server = spawn(process.execPath, ['course-backend/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, COURSE_BACKEND_PORT: '0' },
    stdio: 'pipe',
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local session backend did not start')), 5000);
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk: string) => {
      const address = chunk.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) {
        clearTimeout(timer);
        resolve(address);
      }
    });
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Local session backend exited: ${code}`));
    });
  });
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  server?.kill('SIGTERM');
});

test('real login restricts reporters to their incidents and logout deletes credentials', async () => {
  const transport = jest.fn(localTransport);
  const { client, session, credentialStore } = sessionClient({ transport });

  await expect(client.listIncidents()).resolves.toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  expect(transport).not.toHaveBeenCalled();
  await expect(session.login('unknown-fixture-actor')).resolves.toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
  expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', actor: null });
  expect(credentialStore.value).toBeNull();

  await expect(session.login('reporter-2')).resolves.toMatchObject({ ok: true });
  expect(session.getSnapshot()).toMatchObject({ status: 'authenticated', actor: { id: 'reporter-2', role: 'reporter' } });
  expect(credentialStore.value).toEqual({ accessToken: 'course-valid-token', refreshToken: 'course-refresh-0' });
  const created = await client.createIncident({
    category: 'water', description: 'Fuga ficticia de integración', location: 'Zona ficticia de integración',
  }, 'week06-reporter-own-create');
  expect(created).toMatchObject({ ok: true, value: { incident: { status: 'open', details: { reporterId: 'reporter-2' } } } });
  if (!created.ok) throw new Error('Expected incident creation');
  const ownList = await client.listIncidents();
  expect(ownList).toMatchObject({ ok: true });
  if (!ownList.ok) throw new Error('Expected reporter list');
  expect(ownList.value.every((incident) => incident.details?.reporterId === 'reporter-2')).toBe(true);
  await expect(client.getIncidentDetail('campus-inc-001')).resolves.toEqual({ ok: false, error: { kind: 'forbidden', status: 403 } });

  await session.login('reporter-1');
  await expect(client.getIncidentDetail(created.value.incident.id)).resolves.toEqual({ ok: false, error: { kind: 'forbidden', status: 403 } });
  await session.logout();
  expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', actor: null });
  expect(await credentialStore.load()).toBeNull();
  transport.mockClear();
  await expect(client.listIncidents()).resolves.toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  expect(transport).not.toHaveBeenCalled();
});

test('technician resolves only its current assignment while only coordination closes or reopens', async () => {
  const reporter = sessionClient();
  const technician = sessionClient();
  const otherTechnician = sessionClient();
  const coordinator = sessionClient();
  await Promise.all([
    reporter.session.login('reporter-2'), technician.session.login('technician-1'),
    otherTechnician.session.login('technician-2'), coordinator.session.login('coordinator-1'),
  ]);
  const created = await reporter.client.createIncident({
    category: 'electrical', description: 'Luz ficticia apagada', location: 'Laboratorio ficticio de roles',
  }, 'week06-role-flow-create');
  if (!created.ok) throw new Error('Expected role-flow creation');
  const id = created.value.incident.id;
  expect((await directAction(id, 'coordinator-1', { action: 'assign', baseVersion: 1, technicianId: 'technician-1' }, 'week06-role-assign')).status).toBe(201);

  await expect(otherTechnician.client.applyAction(id, { action: 'start', baseVersion: 2 }, 'week06-wrong-tech-start'))
    .resolves.toEqual({ ok: false, error: { kind: 'forbidden', status: 403 } });
  expect((await directAction(id, 'technician-2', { action: 'resolve', baseVersion: 2, diagnosis: 'Intento ficticio ajeno' }, 'week06-direct-wrong-resolve')).status).toBe(403);
  await expect(technician.client.applyAction(id, { action: 'start', baseVersion: 2 }, 'week06-role-start'))
    .resolves.toMatchObject({ ok: true, value: { incident: { status: 'in_progress', version: 3 } } });
  await expect(technician.client.applyAction(id, { action: 'resolve', baseVersion: 3, diagnosis: 'Luminaria ficticia sustituida' }, 'week06-role-resolve'))
    .resolves.toMatchObject({ ok: true, value: { incident: { status: 'resolved', version: 4 } } });

  for (const client of [reporter.client, technician.client]) {
    for (const action of ['close', 'reopen'] as const) {
      await expect(client.applyAction(id, { action, baseVersion: 4 }, `week06-client-forbidden-${action}`))
        .resolves.toEqual({ ok: false, error: { kind: 'forbidden', status: 403 } });
    }
  }
  for (const actor of ['reporter-2', 'technician-1']) {
    for (const action of ['close', 'reopen']) {
      expect((await directAction(id, actor, { action, baseVersion: 4 }, `week06-direct-${actor}-${action}`)).status).toBe(403);
    }
  }
  expect((await directAction(id, 'coordinator-1', { action: 'resolve', baseVersion: 4, diagnosis: 'Intento ficticio por coordinación' }, 'week06-coordinator-resolve-denied')).status).toBe(403);
  await expect(coordinator.client.applyAction(id, { action: 'close', baseVersion: 4 }, 'week06-role-close'))
    .resolves.toMatchObject({ ok: true, value: { incident: { status: 'closed', version: 5 } } });
  await expect(coordinator.client.applyAction(id, { action: 'reopen', baseVersion: 5 }, 'week06-role-reopen'))
    .resolves.toMatchObject({ ok: true, value: { incident: { status: 'assigned', version: 6 } } });

  expect((await directAction(id, 'coordinator-1', { action: 'assign', baseVersion: 6, technicianId: 'technician-2' }, 'week06-role-reassign')).status).toBe(201);
  await expect(technician.client.applyAction(id, { action: 'start', baseVersion: 6 }, 'week06-old-tech-denied'))
    .resolves.toEqual({ ok: false, error: { kind: 'forbidden', status: 403 } });
  const afterRejected = await coordinator.client.getIncidentDetail(id);
  expect(afterRejected).toMatchObject({ ok: true, value: { version: 7, status: 'assigned', details: { assignedTechnicianId: 'technician-2' } } });
  const technicianCreate = await technician.client.createIncident({ category: 'water', description: 'Intento ficticio', location: 'Zona ficticia' }, 'week06-tech-create-denied');
  expect(technicianCreate).toEqual({ ok: false, error: { kind: 'forbidden', status: 403 } });
  await Promise.all([reporter.session.logout(), technician.session.logout(), otherTechnician.session.logout(), coordinator.session.logout()]);
});

test('controllable expiry renews at the exact deadline against the real refresh endpoint', async () => {
  let now = 1000;
  const transport = jest.fn(localTransport);
  const { client, session, credentialStore } = sessionClient({ transport, clock: { now: () => now } });
  await session.login('reporter-1');
  const generation = session.getSnapshot().generation;
  now += 59999;
  expect(session.getSnapshot().status).toBe('authenticated');
  expect((await client.listIncidents()).ok).toBe(true);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/v1/session/refresh'))).toHaveLength(0);
  now += 1;
  expect(session.getSnapshot().status).toBe('expired');
  expect((await client.listIncidents()).ok).toBe(true);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/v1/session/refresh'))).toHaveLength(1);
  expect(session.getSnapshot()).toMatchObject({ status: 'authenticated', generation: generation + 1 });
  expect(credentialStore.value).toEqual({ accessToken: 'course-valid-token', refreshToken: 'course-refresh-1' });
  await session.logout();
  expect(credentialStore.value).toBeNull();
});

test('a technician action with a lost success response replays the same identity without applying twice', async () => {
  const reporter = sessionClient();
  const technician = sessionClient();
  await reporter.session.login('reporter-1');
  await technician.session.login('technician-1');
  const created = await reporter.client.createIncident({
    category: 'water', description: 'Reporte ficticio para respuesta perdida', location: 'Zona ficticia',
  }, 'week06-action-replay-create');
  if (!created.ok) throw new Error('Expected replay fixture creation');
  const id = created.value.incident.id;
  expect((await directAction(id, 'coordinator-1', { action: 'assign', baseVersion: 1, technicianId: 'technician-1' }, 'week06-action-replay-assign')).status).toBe(201);
  const interrupted = new CourseIncidentClient({
    baseUrl, session: technician.session, transport: localTransport, timeoutMs: 80, scenario: 'timeout_after_commit',
  });
  const action = { action: 'start' as const, baseVersion: 2 };
  const key = 'week06-stable-start-replay';
  expect(await interrupted.applyAction(id, action, key)).toEqual({ ok: false, error: { kind: 'timeout' } });
  expect(await interrupted.applyAction(id, action, key)).toMatchObject({
    ok: true, value: { duplicate: true, operationId: key, incident: { status: 'in_progress', version: 3 } },
  });
  expect(await technician.client.getIncidentDetail(id)).toMatchObject({ ok: true, value: { version: 3, status: 'in_progress' } });
  await Promise.all([reporter.session.logout(), technician.session.logout()]);
});

test('three actual concurrent 401s share one real refresh and retry each incident request once', async () => {
  let firstAttempts = 0;
  let refreshCalls = 0;
  const incidentStatuses: number[] = [];
  const transport: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/session/refresh') refreshCalls += 1;
    const incidentRequest = path.startsWith('/v1/incidents');
    let requestInit = init;
    if (incidentRequest && firstAttempts < 3) {
      firstAttempts += 1;
      requestInit = { ...init, headers: { ...init?.headers as Record<string, string>, Authorization: 'Bearer course-expired-fixture' } };
    }
    const response = await localTransport(input, requestInit);
    if (incidentRequest) incidentStatuses.push(response.status);
    return response;
  };
  const { client, session } = sessionClient({ transport });
  await session.login('reporter-1');
  const results = await Promise.all([
    client.listIncidents(), client.getIncidentDetail('campus-inc-001'),
    client.createIncident({ category: 'connectivity', description: 'Reporte ficticio concurrente', location: 'Zona ficticia concurrente' }, 'week06-concurrent-create-real'),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(refreshCalls).toBe(1);
  expect(incidentStatuses.filter((status) => status === 401)).toHaveLength(3);
  expect(incidentStatuses).toHaveLength(6);
  await session.logout();
});

test('invalid real refresh invalidates all expired requests and removes persisted credentials', async () => {
  let now = 0;
  const transport = jest.fn(localTransport);
  const { client, session, credentialStore } = sessionClient({
    scenario: 'invalid_refresh', transport, clock: { now: () => now },
  });
  await expect(session.login('reporter-1')).resolves.toMatchObject({ ok: true });
  now = 60000;
  expect(session.getSnapshot().status).toBe('expired');
  const results = await Promise.all([
    client.listIncidents(), client.getIncidentDetail('campus-inc-001'),
    client.createIncident({ category: 'water', description: 'Reporte ficticio no enviado', location: 'Zona ficticia' }, 'week06-failed-refresh-create'),
  ]);
  for (const result of results) expect(result).toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/v1/session/refresh'))).toHaveLength(1);
  expect(transport.mock.calls.filter(([url]) => String(url).includes('/v1/incidents'))).toHaveLength(0);
  expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', actor: null });
  expect(credentialStore.value).toBeNull();
  await expect(client.listIncidents()).resolves.toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/v1/session/refresh'))).toHaveLength(1);
});
