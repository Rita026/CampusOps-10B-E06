const REDACTED_VALUE = '[REDACTED]';

const sensitiveKeys = new Set([
  'authorization',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'email',
  'displayname',
  'name',
  'userid',
  'reporterid',
  'technicianid',
  'assignedtechnicianid',
  'location',
  'latitude',
  'longitude',
  'photos',
  'evidence',
  'internalcomments',
  'assignmenthistory',
]);

function normalizeKey(key: string): string {
  return key.replaceAll(/[_-]/g, '').toLowerCase();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Creates a telemetry-safe copy of JSON-like values. Sensitive fields are
 * replaced before a caller can write the payload to a console or log service.
 */
export function redactForTelemetry(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactForTelemetry(item));
  }

  if (!isRecord(input)) {
    return input;
  }

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      sensitiveKeys.has(normalizeKey(key)) ? REDACTED_VALUE : redactForTelemetry(value),
    ]),
  );
}
