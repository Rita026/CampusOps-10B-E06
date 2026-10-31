import type { IncidentClientResult } from '../incidents/IncidentClient';
import {
  DEFAULT_RETRY_POLICY,
  planRetryWithPolicy,
  type RetryMethod,
  type RetryPolicyConfig,
  type RetryStatus,
} from './retryPolicy';

/** A failure the policy may retry, given its status and Retry-After. */
export type RetryableFailure = Readonly<{ status: RetryStatus; retryAfterMs?: number }>;

/** 'ok' is success; 'final' is an answer no retry can change (invalid input, contract). */
export type AttemptClassification = 'ok' | 'final' | RetryableFailure;

/** Sanitized record of one attempt: no payload, actor or key, only timing and outcome. */
export type RetryAttempt = Readonly<{
  attempt: number;
  outcome: 'ok' | 'final' | RetryStatus;
  /** Wait applied before the next attempt; 0 when there is none. */
  delayMs: number;
  durationMs: number;
}>;

export type RetryRunnerOptions = Readonly<{
  policy?: RetryPolicyConfig;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onAttempt?: (attempt: RetryAttempt) => void;
}>;

export type RetryRequest<T> = Readonly<{
  method: RetryMethod;
  idempotencyKey?: string;
  /** Must send the same request every time: same key and same body. */
  send: () => Promise<T>;
  classify: (result: T) => AttemptClassification;
}>;

const realSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Repeats `send` while planRetryWithPolicy allows it. The loop always ends: the policy
 * never retries attempt maxAttempts (at most 4) and every delay is finite.
 */
export async function runWithRetry<T>(
  request: RetryRequest<T>,
  options: RetryRunnerOptions = {},
): Promise<Readonly<{ result: T; attempts: readonly RetryAttempt[] }>> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const attempts: RetryAttempt[] = [];

  for (let attempt = 1; ; attempt += 1) {
    const startedAt = now();
    const result = await request.send();
    const durationMs = Math.max(0, now() - startedAt);
    const classification = request.classify(result);
    const decision = typeof classification === 'string' ? null : planRetryWithPolicy({
      method: request.method,
      status: classification.status,
      attempt,
      ...(classification.retryAfterMs === undefined ? {} : { retryAfterMs: classification.retryAfterMs }),
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
    }, policy);

    const record: RetryAttempt = {
      attempt,
      outcome: typeof classification === 'string' ? classification : classification.status,
      delayMs: decision?.retry ? decision.delayMs : 0,
      durationMs,
    };
    attempts.push(record);
    options.onAttempt?.(record);
    if (decision === null || !decision.retry) return { result, attempts };
    await sleep(decision.delayMs);
  }
}

/**
 * Maps a client result to what planRetry needs. Timeout and network errors carry no
 * response, so the server may have applied the change: both count as 'timeout'. HTTP
 * errors go to the policy with their status, which only retries the transient ones.
 */
export function classifyIncidentResult<T>(result: IncidentClientResult<T>): AttemptClassification {
  if (result.ok) return 'ok';
  const { kind, status, retryAfterMs } = result.error;
  if (kind === 'timeout' || kind === 'network') return { status: 'timeout' };
  if (status === undefined) return 'final';
  return retryAfterMs === undefined ? { status } : { status, retryAfterMs };
}
