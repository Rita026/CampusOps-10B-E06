import type { SessionCredentials } from '../../domain/session/SessionCredentialStore';

export type SessionRole = 'reporter' | 'technician' | 'coordinator';
export type SessionActor = Readonly<{ id: string; role: SessionRole }>;
export type SessionStatus = 'anonymous' | 'authenticating' | 'authenticated' | 'expired' | 'refreshing' | 'logging_out';

/** UI-safe state: credentials are deliberately absent from snapshots and listeners. */
export type SessionSnapshot = Readonly<{
  status: SessionStatus;
  actor: SessionActor | null;
  generation: number;
}>;

/** Only the authenticated transport receives this short-lived request snapshot. */
export type RequestCredentials = Readonly<{ accessToken: string; actorId: string; generation: number }>;
export type SessionErrorKind = 'invalid_input' | 'unauthorized' | 'network' | 'timeout' | 'contract' | 'storage' | 'obsolete';
export type SessionResult<T = undefined> = Readonly<{ ok: true; value: T } | { ok: false; error: { kind: SessionErrorKind } }>;
export type IssuedSession = SessionCredentials & Readonly<{ expiresIn: number }>;
export type LoginSession = IssuedSession & Readonly<{ actor: SessionActor }>;

export interface SessionGateway {
  login(actorId: string): Promise<SessionResult<LoginSession>>;
  refresh(refreshToken: string): Promise<SessionResult<IssuedSession>>;
}

export interface SessionClock {
  now(): number;
}

export interface SessionAccess {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  login(actorId: string): Promise<SessionResult>;
  logout(): Promise<void>;
  getRequestCredentials(): Promise<RequestCredentials | null>;
  coordinateRefresh(credentials: RequestCredentials): Promise<RequestCredentials | null>;
  invalidate(credentials: RequestCredentials): Promise<void>;
}
