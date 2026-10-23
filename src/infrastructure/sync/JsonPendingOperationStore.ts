import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CURRENT_SCHEMA_VERSION,
  type LocalSyncStateV1,
  type PendingOperation,
} from '../../domain/sync/PendingOperation';
import type { PendingOperationStore } from '../../domain/sync/PendingOperationStore';

const STORAGE_KEY = 'campusops.sync.state.v1';
const BACKUP_KEY = 'campusops.sync.state.backup';

type MemoryMap = Map<string, string>;

function emptyState(): LocalSyncStateV1 {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, pendingOperations: [] };
}

function isPendingOperation(value: unknown): value is PendingOperation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.operationId === 'string' && o.operationId.length >= 8
    && typeof o.incidentId === 'string' && o.incidentId.trim().length > 0
    && typeof o.actorId === 'string' && o.actorId.trim().length > 0
    && typeof o.action === 'string'
    && typeof o.payload === 'object' && o.payload !== null && !Array.isArray(o.payload)
    && typeof o.baseVersion === 'number' && Number.isInteger(o.baseVersion) && o.baseVersion >= 0
    && typeof o.createdAt === 'string' && o.createdAt.trim().length > 0
  );
}

function parseState(raw: string | null): LocalSyncStateV1 {
  if (raw === null || raw.trim() === '') return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
  const record = parsed as Record<string, unknown>;
  const version = record.schemaVersion;
  if (version !== 1) {
    // Esquema desconocido: no mezclar; quien migre debe pasar por migrate().
    return emptyState();
  }
  if (!Array.isArray(record.pendingOperations)) return emptyState();
  const pendingOperations = record.pendingOperations.filter(isPendingOperation);
  return { schemaVersion: 1, pendingOperations };
}

type StorageDriver = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function createMemoryDriver(map: MemoryMap = new Map()): StorageDriver {
  return {
    async getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

function createAsyncStorageDriver(): StorageDriver {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  };
}

export type JsonPendingOperationStoreOptions = Readonly<{
  /** Inyectar Map para tests (reinicio simulado y migración). */
  memory?: MemoryMap;
  /** Forzar fallo en el siguiente save (prueba de rollback). */
  failNextSave?: boolean;
}>;

/**
 * Persistencia JSON de la cola. En tests usa memoria; en app AsyncStorage.
 * migrateFromLegacy hace backup y restaura si la escritura nueva falla.
 */
export class JsonPendingOperationStore implements PendingOperationStore {
  private readonly driver: StorageDriver;
  private failNextSave: boolean;

  public constructor(options: JsonPendingOperationStoreOptions = {}) {
    this.driver = options.memory
      ? createMemoryDriver(options.memory)
      : createAsyncStorageDriver();
    this.failNextSave = options.failNextSave === true;
  }

  public async load(): Promise<LocalSyncStateV1> {
    const raw = await this.driver.getItem(STORAGE_KEY);
    return parseState(raw);
  }

  public async save(state: LocalSyncStateV1): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('synthetic-storage-failure');
    }
    const payload: LocalSyncStateV1 = {
      schemaVersion: 1,
      pendingOperations: state.pendingOperations,
    };
    await this.driver.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  public async loadRaw(): Promise<string | null> {
    return this.driver.getItem(STORAGE_KEY);
  }

  public async saveRaw(raw: string): Promise<void> {
    await this.driver.setItem(STORAGE_KEY, raw);
  }

  /** Armar la próxima escritura para que falle (solo pruebas). */
  public armFailNextSave(): void {
    this.failNextSave = true;
  }

  /**
   * Migración controlada: backup → escribir nuevo → si falla, restaurar backup.
   * legacyRaw: contenido de un esquema anterior (p. ej. solo un array de operaciones).
   */
  public async migrateFromLegacy(legacyRaw: string): Promise<LocalSyncStateV1> {
    const previous = await this.driver.getItem(STORAGE_KEY);
    await this.driver.setItem(BACKUP_KEY, previous ?? '');

    let legacyParsed: unknown;
    try {
      legacyParsed = JSON.parse(legacyRaw);
    } catch {
      legacyParsed = null;
    }

    let pendingOperations: PendingOperation[] = [];
    if (Array.isArray(legacyParsed)) {
      pendingOperations = legacyParsed.filter(isPendingOperation);
    } else if (
      legacyParsed !== null
      && typeof legacyParsed === 'object'
      && Array.isArray((legacyParsed as { pendingOperations?: unknown }).pendingOperations)
    ) {
      pendingOperations = (legacyParsed as { pendingOperations: unknown[] }).pendingOperations
        .filter(isPendingOperation);
    }

    const next: LocalSyncStateV1 = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pendingOperations,
    };

    try {
      if (this.failNextSave) {
        this.failNextSave = false;
        throw new Error('synthetic-migration-failure');
      }
      await this.driver.setItem(STORAGE_KEY, JSON.stringify(next));
      await this.driver.removeItem(BACKUP_KEY);
      return next;
    } catch (error) {
      const backup = await this.driver.getItem(BACKUP_KEY);
      if (backup !== null && backup !== '') {
        await this.driver.setItem(STORAGE_KEY, backup);
      } else if (backup === '') {
        await this.driver.removeItem(STORAGE_KEY);
      }
      await this.driver.removeItem(BACKUP_KEY);
      throw error;
    }
  }
}