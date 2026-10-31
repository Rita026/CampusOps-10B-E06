/** @jest-environment node */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request as httpRequest } from 'node:http';

import { classifyIncidentResult, runWithRetry, type RetryAttempt } from '../src/application/resilience/runWithRetry';
import { SessionManager } from '../src/application/session/SessionManager';
import { createPendingWorkOperation, IncidentSyncService } from '../src/application/sync/IncidentSyncService';
import { PendingOperationQueue } from '../src/application/sync/PendingOperationQueue';
import type { SessionCredentialStore, SessionCredentials } from '../src/domain/session/SessionCredentialStore';
import { CourseIncidentClient } from '../src/infrastructure/incidents/CourseIncidentClient';
import { CourseSessionGateway } from '../src/infrastructure/session/CourseSessionGateway';
import { JsonPendingOperationStore } from '../src/infrastructure/sync/JsonPendingOperationStore';

/**
 * Week 9: a resolution or close that the server stores although its response is lost
 * (scenario timeout_after_commit), and bounded retries against 429 and 500. Everything
 * runs against the local course backend with synthetic data.
 */

type Scenario = 'success' | 'timeout_after_commit' | 'rate_limited' | 'server_error';
type HistoryEntry = Readonly<{ operationId: string; actorId: string; action: string; version: number }>;
type RemoteIncident = Readonly<{
  id: string;
  version: number;
  status: string;
  payload: Readonly<{ diagnosis?: string; history: readonly HistoryEntry[] }>;
}>;

let server: ChildProcessWithoutNullStreams;
let baseUrl: string;
let sequence = 0;
/** "METHOD /path" of every request the app clients send, to count them per scenario. */
let sent: string[] = [];

// Loopback HTTP (jest-expo stubs fetch). Exposes headers so the client can read Retry-After.
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
      const header = (name: string) => {
        const value = response.headers[name.toLowerCase()];
        return typeof value === 'string' ? value : null;
      };
      resolve({ ok: status >= 200 && status < 300, status, headers: { get: header }, json: async () => JSON.parse(body) as unknown } as unknown as Response);
    });
  });
  request.on('error', reject);
  init?.signal?.addEventListener('abort', () => request.destroy(new Error('aborted')), { once: true });
  request.end(init?.body as string | undefined);
});

const countingTransport: typeof fetch = async (input, init) => {
  sent.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
  return localTransport(input, init);
};

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

/** Fixture call outside the app clients (not counted). */
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

async function remoteIncident(id: string): Promise<RemoteIncident> {
  const response = await call('GET', `/v1/incidents/${id}`, 'coordinator-1');
  expect(response.status).toBe(200);
  return response.body as RemoteIncident;
}

async function act(id: string, actorId: string, body: Record<string, unknown>): Promise<void> {
  const { version } = await remoteIncident(id);
  const response = await call('POST', `/v1/incidents/${id}/actions`, actorId, { ...body, baseVersion: version });
  expect(response.status).toBe(201);
}

/** Created by reporter-1, assigned to technician-1 and started: ready to resolve. */
async function inProgressIncident(): Promise<string> {
  const created = await call('POST', '/v1/incidents', 'reporter-1', {
    category: 'equipment', description: 'Proyector ficticio sin imagen', location: 'Aula de prueba 3',
  });
  expect(created.status).toBe(201);
  const id = (created.body as { incident: { id: string } }).incident.id;
  await act(id, 'coordinator-1', { action: 'assign', technicianId: 'technician-1' });
  await act(id, 'technician-1', { action: 'start' });
  return id;
}

async function incidentCount(): Promise<number> {
  const response = await call('GET', '/v1/incidents', 'coordinator-1');
  return (response.body as { items: unknown[] }).items.length;
}

async function clientFor(actorId: string, scenario: Scenario = 'success', timeoutMs = 300) {
  const session = new SessionManager({
    gateway: new CourseSessionGateway({ baseUrl, transport: localTransport }),
    credentialStore: new MemoryCredentials(),
  });
  expect(await session.login(actorId)).toMatchObject({ ok: true });
  const client = new CourseIncidentClient({ baseUrl, session, transport: countingTransport, scenario, timeoutMs });
  return { session, client };
}

function actions(incident: RemoteIncident, action: string): readonly HistoryEntry[] {
  return incident.payload.history.filter((entry) => entry.action === action);
}

/** Records the waits instead of sleeping, so the test observes them without slowing down. */
function recorder() {
  const delays: number[] = [];
  const attempts: RetryAttempt[] = [];
  return {
    delays,
    attempts,
    options: { sleep: async (ms: number) => { delays.push(ms); }, onAttempt: (attempt: RetryAttempt) => attempts.push(attempt) },
  };
}

const posts = () => sent.filter((entry) => entry.startsWith('POST'));

beforeAll(async () => {
  server = spawn(process.execPath, ['course-backend/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, COURSE_BACKEND_PORT: '0' },
    stdio: 'pipe',
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local backend did not start')), 5000);
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
  sent = [];
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  server?.kill('SIGTERM');
});

test('lost resolution: the week 8 queue resends the same key and body once and the history has a single resolve', async () => {
  const id = await inProgressIncident();
  const technician = await clientFor('technician-1', 'timeout_after_commit');
  const detail = await technician.client.getIncidentDetail(id);
  if (!detail.ok) throw new Error('detail');
  const operation = createPendingWorkOperation({
    actor: { id: 'technician-1', role: 'technician' },
    incident: detail.value,
    action: 'resolve',
    operationId: `op-resolve-${id}-technician-1`,
    createdAt: '2026-10-30T12:00:00.000Z',
    diagnosis: 'Cable HDMI ficticio reemplazado',
  });
  if (operation === null) throw new Error('operation');
  const memory = new Map<string, string>();
  const queue = new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
  await queue.enqueue(operation);

  const retry = recorder();
  const sync = new IncidentSyncService({
    queue,
    client: technician.client,
    currentActorId: () => technician.session.getSnapshot().actor?.id ?? null,
    retry: retry.options,
  });
  sent = [];
  const outcomes = await sync.synchronize();

  // Attempt 1: the server stores the resolution but the client aborts at 300 ms.
  // Attempt 2: same key and body, the backend answers 200 duplicate without a new effect.
  expect(retry.attempts.map((item) => [item.attempt, item.outcome, item.delayMs])).toEqual([[1, 'timeout', 500], [2, 'ok', 0]]);
  expect(retry.attempts[0]?.durationMs ?? 0).toBeGreaterThanOrEqual(290);
  expect(retry.delays).toEqual([500]);
  expect(posts()).toEqual([`POST /v1/incidents/${id}/actions`, `POST /v1/incidents/${id}/actions`]);
  expect(outcomes).toMatchObject([{ kind: 'confirmed', operationId: operation.operationId, duplicate: true }]);
  expect(await queue.list()).toEqual([]);

  const remote = await remoteIncident(id);
  expect(remote).toMatchObject({ status: 'resolved', version: detail.value.version + 1, payload: { diagnosis: 'Cable HDMI ficticio reemplazado' } });
  expect(actions(remote, 'resolve')).toEqual([expect.objectContaining({ operationId: operation.operationId, actorId: 'technician-1' })]);
});

test('lost close: the retry with the same key is a duplicate, and the same key with another body is rejected without retrying', async () => {
  const id = await inProgressIncident();
  await act(id, 'technician-1', { action: 'resolve', diagnosis: 'Diagnóstico ficticio' });
  const { version } = await remoteIncident(id);
  const coordinator = await clientFor('coordinator-1', 'timeout_after_commit');
  const key = `op-close-${id}-coordinator-1`;
  const close = { action: 'close', baseVersion: version } as const;

  const retry = recorder();
  sent = [];
  const { result, attempts } = await runWithRetry({
    method: 'POST',
    idempotencyKey: key,
    send: () => coordinator.client.applyAction(id, close, key),
    classify: classifyIncidentResult,
  }, retry.options);
  expect(attempts.map((item) => item.outcome)).toEqual(['timeout', 'ok']);
  expect(result).toMatchObject({ ok: true, value: { operationId: key, duplicate: true, incident: { status: 'closed', version: version + 1 } } });
  expect(posts()).toHaveLength(2);

  // Reusing the key with different content is a client error (409): it is final, not retried.
  const other = recorder();
  sent = [];
  const reused = await runWithRetry({
    method: 'POST',
    idempotencyKey: key,
    send: () => coordinator.client.applyAction(id, { action: 'close', baseVersion: version + 1 }, key),
    classify: classifyIncidentResult,
  }, other.options);
  expect(reused.result).toEqual({ ok: false, error: { kind: 'conflict', status: 409 } });
  expect(reused.attempts).toHaveLength(1);
  expect(posts()).toHaveLength(1);

  const remote = await remoteIncident(id);
  expect(remote).toMatchObject({ status: 'closed', version: version + 1 });
  expect(actions(remote, 'close')).toEqual([expect.objectContaining({ operationId: key })]);
});

test('429 with Retry-After: the POST is sent 4 times at most, waits what the server asks and creates nothing', async () => {
  const reporter = await clientFor('reporter-1', 'rate_limited');
  const before = await incidentCount();
  const key = 'op-create-rate-limited-1';
  const retry = recorder();
  sent = [];
  const { result, attempts } = await runWithRetry({
    method: 'POST',
    idempotencyKey: key,
    send: () => reporter.client.createIncident({ category: 'water', description: 'Fuga ficticia', location: 'Baño de prueba' }, key),
    classify: classifyIncidentResult,
  }, retry.options);

  expect(result).toEqual({ ok: false, error: { kind: 'rate_limited', status: 429, retryAfterMs: 1000 } });
  expect(posts()).toHaveLength(4);
  expect(retry.delays).toEqual([1000, 1000, 1000]);
  expect(attempts.map((item) => item.outcome)).toEqual([429, 429, 429, 429]);
  expect(await incidentCount()).toBe(before);
});

test('500: progressive backoff, 4 POSTs at most, and the operation is reported as failed', async () => {
  const reporter = await clientFor('reporter-1', 'server_error');
  const key = 'op-create-server-error-1';
  const retry = recorder();
  sent = [];
  const { result } = await runWithRetry({
    method: 'POST',
    idempotencyKey: key,
    send: () => reporter.client.createIncident({ category: 'water', description: 'Fuga ficticia', location: 'Baño de prueba' }, key),
    classify: classifyIncidentResult,
  }, retry.options);

  expect(result).toEqual({ ok: false, error: { kind: 'server', status: 500 } });
  expect(posts()).toHaveLength(4);
  expect(retry.delays).toEqual([500, 1000, 2000]);
});

test('with the real clock the client waits the Retry-After before the next request', async () => {
  const reporter = await clientFor('reporter-1', 'rate_limited');
  const key = 'op-create-real-wait-1';
  const startedAt = Date.now();
  sent = [];
  const { attempts } = await runWithRetry({
    method: 'POST',
    idempotencyKey: key,
    send: () => reporter.client.createIncident({ category: 'water', description: 'Fuga ficticia', location: 'Baño de prueba' }, key),
    classify: classifyIncidentResult,
  }, { policy: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 4000, maxRetryAfterMs: 10_000 } });
  const elapsed = Date.now() - startedAt;

  expect(attempts.map((item) => [item.outcome, item.delayMs])).toEqual([[429, 1000], [429, 0]]);
  expect(posts()).toHaveLength(2);
  expect(elapsed).toBeGreaterThanOrEqual(1000);
  expect(elapsed).toBeLessThan(5000);
});
