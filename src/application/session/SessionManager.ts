import type { SessionCredentialStore, SessionCredentials } from '../../domain/session/SessionCredentialStore';
import type {
  RequestCredentials, SessionAccess, SessionActor, SessionClock, SessionGateway, SessionResult, SessionSnapshot,
} from './SessionAccess';
import { createRefreshState, reduceRefreshEvent, type RefreshState } from './refreshState';

type SessionOptions = Readonly<{
  gateway: SessionGateway;
  credentialStore: SessionCredentialStore;
  clock?: SessionClock;
}>;

const STORAGE_ERROR = 'No fue posible borrar la sesión segura. Intenta cerrar sesión otra vez.';

/** One session owner, one refresh promise, and one ordered protected-storage queue. */
export class SessionManager implements SessionAccess {
  private snapshot: SessionSnapshot = { status: 'anonymous', actor: null, generation: 0 };
  private credentials: SessionCredentials | null = null;
  private expiresAt = 0;
  private sessionStartGeneration = 0;
  private refreshFlight: Promise<RequestCredentials | null> | null = null;
  private storageQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly clock: SessionClock;
  private refreshState: RefreshState = createRefreshState();
  private requestSequence = 0;

  public constructor(private readonly options: SessionOptions) {
    this.clock = options.clock ?? { now: () => Date.now() };
  }

  public getSnapshot = (): SessionSnapshot => {
    this.expireIfNeeded(false);
    return this.snapshot;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  public async login(actorId: string): Promise<SessionResult> {
    if (!actorId.trim()) return { ok: false, error: { kind: 'invalid_input' } };
    const generation = this.snapshot.generation + 1;
    this.credentials = null;
    this.refreshFlight = null;
    this.expiresAt = 0;
    this.refreshState = reduceRefreshEvent(this.refreshState, { type: 'logout' });
    this.publish('authenticating', null, generation);
    try {
      await this.storage(() => this.options.credentialStore.clear());
    } catch {
      if (this.isCurrent(generation)) this.publish('anonymous', null, generation);
      return { ok: false, error: { kind: this.isCurrent(generation) ? 'storage' : 'obsolete' } };
    }
    if (!this.isCurrent(generation)) return { ok: false, error: { kind: 'obsolete' } };
    let response: Awaited<ReturnType<SessionGateway['login']>>;
    try {
      response = await this.options.gateway.login(actorId);
    } catch {
      response = { ok: false, error: { kind: 'network' } };
    }
    if (!this.isCurrent(generation)) return { ok: false, error: { kind: 'obsolete' } };
    if (!response.ok) {
      this.publish('anonymous', null, generation);
      return response;
    }
    const value = response.value;
    try {
      await this.storage(async () => {
        if (this.isCurrent(generation)) await this.options.credentialStore.save({
          accessToken: value.accessToken, refreshToken: value.refreshToken,
        });
      });
    } catch {
      const loginStillCurrent = this.isCurrent(generation);

      if (loginStillCurrent) {
        await this.revoke(generation);
      }

      return {
        ok: false,
        error: { kind: loginStillCurrent ? 'storage' : 'obsolete' },
      };
    }

    if (!this.isCurrent(generation)) return { ok: false, error: { kind: 'obsolete' } };
    this.credentials = { accessToken: value.accessToken, refreshToken: value.refreshToken };
    this.expiresAt = this.clock.now() + value.expiresIn * 1000;
    this.sessionStartGeneration = generation;
    this.refreshState = createRefreshState(generation);
    this.publish('authenticated', value.actor, generation);
    return { ok: true, value: undefined };
  }

  public async logout(): Promise<void> {
    const generation = this.snapshot.generation + 1;
    this.credentials = null;
    this.refreshFlight = null;
    this.expiresAt = 0;
    this.refreshState = reduceRefreshEvent(this.refreshState, { type: 'logout' });
    this.publish('logging_out', null, generation);
    try {
      // A save already in progress must finish before deletion; its late response cannot restore state.
      await this.storage(() => this.options.credentialStore.clear());
    } catch {
      throw new Error(STORAGE_ERROR);
    }
    if (this.isCurrent(generation)) this.publish('anonymous', null, generation);
  }

  public async getRequestCredentials(): Promise<RequestCredentials | null> {
    this.expireIfNeeded(true);
    const credentials = this.requestCredentials();
    if (!credentials) return null;
    return this.snapshot.status === 'authenticated' ? credentials : this.coordinateRefresh(credentials);
  }

  public coordinateRefresh(credentials: RequestCredentials): Promise<RequestCredentials | null> {
    const current = this.requestCredentials();
    if (!current || credentials.actorId !== current.actorId
      || credentials.generation < this.sessionStartGeneration || credentials.generation > current.generation) {
      return Promise.resolve(null);
    }
    // The fixture can return the same access-token string: generation identifies the renewed version.
    if (credentials.generation < current.generation) return Promise.resolve(current);
    if (credentials.accessToken !== current.accessToken) return Promise.resolve(null);
    this.refreshState = reduceRefreshEvent(this.refreshState, {
      type: 'request401', generation: current.generation, requestId: `request-${++this.requestSequence}`,
    });
    if (this.refreshFlight) return this.refreshFlight;
    if (this.refreshState.pendingGeneration !== current.generation) return Promise.resolve(null);
    this.publish('expired', this.snapshot.actor, current.generation);
    this.publish('refreshing', this.snapshot.actor, current.generation);
    const refreshToken = this.credentials!.refreshToken;
    const flight = this.renew(current, refreshToken);
    this.refreshFlight = flight;
    void flight.finally(() => {
      if (this.refreshFlight === flight) this.refreshFlight = null;
    }).catch(() => undefined);
    return flight;
  }

  public async invalidate(credentials: RequestCredentials): Promise<void> {
    const current = this.requestCredentials();
    if (current && current.generation === credentials.generation && current.actorId === credentials.actorId
      && current.accessToken === credentials.accessToken) await this.revoke(current.generation);
  }

  private async renew(current: RequestCredentials, refreshToken: string): Promise<RequestCredentials | null> {
    let response: Awaited<ReturnType<SessionGateway['refresh']>>;
    try {
      response = await this.options.gateway.refresh(refreshToken);
    } catch {
      response = { ok: false, error: { kind: 'network' } };
    }
    if (!this.isCurrent(current.generation)) return null;
    if (!response.ok) {
      this.refreshState = reduceRefreshEvent(this.refreshState, { type: 'refreshFailed', generation: current.generation });
      await this.revoke(current.generation);
      return null;
    }
    try {
      await this.storage(async () => {
        if (this.isCurrent(current.generation)) await this.options.credentialStore.save({
          accessToken: response.value.accessToken, refreshToken: response.value.refreshToken,
        });
      });
    } catch {
      if (this.isCurrent(current.generation)) await this.revoke(current.generation);
      return null;
    }
    if (!this.isCurrent(current.generation)) return null;
    const generation = current.generation + 1;
    this.credentials = { accessToken: response.value.accessToken, refreshToken: response.value.refreshToken };
    this.expiresAt = this.clock.now() + response.value.expiresIn * 1000;
    this.refreshState = reduceRefreshEvent(this.refreshState, { type: 'refreshSucceeded', generation });
    this.publish('authenticated', this.snapshot.actor, generation);
    return this.requestCredentials();
  }

  private async revoke(generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return;
    this.credentials = null;
    this.expiresAt = 0;
    this.refreshFlight = null;
    this.refreshState = reduceRefreshEvent(this.refreshState, { type: 'logout' });
    this.publish('anonymous', null, generation + 1);
    try {
      await this.storage(() => this.options.credentialStore.clear());
    } catch {
      // Authorization still fails closed. Expose pending cleanup so logout can retry deletion;
      // a refresh failure must not escape the typed incident-client result as an exception.
      if (this.isCurrent(generation + 1)) this.publish('logging_out', null, generation + 1);
    }
  }

  private requestCredentials(): RequestCredentials | null {
    return this.credentials && this.snapshot.actor ? {
      accessToken: this.credentials.accessToken,
      actorId: this.snapshot.actor.id,
      generation: this.snapshot.generation,
    } : null;
  }

  private isCurrent(generation: number): boolean {
    return this.snapshot.generation === generation;
  }

  private expireIfNeeded(notify: boolean): void {
    if (this.snapshot.status === 'authenticated' && this.clock.now() >= this.expiresAt) {
      this.snapshot = { ...this.snapshot, status: 'expired' };
      if (notify) this.notify();
    }
  }

  private publish(status: SessionSnapshot['status'], actor: SessionActor | null, generation: number): void {
    this.snapshot = { status, actor, generation };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private storage(operation: () => Promise<void>): Promise<void> {
    const queued = this.storageQueue.then(operation);
    this.storageQueue = queued.catch(() => undefined);
    return queued;
  }
}
