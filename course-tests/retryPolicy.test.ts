/** @jest-environment node */
import {
  DEFAULT_RETRY_POLICY,
  parseRetryAfterMs,
  planRetryWithPolicy,
  type RetryPolicyConfig,
} from '../src/application/resilience/retryPolicy';
import { classifyIncidentResult, runWithRetry } from '../src/application/resilience/runWithRetry';
import { planRetry } from '../src/course-evaluation';

const KEY = 'resolve-campus-inc-001-op-1';

describe('planRetry: limits', () => {
  test('retries attempts 1 to 3 and never from attempt 4, for GET and keyed POST', () => {
    for (const method of ['GET', 'POST'] as const) {
      const decisions = [1, 2, 3, 4, 5].map((attempt) => planRetry({ method, status: 503, attempt, idempotencyKey: KEY }).retry);
      expect(decisions).toEqual([true, true, true, false, false]);
    }
  });

  test('progressive backoff 500, 1000, 2000 ms without Retry-After', () => {
    expect([1, 2, 3].map((attempt) => planRetry({ method: 'GET', status: 'timeout', attempt }).delayMs)).toEqual([500, 1000, 2000]);
  });

  test('a non-integer or non-positive attempt is not retried', () => {
    for (const attempt of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planRetry({ method: 'GET', status: 'timeout', attempt })).toEqual({
        retry: false, delayMs: 0, requiresStableIdempotencyKey: false,
      });
    }
  });

  test('final answers (4xx other than 408/429) are not retried', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(planRetry({ method: 'POST', status, attempt: 1, idempotencyKey: KEY })).toEqual({
        retry: false, delayMs: 0, requiresStableIdempotencyKey: false,
      });
    }
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(planRetry({ method: 'GET', status, attempt: 1 }).retry).toBe(true);
    }
  });
});

describe('planRetry: Retry-After', () => {
  test('a valid Retry-After replaces the backoff, even when it is shorter or 0', () => {
    expect(planRetry({ method: 'GET', status: 429, attempt: 3, retryAfterMs: 800 }).delayMs).toBe(800);
    expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 0 }).delayMs).toBe(0);
    expect(planRetry({ method: 'GET', status: 503, attempt: 1, retryAfterMs: 1500.2 }).delayMs).toBe(1501);
  });

  test('an invalid Retry-After falls back to the backoff instead of an infinite or negative wait', () => {
    for (const retryAfterMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planRetry({ method: 'GET', status: 429, attempt: 2, retryAfterMs })).toEqual({
        retry: true, delayMs: 1000, requiresStableIdempotencyKey: false,
      });
    }
  });

  test('a Retry-After above the 10 s limit reports the failure instead of waiting', () => {
    expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 10_000 }).retry).toBe(true);
    expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 10_001 })).toEqual({
      retry: false, delayMs: 0, requiresStableIdempotencyKey: false,
    });
  });

  test('parses delay-seconds and HTTP-date and ignores anything else', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(parseRetryAfterMs('1', now)).toBe(1000);
    expect(parseRetryAfterMs(' 0 ', now)).toBe(0);
    expect(parseRetryAfterMs('Fri, 30 Oct 2026 12:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfterMs('Fri, 30 Oct 2026 11:00:00 GMT', now)).toBe(0);
    for (const value of [null, undefined, '', '-1', '1.5', 'pronto']) {
      expect(parseRetryAfterMs(value, now)).toBeUndefined();
    }
  });
});

describe('planRetry: POST identity', () => {
  test('a POST without a stable key, or with one shorter than 8 characters, is not repeated', () => {
    for (const idempotencyKey of [undefined, '', '       ', 'op-1']) {
      expect(planRetry({ method: 'POST', status: 'timeout', attempt: 1, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) })).toEqual({
        retry: false, delayMs: 0, requiresStableIdempotencyKey: true,
      });
    }
  });

  test('a GET is safe to repeat and does not need a key', () => {
    expect(planRetry({ method: 'GET', status: 'timeout', attempt: 1 })).toEqual({
      retry: true, delayMs: 500, requiresStableIdempotencyKey: false,
    });
  });
});

describe('configurable limits', () => {
  test('a stricter policy is applied and the published limit cannot be raised', () => {
    const strict: RetryPolicyConfig = { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 150, maxRetryAfterMs: 1000 };
    expect(planRetryWithPolicy({ method: 'GET', status: 503, attempt: 1 }, strict)).toMatchObject({ retry: true, delayMs: 100 });
    expect(planRetryWithPolicy({ method: 'GET', status: 503, attempt: 2 }, strict).retry).toBe(false);

    for (const config of [
      { ...DEFAULT_RETRY_POLICY, maxAttempts: 5 },
      { ...DEFAULT_RETRY_POLICY, maxAttempts: 0 },
      { ...DEFAULT_RETRY_POLICY, maxDelayMs: Number.POSITIVE_INFINITY },
      { ...DEFAULT_RETRY_POLICY, baseDelayMs: 5000, maxDelayMs: 1000 },
      { ...DEFAULT_RETRY_POLICY, maxRetryAfterMs: Number.NaN },
    ]) {
      expect(() => planRetryWithPolicy({ method: 'GET', status: 503, attempt: 1 }, config)).toThrow();
    }
  });
});

describe('runWithRetry', () => {
  const noWait = (delays: number[]) => async (ms: number) => { delays.push(ms); };

  test('a request that always fails is sent 4 times at most, with finite waits', async () => {
    const delays: number[] = [];
    const send = jest.fn(async () => ({ ok: false as const, error: { kind: 'server' as const, status: 503 } }));
    const { result, attempts } = await runWithRetry(
      { method: 'POST', idempotencyKey: KEY, send, classify: classifyIncidentResult },
      { sleep: noWait(delays) },
    );
    expect(send).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([500, 1000, 2000]);
    expect(attempts.map((item) => [item.attempt, item.outcome, item.delayMs])).toEqual([
      [1, 503, 500], [2, 503, 1000], [3, 503, 2000], [4, 503, 0],
    ]);
    expect(result).toEqual({ ok: false, error: { kind: 'server', status: 503 } });
  });

  test('stops at the first success and sends Retry-After from the error', async () => {
    const delays: number[] = [];
    const results = [
      { ok: false as const, error: { kind: 'rate_limited' as const, status: 429, retryAfterMs: 1000 } },
      { ok: true as const, value: 'confirmado' },
    ];
    const send = jest.fn(async () => results.shift()!);
    const { result, attempts } = await runWithRetry({ method: 'GET', send, classify: classifyIncidentResult }, { sleep: noWait(delays) });
    expect(send).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1000]);
    expect(attempts.map((item) => item.outcome)).toEqual([429, 'ok']);
    expect(result).toEqual({ ok: true, value: 'confirmado' });
  });

  test('timeout and network are retried as "no response"; local and contract errors are final', async () => {
    expect(classifyIncidentResult({ ok: false, error: { kind: 'network' } })).toEqual({ status: 'timeout' });
    expect(classifyIncidentResult({ ok: false, error: { kind: 'timeout' } })).toEqual({ status: 'timeout' });
    expect(classifyIncidentResult({ ok: false, error: { kind: 'contract' } })).toBe('final');
    expect(classifyIncidentResult({ ok: false, error: { kind: 'invalid_input' } })).toBe('final');

    const send = jest.fn(async () => ({ ok: false as const, error: { kind: 'invalid_input' as const } }));
    const { attempts } = await runWithRetry({ method: 'POST', idempotencyKey: KEY, send, classify: classifyIncidentResult }, { sleep: noWait([]) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([expect.objectContaining({ attempt: 1, outcome: 'final', delayMs: 0 })]);
  });

  test('a POST without a key is sent once even if the failure is transient', async () => {
    const send = jest.fn(async () => ({ ok: false as const, error: { kind: 'timeout' as const } }));
    const { attempts } = await runWithRetry({ method: 'POST', send, classify: classifyIncidentResult }, { sleep: noWait([]) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);
  });

  test('attempt records carry only timing and outcome (nothing to sanitize)', async () => {
    const seen: unknown[] = [];
    let clock = 1000;
    await runWithRetry(
      { method: 'GET', send: async () => { clock += 40; return { ok: true as const, value: { email: 'x@campus.test' } }; }, classify: classifyIncidentResult },
      { now: () => clock, onAttempt: (attempt) => seen.push(attempt) },
    );
    expect(seen).toEqual([{ attempt: 1, outcome: 'ok', delayMs: 0, durationMs: 40 }]);
  });
});
