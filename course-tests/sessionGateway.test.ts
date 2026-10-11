import { CourseSessionGateway } from '../src/infrastructure/session/CourseSessionGateway';

const baseUrl = 'http://127.0.0.1:4310';
const loginBody = {
  actorId: 'reporter-1', role: 'reporter',
  accessToken: 'synthetic-private-access', refreshToken: 'synthetic-private-refresh', expiresIn: 60,
};
function httpResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}
function setup(transport: jest.Mock, timeoutMs = 5000) {
  return new CourseSessionGateway({ baseUrl, transport: transport as typeof fetch, timeoutMs });
}

test('login and renewal call the real public contracts and validate the session fields', async () => {
  const transport = jest.fn()
    .mockResolvedValueOnce(httpResponse(loginBody))
    .mockResolvedValueOnce(httpResponse({ ...loginBody, refreshToken: 'synthetic-private-refresh-1' }));
  const gateway = setup(transport);
  expect(await gateway.login('reporter-1')).toEqual({ ok: true, value: {
    actor: { id: 'reporter-1', role: 'reporter' }, accessToken: loginBody.accessToken,
    refreshToken: loginBody.refreshToken, expiresIn: 60,
  } });
  expect(await gateway.refresh(loginBody.refreshToken)).toEqual({ ok: true, value: {
    accessToken: loginBody.accessToken, refreshToken: 'synthetic-private-refresh-1', expiresIn: 60,
  } });
  expect(transport).toHaveBeenNthCalledWith(1, `${baseUrl}/v1/session/login`, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ actorId: 'reporter-1' }),
    headers: { 'Content-Type': 'application/json', 'X-Course-Scenario': 'success' },
  }));
  expect(transport).toHaveBeenNthCalledWith(2, `${baseUrl}/v1/session/refresh`, expect.objectContaining({
    body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
  }));
});

test.each([
  null,
  { ...loginBody, actorId: 'reporter-2' },
  { ...loginBody, role: 'administrator' },
  { ...loginBody, accessToken: '' },
  { ...loginBody, refreshToken: ' ' },
  { ...loginBody, expiresIn: 0 },
  { ...loginBody, expiresIn: Infinity },
  { ...loginBody, expiresIn: '60' },
])('invalid login payload %j is rejected before persisting credentials', async (body) => {
  expect(await setup(jest.fn().mockResolvedValue(httpResponse(body))).login('reporter-1'))
    .toEqual({ ok: false, error: { kind: 'contract' } });
});

test('unknown actor and network errors never expose server response or raw exception messages', async () => {
  const transport = jest.fn()
    .mockResolvedValueOnce(httpResponse({ code: 'synthetic-private-error' }, 401))
    .mockRejectedValueOnce(new Error('synthetic-private-error'));
  const gateway = setup(transport);
  const results = [await gateway.login('unknown-fixture'), await gateway.refresh('synthetic-refresh')];
  expect(results).toEqual([{ ok: false, error: { kind: 'unauthorized' } }, { ok: false, error: { kind: 'network' } }]);
  expect(JSON.stringify(results)).not.toContain('synthetic-private-error');
});

test('malformed JSON and malformed refresh contracts are typed contract failures', async () => {
  const invalidJson = httpResponse(null);
  (invalidJson.json as jest.Mock).mockRejectedValueOnce(new Error('synthetic-private-json-error'));
  const transport = jest.fn().mockResolvedValueOnce(invalidJson).mockResolvedValueOnce(httpResponse({ accessToken: 'token-only' }));
  const gateway = setup(transport);
  expect(await gateway.login('reporter-1')).toEqual({ ok: false, error: { kind: 'contract' } });
  expect(await gateway.refresh('synthetic-refresh')).toEqual({ ok: false, error: { kind: 'contract' } });
});

test('a controlled timeout aborts even when fetch never resolves', async () => {
  jest.useFakeTimers();
  try {
    const transport: jest.Mock = jest.fn(() => new Promise<Response>(() => undefined));
    const pending = setup(transport, 250).login('reporter-1');
    jest.advanceTimersByTime(250);
    expect(await pending).toEqual({ ok: false, error: { kind: 'timeout' } });
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ signal: { aborted: true } });
  } finally {
    jest.useRealTimers();
  }
});

test('timeout covers a stalled JSON response and late completion cannot win', async () => {
  jest.useFakeTimers();
  try {
    const response = httpResponse(null);
    (response.json as jest.Mock).mockImplementationOnce(() => new Promise<unknown>(() => undefined));
    const pending = setup(jest.fn().mockResolvedValue(response), 250).refresh('synthetic-refresh');
    await Promise.resolve();
    jest.advanceTimersByTime(250);
    expect(await pending).toEqual({ ok: false, error: { kind: 'timeout' } });
  } finally {
    jest.useRealTimers();
  }
});

test('neither success nor failures print credentials to console', async () => {
  const spies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
  try {
    const transport = jest.fn().mockResolvedValueOnce(httpResponse(loginBody)).mockResolvedValueOnce(httpResponse({}, 401));
    const gateway = setup(transport);
    await gateway.login('reporter-1');
    await gateway.refresh(loginBody.refreshToken);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
