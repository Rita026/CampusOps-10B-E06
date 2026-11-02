export type RetryMethod = 'GET' | 'POST';

/** HTTP status of the failed attempt, or 'timeout' when no response arrived. */
export type RetryStatus = number | 'timeout';

export type RetryInput = Readonly<{
  method: RetryMethod;
  status: RetryStatus;
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>;

export type RetryDecision = Readonly<{
  retry: boolean;
  delayMs: number;
  /** True when the only reason not to retry is a POST without a stable operation key. */
  requiresStableIdempotencyKey: boolean;
}>;

export type RetryPolicyConfig = Readonly<{
  /** Total attempts allowed, the first one included. */
  maxAttempts: number;
  /** Backoff after attempt n is baseDelayMs * 2^(n-1), capped at maxDelayMs. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** A Retry-After longer than this is reported as a failure instead of waited for. */
  maxRetryAfterMs: number;
}>;

/** Published limit (docs/CAMPUSOPS_API.md): attempt 4 is never retried. */
export const PUBLISHED_MAX_ATTEMPTS = 4;

/** Same minimum the backend enforces for Idempotency-Key. */
export const MIN_IDEMPOTENCY_KEY_LENGTH = 8;

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: PUBLISHED_MAX_ATTEMPTS,
  baseDelayMs: 500,
  maxDelayMs: 4000,
  maxRetryAfterMs: 10_000,
};

/** Transient failures: timeout, 408, rate limit and unavailable gateway/server. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const NO_RETRY: RetryDecision = { retry: false, delayMs: 0, requiresStableIdempotencyKey: false };

function isNonnegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Rejects configurations that would allow unbounded or infinite waits. */
export function assertRetryPolicy(config: RetryPolicyConfig): void {
  const { maxAttempts, baseDelayMs, maxDelayMs, maxRetryAfterMs } = config;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > PUBLISHED_MAX_ATTEMPTS) {
    throw new Error(`maxAttempts debe ser un entero entre 1 y ${PUBLISHED_MAX_ATTEMPTS}`);
  }
  if (!isNonnegativeFinite(baseDelayMs) || !isNonnegativeFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new Error('baseDelayMs y maxDelayMs deben ser finitos, no negativos y baseDelayMs <= maxDelayMs');
  }
  if (!isNonnegativeFinite(maxRetryAfterMs)) {
    throw new Error('maxRetryAfterMs debe ser finito y no negativo');
  }
}

function isRetryableStatus(status: RetryStatus): boolean {
  return status === 'timeout' || RETRYABLE_STATUSES.has(status);
}

export function hasStableIdempotencyKey(key: string | undefined): boolean {
  return typeof key === 'string' && key.trim().length >= MIN_IDEMPOTENCY_KEY_LENGTH;
}

/**
 * Decides whether a failed request may be sent again and after how long. A POST is only
 * repeated with a stable Idempotency-Key, so a lost response cannot apply the effect twice.
 */
export function planRetryWithPolicy(
  input: RetryInput,
  config: RetryPolicyConfig = DEFAULT_RETRY_POLICY,
): RetryDecision {
  assertRetryPolicy(config);
  const { method, status, attempt, retryAfterMs, idempotencyKey } = input;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= config.maxAttempts) return NO_RETRY;
  if (!isRetryableStatus(status)) return NO_RETRY;
  if (method === 'POST' && !hasStableIdempotencyKey(idempotencyKey)) {
    return { retry: false, delayMs: 0, requiresStableIdempotencyKey: true };
  }

  // A valid Retry-After replaces the backoff: retrying sooner would ignore the server.
  if (retryAfterMs !== undefined && isNonnegativeFinite(retryAfterMs)) {
    if (retryAfterMs > config.maxRetryAfterMs) return NO_RETRY;
    return { retry: true, delayMs: Math.ceil(retryAfterMs), requiresStableIdempotencyKey: false };
  }
  const backoff = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
  return { retry: true, delayMs: backoff, requiresStableIdempotencyKey: false };
}

/** IMF-fixdate, the HTTP-date format servers must send (e.g. "Fri, 30 Oct 2026 12:00:05 GMT"). */
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Retry-After as delay-seconds or HTTP-date (RFC 9110). Anything else is ignored so the
 * caller falls back to backoff; a date in the past means "now". Date.parse alone is not
 * enough: it also accepts values such as "-1" or "1.5".
 */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  if (!HTTP_DATE.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}
