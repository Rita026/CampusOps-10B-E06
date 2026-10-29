import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from './contracts';
import type { IncidentLocation } from '../campusops/contracts';
import { reduceRefreshEvents, type RefreshSummary } from '../application/session/refreshState';
import { deduplicateByOperationId, resolveSyncRecords } from '../application/sync/syncResolution';
import { selectIncidentLocationFromProvider } from '../application/location/selectIncidentLocation';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

const SENSITIVE_KEYS = new Set([
  'authorization', 'password', 'token', 'accesstoken', 'refreshtoken',
  'email', 'displayname', 'name', 'userid', 'reporterid', 'technicianid',
  'assignedtechnicianid', 'location', 'latitude', 'longitude', 'photos',
  'evidence', 'internalcomments', 'assignmenthistory',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === 'object') {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = SENSITIVE_KEYS.has(normalizeKey(key)) ? '[REDACTED]' : redactValue(value);
  }
  return output;
}

export function redactForTelemetry(input: unknown): unknown {
  return redactValue(input);
}

export function parseRemoteResource(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'contract' };
  }
  const { id, version, status, payload } = input as Record<string, unknown>;

  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, error: 'contract' };
  }
  if (typeof status !== 'string' || status.length === 0) {
    return { ok: false, error: 'contract' };
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, error: 'contract' };
  }
  if (payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
    return { ok: false, error: 'contract' };
  }

  return {
    ok: true,
    value: { id, version, status, payload: payload as JsonObject | null },
  };
}

export function coordinateRefresh(events: readonly AuthEvent[]): RefreshSummary {
  return reduceRefreshEvents(events);
}

/** Same policy IncidentSyncService applies to the persistent queue (docs/sync-policy.md). */
export function resolveSync(
  base: SyncRecord,
  local: SyncRecord,
  remote: SyncRecord,
): Readonly<{ kind: 'merged'; fields: JsonObject } | { kind: 'conflict'; fields: readonly string[] }> {
  return resolveSyncRecords(base, local, remote);
}

export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  return deduplicateByOperationId(operations);
}

export function planRetry(_input: Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>): Readonly<{ retry: boolean; delayMs: number; requiresStableIdempotencyKey: boolean }> {
  return pending('planRetry');
}

export function reduceRemoteResponses(_input: Readonly<{
  activeRequestId: string;
  responses: readonly RemoteResponse[];
}>): Readonly<{ state: 'success' | 'error' | 'loading'; value?: unknown; error?: string }> {
  return pending('reduceRemoteResponses');
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{ status: 'available' | 'denied' | 'blocked'; resourceActive: boolean }> {
  return pending('reducePermissionLifecycle');
}


/** Week 09: see docs/CAMPUSOPS_API.md */
export function selectIncidentLocation(provider: unknown, manualLabel: string): IncidentLocation {
  return selectIncidentLocationFromProvider(provider, manualLabel);
}