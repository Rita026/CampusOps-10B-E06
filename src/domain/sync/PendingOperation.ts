export type PendingAction =
  | 'start'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'comment'
  | 'add_evidence';

export type PendingOperation = Readonly<{
  operationId: string;
  incidentId: string;
  actorId: string;
  action: PendingAction;
  payload: Readonly<Record<string, unknown>>;
  baseVersion: number;
  createdAt: string;
}>;

export type LocalSyncStateV1 = Readonly<{
  schemaVersion: 1;
  pendingOperations: readonly PendingOperation[];
}>;

export const CURRENT_SCHEMA_VERSION = 1 as const;