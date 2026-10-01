/** @jest-environment node */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request as httpRequest } from 'node:http';

import { CourseIncidentClient } from '../src/infrastructure/incidents/CourseIncidentClient';

let server: ChildProcessWithoutNullStreams;
let baseUrl: string;

// jest-expo supplies a fetch stub even in a Node test; this adapter uses loopback HTTP.
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

beforeAll(async () => {
  server = spawn(process.execPath, ['course-backend/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, COURSE_BACKEND_PORT: '0' },
    stdio: 'pipe',
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    const startupTimer = setTimeout(() => reject(new Error('Local backend did not start')), 5000);
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk: string) => {
      const match = chunk.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match?.[0]) {
        clearTimeout(startupTimer);
        resolve(match[0]);
      }
    });
    server.once('exit', (code) => {
      clearTimeout(startupTimer);
      reject(new Error(`Local backend exited: ${code}`));
    });
  });
});

afterAll(() => {
  server?.kill('SIGTERM');
});

test('list, detail, create and idempotent replay use the real local backend', async () => {
  const client = new CourseIncidentClient({ baseUrl, actorId: 'reporter-1', transport: localTransport });
  const initial = await client.listIncidents();
  expect(initial).toMatchObject({ ok: true, value: [{ id: 'campus-inc-001', status: 'assigned' }] });
  if (!initial.ok) return;
  expect(initial.value[0]?.details?.category).toBe('connectivity');

  const detail = await client.getIncidentDetail('campus-inc-001');
  expect(detail).toMatchObject({ ok: true, value: { id: 'campus-inc-001', version: 1 } });

  const input = { category: 'electrical' as const, description: 'Luz de prueba apagada', location: 'Edificio ficticio B' };
  const created = await client.createIncident(input, 'week05-create-001');
  expect(created).toMatchObject({
    ok: true,
    value: { operationId: 'week05-create-001', duplicate: false, incident: { status: 'open', details: input } },
  });
  if (!created.ok) return;

  const replay = await client.createIncident(input, 'week05-create-001');
  expect(replay).toMatchObject({
    ok: true,
    value: { duplicate: true, incident: { id: created.value.incident.id } },
  });
  const after = await client.listIncidents();
  expect(after.ok && after.value).toHaveLength(2);
});

test('nullable is valid absence while malformed, timeout and 500 are distinct', async () => {
  const nullable = new CourseIncidentClient({ baseUrl, scenario: 'nullable', transport: localTransport });
  const list = await nullable.listIncidents();
  expect(list.ok).toBe(true);
  if (list.ok) expect(list.value[0]?.details).toBeNull();
  expect(await nullable.getIncidentDetail('campus-inc-001')).toMatchObject({
    ok: true, value: { details: null },
  });

  expect(await new CourseIncidentClient({ baseUrl, scenario: 'malformed', transport: localTransport }).listIncidents())
    .toEqual({ ok: false, error: { kind: 'contract' } });
  expect(await new CourseIncidentClient({ baseUrl, scenario: 'server_error', transport: localTransport }).listIncidents())
    .toEqual({ ok: false, error: { kind: 'server', status: 500 } });
  expect(await new CourseIncidentClient({ baseUrl, scenario: 'slow', timeoutMs: 80, transport: localTransport }).listIncidents())
    .toEqual({ ok: false, error: { kind: 'timeout' } });
});

test('a timed-out POST can be replayed with its original key without creating twice', async () => {
  const input = { category: 'water' as const, description: 'Fuga simulada', location: 'Patio ficticio' };
  const key = 'week05-timeout-after-commit';
  const interrupted = new CourseIncidentClient({
    baseUrl, scenario: 'timeout_after_commit', timeoutMs: 80, transport: localTransport,
  });
  expect(await interrupted.createIncident(input, key)).toEqual({ ok: false, error: { kind: 'timeout' } });

  const normal = new CourseIncidentClient({ baseUrl, transport: localTransport });
  const replay = await normal.createIncident(input, key);
  expect(replay).toMatchObject({ ok: true, value: { duplicate: true, operationId: key } });
  if (!replay.ok) return;

  const list = await normal.listIncidents();
  expect(list.ok && list.value.filter((item) => item.id === replay.value.incident.id)).toHaveLength(1);
});
