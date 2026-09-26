import * as SecureStore from 'expo-secure-store';

import { getBackendHealth } from '../src/api/courseBackend';
import { SecureSessionCredentialStore } from '../src/infrastructure/session/SecureSessionCredentialStore';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const accessToken = 'synthetic-access-marker-41';
const refreshToken = 'synthetic-refresh-marker-72';
const nativeMarker = 'synthetic-native-error-marker-83';
const backendMarker = 'synthetic-backend-error-marker-94';

const nativeSet = jest.mocked(SecureStore.setItemAsync);
const nativeGet = jest.mocked(SecureStore.getItemAsync);
const nativeDelete = jest.mocked(SecureStore.deleteItemAsync);
const nativeAvailable = jest.mocked(SecureStore.isAvailableAsync);

let savedFetch: typeof fetch;
let logged: jest.SpyInstance;
let warned: jest.SpyInstance;
let errored: jest.SpyInstance;

function loggedOutput(): string {
  return JSON.stringify([logged.mock.calls, warned.mock.calls, errored.mock.calls]);
}

async function rejectionMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error('Expected the operation to reject');
}

beforeEach(() => {
  jest.clearAllMocks();
  nativeAvailable.mockResolvedValue(true);
  savedFetch = global.fetch;
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
  logged = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  warned = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errored = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  global.fetch = savedFetch;
  jest.restoreAllMocks();
});

describe('secure session credential storage', () => {
  test('persists through the native secure store and clears both credentials', async () => {
    const nativeValues = new Map<string, string>();
    nativeSet.mockImplementation(async (key, value) => {
      nativeValues.set(key, value);
    });
    nativeGet.mockImplementation(async (key) => nativeValues.get(key) ?? null);
    nativeDelete.mockImplementation(async (key) => {
      nativeValues.delete(key);
    });

    const store = new SecureSessionCredentialStore();
    await store.save({ accessToken, refreshToken });

    expect(nativeSet).toHaveBeenCalled();
    expect(JSON.stringify([...nativeValues.values()])).toContain(accessToken);
    expect(JSON.stringify([...nativeValues.values()])).toContain(refreshToken);
    await expect(store.load()).resolves.toEqual({ accessToken, refreshToken });
    expect(nativeGet).toHaveBeenCalled();

    await store.clear();
    expect(nativeDelete).toHaveBeenCalled();
    expect(nativeValues.size).toBe(0);
    await expect(store.load()).resolves.toBeNull();
    expect(loggedOutput()).not.toContain(accessToken);
    expect(loggedOutput()).not.toContain(refreshToken);
  });

  test('stores only credential fields even when the caller supplies incident data', async () => {
    nativeSet.mockResolvedValue(undefined);
    nativeAvailable.mockResolvedValue(true);
    const store = new SecureSessionCredentialStore();
    const supplied = { accessToken, refreshToken, location: backendMarker };

    await store.save(supplied);

    expect(nativeSet).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ accessToken, refreshToken }),
      expect.any(Object),
    );
    expect(JSON.stringify(nativeSet.mock.calls)).not.toContain(backendMarker);
  });

  test('discards a damaged session instead of restoring partial credentials', async () => {
    nativeAvailable.mockResolvedValue(true);
    nativeGet.mockResolvedValue(`{${nativeMarker}`);
    nativeDelete.mockResolvedValue(undefined);
    const store = new SecureSessionCredentialStore();

    await expect(store.load()).resolves.toBeNull();
    expect(nativeDelete).toHaveBeenCalled();
    expect(loggedOutput()).not.toContain(nativeMarker);
  });

  test('fails closed when secure storage is unavailable', async () => {
    nativeAvailable.mockResolvedValue(false);
    const store = new SecureSessionCredentialStore();

    const message = await rejectionMessage(() => store.save({ accessToken, refreshToken }));

    expect(message).not.toContain(accessToken);
    expect(nativeSet).not.toHaveBeenCalled();
  });

  test.each(['save', 'load', 'clear'] as const)('%s reports a fixed safe error when native storage fails', async (operation) => {
    const store = new SecureSessionCredentialStore();
    const nativeFailure = new Error(`${nativeMarker}: device path /private/session`);
    nativeSet.mockRejectedValue(nativeFailure);
    nativeGet.mockRejectedValue(nativeFailure);
    nativeDelete.mockRejectedValue(nativeFailure);

    const invoke = () => operation === 'save'
      ? store.save({ accessToken, refreshToken })
      : operation === 'load'
        ? store.load()
        : store.clear();
    const firstMessage = await rejectionMessage(invoke);

    const secondNativeMarker = 'synthetic-native-error-marker-95';
    nativeSet.mockRejectedValue(new Error(secondNativeMarker));
    nativeGet.mockRejectedValue(new Error(secondNativeMarker));
    nativeDelete.mockRejectedValue(new Error(secondNativeMarker));
    const secondMessage = await rejectionMessage(invoke);

    expect(firstMessage).toBe(secondMessage);
    expect(firstMessage.length).toBeGreaterThan(0);
    expect(firstMessage).not.toContain(nativeMarker);
    expect(firstMessage).not.toContain(accessToken);
    expect(firstMessage).not.toContain(refreshToken);
    expect(loggedOutput()).not.toContain(nativeMarker);
    expect(loggedOutput()).not.toContain(secondNativeMarker);
    expect(loggedOutput()).not.toContain(accessToken);
    expect(loggedOutput()).not.toContain(refreshToken);
  });
});

describe('backend health errors', () => {
  test('HTTP failure exposes only safe status context', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({ message: backendMarker }),
    });

    const message = await rejectionMessage(() => getBackendHealth());

    expect(message).not.toContain(backendMarker);
    expect(logged).toHaveBeenCalledWith('[telemetry] backend_health_failed', { status: 503 });
    expect(loggedOutput()).not.toContain(backendMarker);
  });

  test('network rejection cannot leak the underlying exception', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error(`${backendMarker}: connection details`));

    const message = await rejectionMessage(() => getBackendHealth());

    expect(message).not.toContain(backendMarker);
    expect(logged).toHaveBeenCalled();
    expect(loggedOutput()).not.toContain(backendMarker);
  });

  test('JSON decoding rejection cannot leak the underlying exception', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new Error(`${backendMarker}: raw body`)),
    });

    const message = await rejectionMessage(() => getBackendHealth());

    expect(message).not.toContain(backendMarker);
    expect(logged).toHaveBeenCalled();
    expect(loggedOutput()).not.toContain(backendMarker);
  });

  test('invalid contract never logs a sensitive nested response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        ok: false,
        contractVersion: 99,
        message: backendMarker,
        profile: [{ authorization: accessToken, location: refreshToken }],
      }),
    });

    const message = await rejectionMessage(() => getBackendHealth());

    expect(message).not.toContain(backendMarker);
    expect(message).not.toContain(accessToken);
    expect(message).not.toContain(refreshToken);
    expect(logged).toHaveBeenCalled();
    expect(loggedOutput()).not.toContain(backendMarker);
    expect(loggedOutput()).not.toContain(accessToken);
    expect(loggedOutput()).not.toContain(refreshToken);
  });
});
