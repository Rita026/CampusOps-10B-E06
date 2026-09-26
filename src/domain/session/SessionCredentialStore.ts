/** Only session credentials belong in the device's protected key-value store. */
export type SessionCredentials = Readonly<{
  accessToken: string;
  refreshToken: string;
}>;

export interface SessionCredentialStore {
  save(credentials: SessionCredentials): Promise<void>;
  load(): Promise<SessionCredentials | null>;
  clear(): Promise<void>;
}
