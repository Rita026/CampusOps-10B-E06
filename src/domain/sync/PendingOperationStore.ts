import type { LocalSyncStateV1, PendingOperation } from './PendingOperation';

/** Puerto de persistencia: la app no depende de AsyncStorage directamente. */
export type PendingOperationStore = {
  load(): Promise<LocalSyncStateV1>;
  save(state: LocalSyncStateV1): Promise<void>;
  /** Solo para pruebas de migración/rollback. */
  loadRaw?(): Promise<string | null>;
  saveRaw?(raw: string): Promise<void>;
};

export type PendingOperationQueuePort = {
  list(): Promise<readonly PendingOperation[]>;
  enqueue(operation: PendingOperation): Promise<void>;
  replace(operation: PendingOperation): Promise<boolean>;
  remove(operationId: string): Promise<void>;
};