import { coordinateRefresh } from '../src/course-evaluation';
import { createRefreshState, reduceRefreshEvent, reduceRefreshEvents } from '../src/application/session/refreshState';

test('the evaluator delegates to the same real reducer that admits one concurrent refresh', () => {
  const events = [
    { type: 'request401' as const, requestId: 'a', generation: 0 },
    { type: 'request401' as const, requestId: 'b', generation: 0 },
    { type: 'request401' as const, requestId: 'c', generation: 0 },
    { type: 'refreshSucceeded' as const, generation: 1, token: 'synthetic-public-evaluation-token' },
  ];
  expect(coordinateRefresh(events)).toEqual(reduceRefreshEvents(events));
  expect(coordinateRefresh(events)).toMatchObject({ status: 'authenticated', activeGeneration: 1,
    refreshCalls: 1, retriedRequestIds: ['a', 'b', 'c'] });
});

test('duplicate 401 and duplicated completion retry each request at most once', () => {
  const result = reduceRefreshEvents([
    { type: 'request401', requestId: 'a', generation: 0 },
    { type: 'request401', requestId: 'a', generation: 0 },
    { type: 'refreshSucceeded', generation: 1, token: 'synthetic-token-1' },
    { type: 'request401', requestId: 'a', generation: 1 },
    { type: 'refreshSucceeded', generation: 2, token: 'synthetic-token-2' },
  ]);
  expect(result).toEqual({ status: 'authenticated', activeGeneration: 1, refreshCalls: 1,
    retriedRequestIds: ['a'], persistedToken: 'synthetic-token-1' });
});

test('a delayed old 401 uses the newer generation without starting another renewal', () => {
  expect(reduceRefreshEvents([
    { type: 'request401', requestId: 'a', generation: 0 },
    { type: 'refreshSucceeded', generation: 1, token: 'synthetic-token-1' },
    { type: 'request401', requestId: 'late', generation: 0 },
  ])).toMatchObject({ refreshCalls: 1, retriedRequestIds: ['a', 'late'], activeGeneration: 1 });
});

test('the next independent expiry can renew once for its new generation', () => {
  expect(reduceRefreshEvents([
    { type: 'request401', requestId: 'a', generation: 0 },
    { type: 'refreshSucceeded', generation: 1, token: 'synthetic-token-1' },
    { type: 'request401', requestId: 'b', generation: 1 },
    { type: 'refreshSucceeded', generation: 2, token: 'synthetic-token-2' },
  ])).toEqual({ status: 'authenticated', activeGeneration: 2, refreshCalls: 2,
    retriedRequestIds: ['a', 'b'], persistedToken: 'synthetic-token-2' });
});

test('logout blocks pending and future 401 completions from restoring persisted state', () => {
  expect(reduceRefreshEvents([
    { type: 'request401', requestId: 'a', generation: 0 },
    { type: 'logout' },
    { type: 'refreshSucceeded', generation: 1, token: 'synthetic-obsolete-token' },
    { type: 'request401', requestId: 'late', generation: 0 },
  ])).toEqual({ status: 'anonymous', activeGeneration: null, refreshCalls: 1,
    retriedRequestIds: [], persistedToken: null });
});

test('failed refresh clears pending retries and ignores late success or repeated 401', () => {
  expect(reduceRefreshEvents([
    { type: 'request401', requestId: 'a', generation: 4 },
    { type: 'request401', requestId: 'b', generation: 4 },
    { type: 'refreshFailed', generation: 4 },
    { type: 'request401', requestId: 'a', generation: 4 },
    { type: 'refreshSucceeded', generation: 5, token: 'synthetic-obsolete-token' },
  ])).toEqual({ status: 'anonymous', activeGeneration: null, refreshCalls: 1,
    retriedRequestIds: [], persistedToken: null });
});

test('stale completion and invalid generations cannot replace the current pending renewal', () => {
  const initial = createRefreshState(5);
  const pending = reduceRefreshEvent(initial, { type: 'request401', requestId: 'a', generation: 5 });
  expect(reduceRefreshEvent(pending, { type: 'refreshSucceeded', generation: 5, token: 'synthetic-stale' })).toBe(pending);
  expect(reduceRefreshEvent(pending, { type: 'refreshFailed', generation: 4 })).toBe(pending);
  expect(reduceRefreshEvent(pending, { type: 'request401', requestId: 'b', generation: -1 })).toBe(pending);
  expect(reduceRefreshEvent(pending, { type: 'request401', requestId: 'b', generation: 7 })).toBe(pending);
});
