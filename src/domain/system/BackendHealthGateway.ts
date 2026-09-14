/** Port for the reproducible backend-status indicator in the initial screen. */
export interface BackendHealthGateway {
  check(): Promise<void>;
}
