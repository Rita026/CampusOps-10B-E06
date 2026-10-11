import type { AuthEvent } from '../../course-evaluation/contracts';

export type RefreshSummary = Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}>;

export type RefreshState = RefreshSummary & Readonly<{
  pendingGeneration: number | null;
  pendingRequestIds: readonly string[];
  blocked: boolean;
}>;

export function createRefreshState(activeGeneration: number | null = null): RefreshState {
  return {
    status: activeGeneration === null ? 'anonymous' : 'authenticated',
    activeGeneration,
    refreshCalls: 0,
    retriedRequestIds: [],
    persistedToken: null,
    pendingGeneration: null,
    pendingRequestIds: [],
    blocked: false,
  };
}

function appendUnique(values: readonly string[], value: string | undefined): readonly string[] {
  return value && !values.includes(value) ? [...values, value] : values;
}

/** Pure event policy shared by the evaluator and the running SessionManager. */
export function reduceRefreshEvent(state: RefreshState, event: AuthEvent): RefreshState {
  switch (event.type) {
    case 'request401': {
      if (state.blocked || (event.requestId && state.retriedRequestIds.includes(event.requestId))) return state;
      const generation = event.generation ?? state.activeGeneration ?? state.pendingGeneration ?? 0;
      if (!Number.isInteger(generation) || generation < 0) return state;
      if (state.activeGeneration !== null && generation < state.activeGeneration) {
        return { ...state, retriedRequestIds: appendUnique(state.retriedRequestIds, event.requestId) };
      }
      if (state.activeGeneration !== null && generation > state.activeGeneration) return state;
      if (state.pendingGeneration !== null && generation !== state.pendingGeneration) return state;
      return {
        ...state,
        pendingGeneration: generation,
        pendingRequestIds: appendUnique(state.pendingRequestIds, event.requestId),
        refreshCalls: state.refreshCalls + (state.pendingGeneration === null ? 1 : 0),
      };
    }
    case 'refreshSucceeded': {
      if (state.blocked || state.pendingGeneration === null) return state;
      const generation = event.generation ?? state.pendingGeneration + 1;
      if (!Number.isInteger(generation) || generation <= state.pendingGeneration) return state;
      return {
        ...state,
        status: 'authenticated',
        activeGeneration: generation,
        persistedToken: event.token ?? state.persistedToken,
        retriedRequestIds: [...new Set([...state.retriedRequestIds, ...state.pendingRequestIds])],
        pendingGeneration: null,
        pendingRequestIds: [],
      };
    }
    case 'refreshFailed':
      if (state.blocked || state.pendingGeneration === null
        || (event.generation !== undefined && event.generation !== state.pendingGeneration)) return state;
      return { ...state, status: 'anonymous', activeGeneration: null, persistedToken: null,
        pendingGeneration: null, pendingRequestIds: [], blocked: true };
    case 'logout':
      return { ...state, status: 'anonymous', activeGeneration: null, persistedToken: null,
        pendingGeneration: null, pendingRequestIds: [], blocked: true };
  }
}

export function reduceRefreshEvents(events: readonly AuthEvent[]): RefreshSummary {
  const state = events.reduce(reduceRefreshEvent, createRefreshState());
  return {
    status: state.status,
    activeGeneration: state.activeGeneration,
    refreshCalls: state.refreshCalls,
    retriedRequestIds: state.retriedRequestIds,
    persistedToken: state.persistedToken,
  };
}
