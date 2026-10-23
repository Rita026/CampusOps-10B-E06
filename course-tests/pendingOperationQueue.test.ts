import { PendingOperationQueue } from '../src/application/sync/PendingOperationQueue';
import type { PendingOperation } from '../src/domain/sync/PendingOperation';
import { JsonPendingOperationStore } from '../src/infrastructure/sync/JsonPendingOperationStore';

function sampleOp(overrides: Partial<PendingOperation> = {}): PendingOperation {
  return {
    operationId: 'op-start-campus-inc-001',
    incidentId: 'campus-inc-001',
    actorId: 'technician-1',
    action: 'start',
    payload: { note: 'inicio sin conexión' },
    baseVersion: 1,
    createdAt: '2026-10-22T12:00:00.000Z',
    ...overrides,
  };
}

function firstOf<T>(items: readonly T[]): T {
  expect(items.length).toBeGreaterThan(0);
  const item = items[0];
  expect(item).toBeDefined();
  return item as T;
}

test('enqueue and list survive a new store instance (simulated restart)', async () => {
  const memory = new Map<string, string>();
  const first = new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
  const operation = sampleOp();
  await first.enqueue(operation);

  const second = new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
  const listed = await second.list();
  expect(listed).toHaveLength(1);
  expect(firstOf(listed)).toEqual(operation);
  expect(firstOf(listed).operationId).toBe('op-start-campus-inc-001');
});

test('duplicate operationId keeps the first entry', async () => {
  const memory = new Map<string, string>();
  const queue = new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
  await queue.enqueue(sampleOp({ payload: { note: 'primera' } }));
  await queue.enqueue(sampleOp({ payload: { note: 'segunda' } }));
  const listed = await queue.list();
  expect(listed).toHaveLength(1);
  expect(firstOf(listed).payload).toEqual({ note: 'primera' });
});

test('remove drops only the confirmed operationId', async () => {
  const memory = new Map<string, string>();
  const queue = new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
  await queue.enqueue(sampleOp());
  await queue.enqueue(sampleOp({
    operationId: 'op-comment-campus-inc-001',
    action: 'comment',
    payload: { text: 'nota' },
  }));
  await queue.remove('op-start-campus-inc-001');
  const listed = await queue.list();
  expect(listed).toHaveLength(1);
  expect(firstOf(listed).operationId).toBe('op-comment-campus-inc-001');
});

test('migration writes schema v1 and keeps pending operations', async () => {
  const memory = new Map<string, string>();
  const store = new JsonPendingOperationStore({ memory });
  const legacy = JSON.stringify([sampleOp()]);
  const migrated = await store.migrateFromLegacy(legacy);
  expect(migrated.schemaVersion).toBe(1);
  expect(migrated.pendingOperations).toHaveLength(1);
  expect(firstOf(migrated.pendingOperations).operationId).toBe('op-start-campus-inc-001');
  expect(await store.load()).toEqual(migrated);
});

test('failed migration restores previous state (rollback)', async () => {
  const memory = new Map<string, string>();
  const store = new JsonPendingOperationStore({ memory });
  const previous = {
    schemaVersion: 1 as const,
    pendingOperations: [sampleOp({ operationId: 'op-already-there-1234' })],
  };
  await store.save(previous);

  store.armFailNextSave();
  await expect(store.migrateFromLegacy(JSON.stringify([sampleOp()]))).rejects.toThrow(
    'synthetic-migration-failure',
  );

  const after = await store.load();
  expect(after).toEqual(previous);
  expect(firstOf(after.pendingOperations).operationId).toBe('op-already-there-1234');
});