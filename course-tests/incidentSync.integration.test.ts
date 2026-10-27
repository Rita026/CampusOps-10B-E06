/** @jest-environment node */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request as httpRequest } from 'node:http';

import { SessionManager } from '../src/application/session/SessionManager';
import { createPendingWorkOperation, IncidentSyncService } from '../src/application/sync/IncidentSyncService';
import { PendingOperationQueue } from '../src/application/sync/PendingOperationQueue';
import type { CloudIncident } from '../src/domain/incidents/CloudIncident';
import type { SessionCredentialStore, SessionCredentials } from '../src/domain/session/SessionCredentialStore';
import type { PendingOperation } from '../src/domain/sync/PendingOperation';
import { CourseIncidentClient } from '../src/infrastructure/incidents/CourseIncidentClient';
import { CourseSessionGateway } from '../src/infrastructure/session/CourseSessionGateway';
import { JsonPendingOperationStore } from '../src/infrastructure/sync/JsonPendingOperationStore';

type RemoteIncident = Readonly<{
  id: string;
  version: number;
  status: string;
  payload: Readonly<{
    assignedTechnicianId: string | null;
    priority: string;
    history: readonly Readonly<{ operationId: string; actorId: string; action: string; version: number }>[];
  }>;
}>;

let server: ChildProcessWithoutNullStreams;
let baseUrl: string;
let sequence = 0;

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
      resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) as unknown } as Response);
    });
  });
  request.on('error', reject);
  init?.signal?.addEventListener('abort', () => request.destroy(new Error('aborted')), { once: true });
  request.end(init?.body as string | undefined);
});

class MemoryCredentials implements SessionCredentialStore {
  private value: SessionCredentials | null = null;

  public async save(value: SessionCredentials): Promise<void> {
    this.value = value;
  }

  public async load(): Promise<SessionCredentials | null> {
    return this.value;
  }

  public async clear(): Promise<void> {
    this.value = null;
  }
}

async function call(method: 'GET' | 'POST', path: string, actorId: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': actorId };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = `fixture-${actorId}-${++sequence}`;
  }
  const response = await localTransport(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

/** Reporter creates an incident and coordination assigns it to technician-1. */
async function assignedIncident(): Promise<string> {
  const created = await call('POST', '/v1/incidents', 'reporter-1', {
    category: 'equipment', description: 'Proyector ficticio sin imagen', location: 'Aula de prueba 3',
  });
  expect(created.status).toBe(201);
  const id = (created.body as { incident: { id: string } }).incident.id;
  await coordinatorAction(id, { action: 'assign', technicianId: 'technician-1' });
  return id;
}

async function remoteIncident(id: string): Promise<RemoteIncident> {
  const response = await call('GET', `/v1/incidents/${id}`, 'coordinator-1');
  expect(response.status).toBe(200);
  return response.body as RemoteIncident;
}

async function coordinatorAction(id: string, body: Record<string, unknown>): Promise<RemoteIncident> {
  const { version } = await remoteIncident(id);
  const response = await call('POST', `/v1/incidents/${id}/actions`, 'coordinator-1', { ...body, baseVersion: version });
  expect(response.status).toBe(201);
  return (response.body as { incident: RemoteIncident }).incident;
}

async function technician(options: { scenario?: 'timeout_after_commit' | 'server_error'; timeoutMs?: number } = {}) {
  const session = new SessionManager({
    gateway: new CourseSessionGateway({ baseUrl, transport: localTransport }),
    credentialStore: new MemoryCredentials(),
  });
  expect(await session.login('technician-1')).toMatchObject({ ok: true });
  const client = new CourseIncidentClient({ baseUrl, session, transport: localTransport, ...options });
  return { session, client };
}

/** Each call is a fresh app start reading the same persisted storage. */
function restart(memory: Map<string, string>, client: CourseIncidentClient, session: SessionManager) {
  const queue = new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
  const sync = new IncidentSyncService({
    queue,
    client,
    currentActorId: () => session.getSnapshot().actor?.id ?? null,
  });
  return { queue, sync };
}

async function offlineStart(id: string, memory: Map<string, string>): Promise<PendingOperation> {
  const { session, client } = await technician();
  const detail = await client.getIncidentDetail(id);
  expect(detail.ok).toBe(true);
  if (!detail.ok) throw new Error('detail');
  // From here on the device is offline: the intent is only persisted locally.
  const operation = createPendingWorkOperation({
    actor: { id: 'technician-1', role: 'technician' },
    incident: detail.value,
    action: 'start',
    operationId: `op-start-${id}-technician-1`,
    createdAt: '2026-10-22T12:00:00.000Z',
  });
  expect(operation).not.toBeNull();
  if (operation === null) throw new Error('operation');
  await restart(memory, client, session).queue.enqueue(operation);
  return operation;
}

function starts(incident: RemoteIncident): readonly RemoteIncident['payload']['history'][number][] {
  return incident.payload.history.filter((entry) => entry.action === 'start');
}

beforeAll(async () => {
  server = spawn(process.execPath, ['course-backend/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, COURSE_BACKEND_PORT: '0' },
    stdio: 'pipe',
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local sync backend did not start')), 5000);
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
  });
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  server?.kill('SIGTERM');
});

test('offline start versus remote reassignment is a conflict that keeps the queue and the new assignment', async () => {
  const memory = new Map<string, string>();
  const id = await assignedIncident();
  const operation = await offlineStart(id, memory);
  const reassigned = await coordinatorAction(id, { action: 'assign', technicianId: 'technician-2' });

  const { session, client } = await technician();
  const first = restart(memory, client, session);
  expect(await first.sync.synchronize()).toEqual([{ kind: 'conflict', operationId: operation.operationId, fields: ['work'] }]);

  // Another restart and sync: the intent is still there with the same identity and content.
  const second = restart(memory, client, session);
  expect(await second.queue.list()).toEqual([operation]);
  expect(await second.sync.synchronize()).toEqual([{ kind: 'conflict', operationId: operation.operationId, fields: ['work'] }]);
  expect(await second.queue.list()).toEqual([operation]);

  // The old assignment was not imposed and the remote record did not change.
  const remote = await remoteIncident(id);
  expect(remote).toMatchObject({ version: reassigned.version, status: 'assigned', payload: { assignedTechnicianId: 'technician-2' } });
  expect(starts(remote)).toHaveLength(0);
});

test('when coordination assigns the incident back, the same operation is rebased and applied once', async () => {
  const memory = new Map<string, string>();
  const id = await assignedIncident();
  const operation = await offlineStart(id, memory);
  await coordinatorAction(id, { action: 'assign', technicianId: 'technician-2' });
  const { session, client } = await technician();
  expect(await restart(memory, client, session).sync.synchronize()).toMatchObject([{ kind: 'conflict' }]);

  const back = await coordinatorAction(id, { action: 'assign', technicianId: 'technician-1' });
  const { queue, sync } = restart(memory, client, session);
  const outcomes = await sync.synchronize();
  expect(outcomes).toMatchObject([{ kind: 'confirmed', operationId: operation.operationId, duplicate: false }]);
  expect(await queue.list()).toEqual([]);

  const remote = await remoteIncident(id);
  expect(remote).toMatchObject({ version: back.version + 1, status: 'in_progress', payload: { assignedTechnicianId: 'technician-1' } });
  expect(starts(remote)).toEqual([{ operationId: operation.operationId, actorId: 'technician-1', action: 'start', version: back.version + 1 }]);
});

test('an independent remote change (priority) is combined with the offline start', async () => {
  const memory = new Map<string, string>();
  const id = await assignedIncident();
  const operation = await offlineStart(id, memory);
  await coordinatorAction(id, { action: 'prioritize', priority: 'high' });

  const { session, client } = await technician();
  const { queue, sync } = restart(memory, client, session);
  expect(await sync.synchronize()).toMatchObject([{ kind: 'confirmed', operationId: operation.operationId }]);
  expect(await queue.list()).toEqual([]);
  expect(await remoteIncident(id)).toMatchObject({ status: 'in_progress', payload: { priority: 'high', assignedTechnicianId: 'technician-1' } });
});

test('a lost confirmation keeps the operation; the replay with the same identity has a single effect', async () => {
  const memory = new Map<string, string>();
  const id = await assignedIncident();
  const operation = await offlineStart(id, memory);

  const lost = await technician({ scenario: 'timeout_after_commit', timeoutMs: 300 });
  const firstTry = restart(memory, lost.client, lost.session);
  expect(await firstTry.sync.synchronize()).toEqual([{ kind: 'pending', operationId: operation.operationId, reason: 'timeout' }]);
  expect(await firstTry.queue.list()).toEqual([operation]);
  expect(starts(await remoteIncident(id))).toHaveLength(1);

  const { session, client } = await technician();
  const replay = restart(memory, client, session);
  expect(await replay.sync.synchronize()).toMatchObject([{ kind: 'confirmed', operationId: operation.operationId, duplicate: true }]);
  expect(await replay.queue.list()).toEqual([]);
  expect(starts(await remoteIncident(id))).toEqual([expect.objectContaining({ operationId: operation.operationId })]);
});

test('a failed send keeps every operation, and later operations on that incident wait for the first one', async () => {
  const memory = new Map<string, string>();
  const id = await assignedIncident();
  const start = await offlineStart(id, memory);
  const { session, client } = await technician();
  const detail = await client.getIncidentDetail(id);
  if (!detail.ok) throw new Error('detail');
  const locallyStarted: CloudIncident = { ...detail.value, status: 'in_progress' };
  const resolve = createPendingWorkOperation({
    actor: { id: 'technician-1', role: 'technician' },
    incident: locallyStarted,
    action: 'resolve',
    operationId: `op-resolve-${id}-technician-1`,
    createdAt: '2026-10-22T12:05:00.000Z',
    diagnosis: 'Cable HDMI ficticio reemplazado',
  });
  if (resolve === null) throw new Error('resolve');
  await restart(memory, client, session).queue.enqueue(resolve);

  const failing = await technician({ scenario: 'server_error' });
  expect(await restart(memory, failing.client, failing.session).sync.synchronize()).toEqual([
    { kind: 'pending', operationId: start.operationId, reason: 'server' },
    { kind: 'pending', operationId: resolve.operationId, reason: 'waiting_previous' },
  ]);
  expect(await restart(memory, client, session).queue.list()).toEqual([start, resolve]);

  const { queue, sync } = restart(memory, client, session);
  expect(await sync.synchronize()).toMatchObject([
    { kind: 'confirmed', operationId: start.operationId },
    { kind: 'confirmed', operationId: resolve.operationId },
  ]);
  expect(await queue.list()).toEqual([]);
  expect(await remoteIncident(id)).toMatchObject({ status: 'resolved' });
});

test('operations of another actor are never sent with the current session', async () => {
  const memory = new Map<string, string>();
  const id = await assignedIncident();
  const operation = await offlineStart(id, memory);
  const session = new SessionManager({
    gateway: new CourseSessionGateway({ baseUrl, transport: localTransport }),
    credentialStore: new MemoryCredentials(),
  });
  expect(await session.login('technician-2')).toMatchObject({ ok: true });
  const transport = jest.fn(localTransport);
  const client = new CourseIncidentClient({ baseUrl, session, transport });
  const { queue, sync } = restart(memory, client, session);

  expect(await sync.synchronize()).toEqual([]);
  expect(transport).not.toHaveBeenCalled();
  expect(await queue.list()).toEqual([operation]);
  await session.logout();
  expect(await restart(memory, client, session).sync.synchronize()).toEqual([]);
});

test('offline intents are only created for the assigned technician and an allowed transition', async () => {
  const id = await assignedIncident();
  const { client } = await technician();
  const detail = await client.getIncidentDetail(id);
  if (!detail.ok) throw new Error('detail');
  const common = { incident: detail.value, operationId: 'op-invalid-0001', createdAt: '2026-10-22T12:00:00.000Z' };
  expect(createPendingWorkOperation({ ...common, actor: { id: 'technician-2', role: 'technician' }, action: 'start' })).toBeNull();
  expect(createPendingWorkOperation({ ...common, actor: { id: 'coordinator-1', role: 'coordinator' }, action: 'start' })).toBeNull();
  expect(createPendingWorkOperation({ ...common, actor: { id: 'technician-1', role: 'technician' }, action: 'resolve', diagnosis: 'x' })).toBeNull();
  expect(createPendingWorkOperation({
    ...common,
    incident: { ...detail.value, status: 'in_progress' },
    actor: { id: 'technician-1', role: 'technician' },
    action: 'resolve',
    diagnosis: '   ',
  })).toBeNull();
});

test('when the remote record is still readable, resolveSync over work declares the reassignment conflict', async () => {
  const memory = new Map<string, string>();
  const base: CloudIncident = {
    id: 'campus-inc-001', version: 1, status: 'assigned',
    details: { category: 'connectivity', description: 'Falla ficticia', location: 'Zona ficticia',
      reporterId: 'reporter-1', assignedTechnicianId: 'technician-1', priority: 'medium' },
  };
  const operation = createPendingWorkOperation({
    actor: { id: 'technician-1', role: 'technician' }, incident: base, action: 'start',
    operationId: 'op-start-campus-inc-001', createdAt: '2026-10-22T12:00:00.000Z',
  });
  if (operation === null) throw new Error('operation');
  const remote: CloudIncident = { ...base, version: 2, details: { ...base.details!, assignedTechnicianId: 'technician-2' } };
  const applyAction = jest.fn();
  const client = {
    listIncidents: jest.fn(),
    createIncident: jest.fn(),
    getIncidentDetail: jest.fn(async () => ({ ok: true as const, value: remote })),
    applyAction,
  };
  const queue = new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
  await queue.enqueue(operation);
  const sync = new IncidentSyncService({ queue, client, currentActorId: () => 'technician-1' });

  expect(await sync.synchronize()).toEqual([{ kind: 'conflict', operationId: operation.operationId, fields: ['work'] }]);
  expect(applyAction).not.toHaveBeenCalled();
  expect(await queue.list()).toEqual([operation]);
});
