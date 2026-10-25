import type { JsonObject, SyncRecord } from '../../course-evaluation/contracts';

export type SyncResolution =
  | Readonly<{ kind: 'merged'; fields: JsonObject }>
  | Readonly<{ kind: 'conflict'; fields: readonly string[] }>;

/** A field missing on one side is a value of its own, distinct from null. */
const ABSENT = '\u0000absent';

/** Canonical JSON: sorted object keys, so equal content compares equal regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return ABSENT;
  return JSON.stringify(value, (_key, item: unknown) => (
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, (item as Record<string, unknown>)[key]]))
      : item
  ));
}

function fieldNames(...records: readonly SyncRecord[]): readonly string[] {
  return [...new Set(records.flatMap((record) => Object.keys(record.fields)))].sort();
}

/**
 * Three-way merge per top-level field. A side that kept the base value yields to the
 * side that changed it; equal changes are accepted once; different changes to the same
 * field are a conflict. Inputs are never mutated and merged values are fresh copies.
 */
export function resolveSyncRecords(base: SyncRecord, local: SyncRecord, remote: SyncRecord): SyncResolution {
  if (local.id !== base.id || remote.id !== base.id) {
    throw new Error('resolveSync requiere tres versiones de la misma entidad');
  }

  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const name of fieldNames(base, local, remote)) {
    const baseValue = canonicalJson(base.fields[name]);
    const localValue = canonicalJson(local.fields[name]);
    const remoteValue = canonicalJson(remote.fields[name]);

    let chosen: string;
    if (localValue === remoteValue || localValue === baseValue) chosen = remoteValue;
    else if (remoteValue === baseValue) chosen = localValue;
    else {
      conflicts.push(name);
      continue;
    }
    if (chosen !== ABSENT) merged[name] = JSON.parse(chosen) as unknown;
  }

  return conflicts.length > 0 ? { kind: 'conflict', fields: conflicts } : { kind: 'merged', fields: merged };
}

/** Keeps the first operation for each operationId, in order, without touching the input. */
export function deduplicateByOperationId<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return operations.filter((operation) => {
    if (seen.has(operation.operationId)) return false;
    seen.add(operation.operationId);
    return true;
  });
}
