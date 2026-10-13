import { SessionManager } from '../src/application/session/SessionManager';
import type {
  IssuedSession, LoginSession, SessionGateway, SessionResult,
} from '../src/application/session/SessionAccess';
import type { SessionCredentialStore, SessionCredentials } from '../src/domain/session/SessionCredentialStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfilled, failed) => { resolve = fulfilled; reject = failed; });
  return { promise, resolve, reject };
}

function success<T>(value: T): SessionResult<T> { return { ok: true, value }; }
function loginTokens(actorId = 'technician-1'): LoginSession {
  return { actor: { id: actorId, role: actorId === 'coordinator-1' ? 'coordinator' : 'technician' },
    accessToken: 'synthetic-access-0', refreshToken: 'synthetic-refresh-0', expiresIn: 60 };
}
const renewedTokens: IssuedSession = {
  accessToken: 'synthetic-access-1', refreshToken: 'synthetic-refresh-1', expiresIn: 60,
};

class MemoryCredentials implements SessionCredentialStore {
  public value: SessionCredentials | null = null;
  public save = jest.fn(async (credentials: SessionCredentials): Promise<void> => { this.value = credentials; });
  public load = jest.fn(async (): Promise<SessionCredentials | null> => this.value);
  public clear = jest.fn(async (): Promise<void> => { this.value = null; });
}

function setup() {
  let now = 1000;
  const store = new MemoryCredentials();
  const gateway: SessionGateway = {
    login: jest.fn(async (actorId: string) => success(loginTokens(actorId))),
    refresh: jest.fn(async () => success(renewedTokens)),
  };
  const session = new SessionManager({ gateway, credentialStore: store, clock: { now: () => now } });
  return { store, gateway, session, advance: (milliseconds: number) => { now += milliseconds; } };
}

async function login(setupResult: ReturnType<typeof setup>) {
  expect(await setupResult.session.login('technician-1')).toEqual({ ok: true, value: undefined });
  const credentials = await setupResult.session.getRequestCredentials();
  if (!credentials) throw new Error('Expected synthetic test session');
  return credentials;
}

test('login persists only protected credentials and exposes a stable token-free snapshot', async () => {
  const context = setup();
  expect(context.session.getSnapshot()).toEqual({ status: 'anonymous', actor: null, generation: 0 });
  const credentials = await login(context);
  expect(context.session.getSnapshot()).toEqual({
    status: 'authenticated', actor: { id: 'technician-1', role: 'technician' }, generation: 1,
  });
  expect(context.session.getSnapshot()).toBe(context.session.getSnapshot());
  expect(context.store.value).toEqual({ accessToken: 'synthetic-access-0', refreshToken: 'synthetic-refresh-0' });
  expect(credentials).toEqual({ accessToken: 'synthetic-access-0', actorId: 'technician-1', generation: 1 });
  expect(JSON.stringify(context.session.getSnapshot())).not.toContain('synthetic-');
  expect(context.gateway.refresh).not.toHaveBeenCalled();
});

test('listeners observe real transitions and unsubscribe prevents further callbacks', async () => {
  const context = setup();
  const statuses: string[] = [];
  // These functions are deliberately detached, as useSyncExternalStore calls them.
  const { subscribe, getSnapshot } = context.session;
  const unsubscribe = subscribe(() => { statuses.push(getSnapshot().status); });
  const credentials = await login(context);
  await context.session.coordinateRefresh(credentials);
  await context.session.logout();
  expect(statuses).toEqual(['authenticating', 'authenticated', 'expired', 'refreshing', 'authenticated', 'logging_out', 'anonymous']);
  unsubscribe();
  await context.session.login('coordinator-1');
  expect(statuses).toHaveLength(7);
});

test('empty login input leaves a valid session unchanged and never sends credentials', async () => {
  const context = setup();
  const credentials = await login(context);
  expect(await context.session.login('  ')).toEqual({ ok: false, error: { kind: 'invalid_input' } });
  expect(await context.session.getRequestCredentials()).toEqual(credentials);
  expect(context.gateway.login).toHaveBeenCalledTimes(1);
});

test.each(['unauthorized', 'network', 'timeout', 'contract'] as const)('login failure %s stays anonymous with empty storage', async (kind) => {
  const context = setup();
  context.store.value = { accessToken: 'previous-private-access', refreshToken: 'previous-private-refresh' };
  (context.gateway.login as jest.Mock).mockResolvedValueOnce({ ok: false, error: { kind } });
  expect(await context.session.login('technician-1')).toEqual({ ok: false, error: { kind } });
  expect(context.session.getSnapshot().status).toBe('anonymous');
  expect(await context.session.getRequestCredentials()).toBeNull();
  expect(context.store.value).toBeNull();
});

test('a rejected gateway error is sanitized and cannot surface private text', async () => {
  const context = setup();
  (context.gateway.login as jest.Mock).mockRejectedValueOnce(new Error('synthetic-secret-marker'));
  const result = await context.session.login('technician-1');
  expect(result).toEqual({ ok: false, error: { kind: 'network' } });
  expect(JSON.stringify(result)).not.toContain('synthetic-secret-marker');
});

test('controlled expiration at its exact boundary renews once and resets its lifetime', async () => {
  const context = setup();
  await login(context);
  context.advance(59999);
  expect(context.session.getSnapshot().status).toBe('authenticated');
  context.advance(1);
  expect(context.session.getSnapshot().status).toBe('expired');
  expect(await context.session.getRequestCredentials()).toEqual({
    accessToken: 'synthetic-access-1', actorId: 'technician-1', generation: 2,
  });
  expect(context.gateway.refresh).toHaveBeenCalledTimes(1);
  context.advance(59999);
  expect(context.session.getSnapshot().status).toBe('authenticated');
});

test('40 concurrent expired requests share a single pending refresh and the same new credentials', async () => {
  const context = setup();
  await login(context);
  const pending = deferred<SessionResult<IssuedSession>>();
  (context.gateway.refresh as jest.Mock).mockReturnValueOnce(pending.promise);
  context.advance(60000);
  const requests = Array.from({ length: 40 }, () => context.session.getRequestCredentials());
  expect(context.gateway.refresh).toHaveBeenCalledTimes(1);
  expect(context.session.getSnapshot().status).toBe('refreshing');
  pending.resolve(success(renewedTokens));
  const results = await Promise.all(requests);
  expect(results).toHaveLength(40);
  for (const result of results) expect(result).toEqual(results[0]);
  expect(context.store.save).toHaveBeenCalledTimes(2);
});

test('40 concurrent 401s share one promise; delayed old 401 uses its renewal even if the access token is unchanged', async () => {
  const context = setup();
  const credentials = await login(context);
  const pending = deferred<SessionResult<IssuedSession>>();
  (context.gateway.refresh as jest.Mock).mockReturnValueOnce(pending.promise);
  const requests = Array.from({ length: 40 }, () => context.session.coordinateRefresh(credentials));
  for (const request of requests) expect(request).toBe(requests[0]);
  expect(context.gateway.refresh).toHaveBeenCalledTimes(1);
  pending.resolve(success({ ...renewedTokens, accessToken: credentials.accessToken }));
  const results = await Promise.all(requests);
  expect(results[0]?.generation).toBe(2);
  expect(await context.session.coordinateRefresh(credentials)).toEqual(results[0]);
  expect(context.gateway.refresh).toHaveBeenCalledTimes(1);
});

test.each(['unauthorized', 'network', 'timeout', 'contract'] as const)('refresh failure %s discards credentials with no renewal loop', async (kind) => {
  const context = setup();
  const credentials = await login(context);
  (context.gateway.refresh as jest.Mock).mockResolvedValueOnce({ ok: false, error: { kind } });
  expect(await context.session.coordinateRefresh(credentials)).toBeNull();
  expect(context.session.getSnapshot()).toMatchObject({ status: 'anonymous', actor: null });
  expect(context.store.value).toBeNull();
  expect(await context.session.coordinateRefresh(credentials)).toBeNull();
  expect(await context.session.getRequestCredentials()).toBeNull();
  expect(context.gateway.refresh).toHaveBeenCalledTimes(1);
});

test('logout invalidates a pending refresh and ignores its late successful tokens', async () => {
  const context = setup();
  const credentials = await login(context);
  const pending = deferred<SessionResult<IssuedSession>>();
  (context.gateway.refresh as jest.Mock).mockReturnValueOnce(pending.promise);
  const refresh = context.session.coordinateRefresh(credentials);
  await context.session.logout();
  pending.resolve(success(renewedTokens));
  expect(await refresh).toBeNull();
  expect(context.session.getSnapshot()).toMatchObject({ status: 'anonymous', actor: null });
  expect(context.store.value).toBeNull();
  expect(context.store.save).toHaveBeenCalledTimes(1);
});

test('logout waits for a refresh save already in progress and deletes after it finishes', async () => {
  const context = setup();
  const credentials = await login(context);
  const saveStarted = deferred<void>();
  const finishSave = deferred<void>();
  context.store.save.mockImplementationOnce(async (value) => {
    saveStarted.resolve();
    await finishSave.promise;
    context.store.value = value;
  });
  const refresh = context.session.coordinateRefresh(credentials);
  await saveStarted.promise;
  const logout = context.session.logout();
  expect(context.session.getSnapshot().status).toBe('logging_out');
  expect(await context.session.getRequestCredentials()).toBeNull();
  finishSave.resolve();
  await logout;
  expect(await refresh).toBeNull();
  expect(context.store.value).toBeNull();
  expect(context.store.clear.mock.invocationCallOrder[1]).toBeGreaterThan(context.store.save.mock.invocationCallOrder[1]!);
});

test('logout also deletes after a login save already in progress', async () => {
  const context = setup();
  const saveStarted = deferred<void>();
  const finishSave = deferred<void>();
  context.store.save.mockImplementationOnce(async (value) => {
    saveStarted.resolve();
    await finishSave.promise;
    context.store.value = value;
  });
  const authenticate = context.session.login('technician-1');
  await saveStarted.promise;
  const logout = context.session.logout();
  finishSave.resolve();
  await logout;
  expect(await authenticate).toEqual({ ok: false, error: { kind: 'obsolete' } });
  expect(context.session.getSnapshot().status).toBe('anonymous');
  expect(context.store.value).toBeNull();
});

test('a late login response after logout cannot restore authentication or storage', async () => {
  const context = setup();
  const started = deferred<void>();
  const pending = deferred<SessionResult<LoginSession>>();
  (context.gateway.login as jest.Mock).mockImplementationOnce(() => { started.resolve(); return pending.promise; });
  const authenticate = context.session.login('technician-1');
  await started.promise;
  await context.session.logout();
  pending.resolve(success(loginTokens()));
  expect(await authenticate).toEqual({ ok: false, error: { kind: 'obsolete' } });
  expect(context.store.save).not.toHaveBeenCalled();
  expect(context.store.value).toBeNull();
});

test('an obsolete login or refresh cannot clear a newer actor session', async () => {
  const context = setup();
  const oldCredentials = await login(context);
  const pending = deferred<SessionResult<IssuedSession>>();
  (context.gateway.refresh as jest.Mock).mockReturnValueOnce(pending.promise);
  const oldRefresh = context.session.coordinateRefresh(oldCredentials);
  await context.session.login('coordinator-1');
  const newCredentials = await context.session.getRequestCredentials();
  pending.resolve({ ok: false, error: { kind: 'unauthorized' } });
  expect(await oldRefresh).toBeNull();
  await context.session.invalidate(oldCredentials);
  expect(await context.session.coordinateRefresh(oldCredentials)).toBeNull();
  expect(await context.session.getRequestCredentials()).toEqual(newCredentials);
  expect(context.session.getSnapshot().actor?.id).toBe('coordinator-1');
  expect(context.store.value).not.toBeNull();
});

test('old requests cannot reuse a new login even when the actor and token strings match', async () => {
  const context = setup();
  const oldCredentials = await login(context);
  await context.session.logout();
  await context.session.login('technician-1');
  expect(await context.session.coordinateRefresh(oldCredentials)).toBeNull();
  await context.session.invalidate(oldCredentials);
  expect(context.session.getSnapshot().status).toBe('authenticated');
  expect(context.gateway.refresh).not.toHaveBeenCalled();
});

test('a second 401 invalidates its renewed credentials while a delayed older 401 cannot invalidate them', async () => {
  const context = setup();
  const oldCredentials = await login(context);
  const renewed = await context.session.coordinateRefresh(oldCredentials);
  if (!renewed) throw new Error('Expected renewal');
  await context.session.invalidate(oldCredentials);
  expect(context.session.getSnapshot().status).toBe('authenticated');
  await context.session.invalidate(renewed);
  expect(context.session.getSnapshot().status).toBe('anonymous');
  expect(context.store.value).toBeNull();
});

test('login save failure after logout starts is reported as obsolete', async () => {
  const context = setup();
  const saveStarted = deferred<void>();
  const failSave = deferred<void>();

  context.store.save.mockImplementationOnce(async () => {
    saveStarted.resolve();
    await failSave.promise;
  });

  const authenticate = context.session.login('technician-1');
  await saveStarted.promise;

  const logout = context.session.logout();
  failSave.reject(new Error('synthetic-native-secret'));

  await logout;

  expect(await authenticate).toEqual({
    ok: false,
    error: { kind: 'obsolete' },
  });
  expect(context.session.getSnapshot().status).toBe('anonymous');
  expect(context.store.value).toBeNull();
});

test('protected-storage save failure aborts login and clears any partial write', async () => {
  const context = setup();
  context.store.save.mockImplementationOnce(async (value) => {
    context.store.value = value;
    throw new Error('synthetic-native-secret');
  });
  expect(await context.session.login('technician-1')).toEqual({ ok: false, error: { kind: 'storage' } });
  expect(context.session.getSnapshot().status).toBe('anonymous');
  expect(context.store.value).toBeNull();
});

test('logout reports a sanitized deletion failure, disables requests, and supports retrying deletion', async () => {
  const context = setup();
  await login(context);
  context.store.clear.mockRejectedValueOnce(new Error('synthetic-native-secret'));
  await expect(context.session.logout()).rejects.toThrow('No fue posible borrar la sesión segura. Intenta cerrar sesión otra vez.');
  expect(context.session.getSnapshot()).toMatchObject({ status: 'logging_out', actor: null });
  expect(await context.session.getRequestCredentials()).toBeNull();
  await context.session.logout();
  expect(context.store.value).toBeNull();
  expect(context.session.getSnapshot().status).toBe('anonymous');
});

test('refresh failure plus protected-storage deletion failure stays unavailable and permits logout cleanup', async () => {
  const context = setup();
  const credentials = await login(context);
  (context.gateway.refresh as jest.Mock).mockResolvedValueOnce({ ok: false, error: { kind: 'unauthorized' } });
  context.store.clear.mockRejectedValueOnce(new Error('synthetic-native-secret'));
  expect(await context.session.coordinateRefresh(credentials)).toBeNull();
  expect(context.session.getSnapshot()).toMatchObject({ status: 'logging_out', actor: null });
  expect(await context.session.getRequestCredentials()).toBeNull();
  expect(await context.session.coordinateRefresh(credentials)).toBeNull();
  await context.session.logout();
  expect(context.store.value).toBeNull();
  expect(context.session.getSnapshot().status).toBe('anonymous');
});
