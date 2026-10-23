import type { PendingOperation } from '../../domain/sync/PendingOperation';
import type { PendingOperationStore } from '../../domain/sync/PendingOperationStore';

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertOperation(operation: PendingOperation): void {
  if (!isNonemptyString(operation.operationId) || operation.operationId.length < 8) {
    throw new Error('operationId inválido');
  }
  if (!isNonemptyString(operation.incidentId)) throw new Error('incidentId inválido');
  if (!isNonemptyString(operation.actorId)) throw new Error('actorId inválido');
  if (!Number.isInteger(operation.baseVersion) || operation.baseVersion < 0) {
    throw new Error('baseVersion inválido');
  }
  if (!isNonemptyString(operation.createdAt)) throw new Error('createdAt inválido');
}

/**
 * Cola de cambios offline. Persiste vía store; no vive solo en memoria.
 * remove solo cuando el servidor confirma (quien sincronice decide cuándo llamar).
 */
export class PendingOperationQueue {
  public constructor(private readonly store: PendingOperationStore) {}

  public async list(): Promise<readonly PendingOperation[]> {
    const state = await this.store.load();
    return state.pendingOperations;
  }

  public async enqueue(operation: PendingOperation): Promise<void> {
    assertOperation(operation);
    const state = await this.store.load();
    const exists = state.pendingOperations.some((item) => item.operationId === operation.operationId);
    if (exists) {
      // Misma identidad: conservar la primera (idempotencia local).
      return;
    }
    await this.store.save({
      schemaVersion: 1,
      pendingOperations: [...state.pendingOperations, operation],
    });
  }

  public async remove(operationId: string): Promise<void> {
    if (!isNonemptyString(operationId)) throw new Error('operationId inválido');
    const state = await this.store.load();
    await this.store.save({
      schemaVersion: 1,
      pendingOperations: state.pendingOperations.filter((item) => item.operationId !== operationId),
    });
  }
}