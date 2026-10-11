import type { SessionCredentials, SessionCredentialStore } from '../src/domain/session/SessionCredentialStore';
import { SessionManager } from '../src/application/session/SessionManager';
import { CourseSessionGateway } from '../src/infrastructure/session/CourseSessionGateway';
import { CourseIncidentClient } from '../src/infrastructure/incidents/CourseIncidentClient';

const dto = {
  id: 'campus-inc-001', version: 1, status: 'assigned',
  payload: { category: 'connectivity', description: 'Falla ficticia', location: 'Zona ficticia',
    reporterId: 'reporter-1', assignedTechnicianId: 'technician-1', priority: 'medium' },
};
const input = { category: 'water' as const, description: 'Fuga ficticia', location: 'Zona ficticia' };
const key = 'week06-create-single-flight';

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(options: { refreshFails?: boolean; retry401?: boolean; delayed401?: boolean; delayedRefresh?: boolean } = {}) {
  let saved: SessionCredentials | null = null;
  let time = 0;
  const store: SessionCredentialStore = {
    save: jest.fn(async (credentials) => { saved = credentials; }),
    clear: jest.fn(async () => { saved = null; }),
    load: jest.fn(async () => saved),
  };
  const late401 = deferred<Response>();
  const lateRefresh = deferred<Response>();
  const counts = { refresh: 0, unauthorized: 0, attempts: 0 };
  const transport = jest.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(url);
    if (path.endsWith('/login')) {
      return response({ actorId: 'reporter-1', role: 'reporter', accessToken: 'synthetic-old-access',
        refreshToken: 'synthetic-refresh', expiresIn: 60 });
    }
    if (path.endsWith('/refresh')) {
      counts.refresh += 1;
      if (options.delayedRefresh) return lateRefresh.promise;
      return options.refreshFails ? response({}, 401)
        : response({ accessToken: 'synthetic-new-access', refreshToken: 'synthetic-next-refresh', expiresIn: 60 });
    }
    counts.attempts += 1;
    const headers = init?.headers as Record<string, string>;
    if (headers.Authorization === 'Bearer synthetic-old-access' || options.retry401) {
      counts.unauthorized += 1;
      if (options.delayed401 && path.endsWith('/campus-inc-001')) return late401.promise;
      return response({}, 401);
    }
    if (init?.method === 'POST') return response({ incident: { ...dto, status: 'open' }, operationId: key, duplicate: false }, 201);
    return path.endsWith('/campus-inc-001') ? response(dto) : response({ items: [dto] });
  });
  const session = new SessionManager({
    gateway: new CourseSessionGateway({ baseUrl: 'http://fixture', transport: transport as typeof fetch }),
    credentialStore: store, clock: { now: () => time },
  });
  const client = new CourseIncidentClient({ baseUrl: 'http://fixture', transport: transport as typeof fetch, session });
  return { session, client, transport, counts, store, late401, lateRefresh,
    advance: (ms: number) => { time += ms; }, saved: () => saved };
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

test('three actual incident requests share one refresh after 401 and each retries once with the same POST identity', async () => {
  const fixture = setup();
  expect(await fixture.session.login('reporter-1')).toMatchObject({ ok: true });
  const results = await Promise.all([
    fixture.client.listIncidents(), fixture.client.getIncidentDetail(dto.id), fixture.client.createIncident(input, key),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(fixture.counts).toEqual({ refresh: 1, unauthorized: 3, attempts: 6 });
  const creates = fixture.transport.mock.calls.filter(([, init]) => init?.method === 'POST'
    && (init.headers as Record<string, string>)['Idempotency-Key'] === key);
  expect(creates).toHaveLength(2);
  expect(creates[0]?.[1]?.body).toBe(creates[1]?.[1]?.body);
  expect(JSON.stringify((console.log as jest.Mock).mock.calls)).not.toMatch(/synthetic-(old|new|next|refresh)/);
});

test('a late 401 for old credentials uses the already refreshed generation without another refresh', async () => {
  const fixture = setup({ delayed401: true });
  await fixture.session.login('reporter-1');
  const detail = fixture.client.getIncidentDetail(dto.id);
  expect((await fixture.client.listIncidents()).ok).toBe(true);
  fixture.late401.resolve(response({}, 401));
  expect((await detail).ok).toBe(true);
  expect(fixture.counts).toEqual({ refresh: 1, unauthorized: 2, attempts: 4 });
});

test('controlled clock expires session at 60000ms and concurrent requests renew once before dispatch', async () => {
  const fixture = setup();
  await fixture.session.login('reporter-1');
  fixture.advance(60_000);
  const results = await Promise.all([fixture.client.listIncidents(), fixture.client.getIncidentDetail(dto.id)]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(fixture.counts).toEqual({ refresh: 1, unauthorized: 0, attempts: 2 });
});

test('failed shared refresh terminates all three operations and erases persisted credentials', async () => {
  const fixture = setup({ refreshFails: true });
  await fixture.session.login('reporter-1');
  const results = await Promise.all([
    fixture.client.listIncidents(), fixture.client.getIncidentDetail(dto.id), fixture.client.createIncident(input, key),
  ]);
  expect(results).toEqual(Array(3).fill({ ok: false, error: { kind: 'unauthorized', status: 401 } }));
  expect(fixture.counts).toEqual({ refresh: 1, unauthorized: 3, attempts: 3 });
  expect(fixture.session.getSnapshot()).toMatchObject({ status: 'anonymous', actor: null });
  expect(fixture.saved()).toBeNull();
});

test('a second 401 stops after one retry and one refresh, clearing session instead of looping', async () => {
  const fixture = setup({ retry401: true });
  await fixture.session.login('reporter-1');
  expect(await fixture.client.listIncidents()).toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  expect(fixture.counts).toEqual({ refresh: 1, unauthorized: 2, attempts: 2 });
  expect(fixture.saved()).toBeNull();
});

test('logout while refresh is pending prevents retries and discards a late successful response', async () => {
  const fixture = setup({ delayedRefresh: true });
  await fixture.session.login('reporter-1');
  const pending = fixture.client.listIncidents();
  // Drain promise jobs without depending on elapsed time or timers.
  for (let job = 0; job < 20 && fixture.counts.refresh === 0; job += 1) await Promise.resolve();
  expect(fixture.counts.refresh).toBe(1);
  await fixture.session.logout();
  fixture.lateRefresh.resolve(response({ accessToken: 'synthetic-new-access', refreshToken: 'synthetic-next-refresh', expiresIn: 60 }));
  expect(await pending).toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  expect(fixture.counts.attempts).toBe(1);
  expect(fixture.saved()).toBeNull();
  expect(fixture.session.getSnapshot()).toMatchObject({ status: 'anonymous', actor: null });
});

test('without login and after logout the client dispatches no incident request', async () => {
  const fixture = setup();
  expect(await fixture.client.listIncidents()).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
  await fixture.session.login('reporter-1');
  await fixture.session.logout();
  expect(await fixture.client.createIncident(input, key)).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
  expect(fixture.counts.attempts).toBe(0);
  expect(fixture.saved()).toBeNull();
});

test('logout in the credential-await window prevents a POST from being dispatched with old credentials', async () => {
  const fixture = setup();
  await fixture.session.login('reporter-1');
  const pendingCreate = fixture.client.createIncident(input, key);
  const closing = fixture.session.logout();
  expect(await pendingCreate).toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  await closing;
  expect(fixture.counts.attempts).toBe(0);
  expect(fixture.saved()).toBeNull();
});
