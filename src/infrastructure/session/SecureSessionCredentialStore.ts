import * as SecureStore from 'expo-secure-store';

import type { SessionCredentialStore, SessionCredentials } from '../../domain/session/SessionCredentialStore';

const SESSION_KEY = 'campusops.session.credentials.v1';
const STORAGE_ERROR = 'No fue posible acceder a la sesión segura.';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function isSessionCredentials(value: unknown): value is SessionCredentials {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.accessToken === 'string' && candidate.accessToken.trim().length > 0
    && typeof candidate.refreshToken === 'string' && candidate.refreshToken.trim().length > 0;
}

/** Native Keychain/Keystore adapter. Never forwards native error text or stored values. */
export class SecureSessionCredentialStore implements SessionCredentialStore {
  public async save(credentials: SessionCredentials): Promise<void> {
    if (!isSessionCredentials(credentials)) throw new Error(STORAGE_ERROR);
    try {
      if (!await SecureStore.isAvailableAsync()) throw new Error(STORAGE_ERROR);
      const minimalCredentials = {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
      };
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(minimalCredentials), OPTIONS);
    } catch {
      throw new Error(STORAGE_ERROR);
    }
  }

  public async load(): Promise<SessionCredentials | null> {
    try {
      if (!await SecureStore.isAvailableAsync()) throw new Error(STORAGE_ERROR);
      const stored = await SecureStore.getItemAsync(SESSION_KEY, OPTIONS);
      if (stored === null) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        parsed = null;
      }
      if (isSessionCredentials(parsed)) {
        return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
      }

      await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS);
      return null;
    } catch {
      throw new Error(STORAGE_ERROR);
    }
  }

  public async clear(): Promise<void> {
    try {
      if (!await SecureStore.isAvailableAsync()) throw new Error(STORAGE_ERROR);
      await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS);
    } catch {
      throw new Error(STORAGE_ERROR);
    }
  }
}
