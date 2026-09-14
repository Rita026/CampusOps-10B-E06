import type { BackendHealthGateway } from '../../domain/system/BackendHealthGateway';

export type CheckBackendHealth = () => Promise<void>;

/** The UI asks for a status check without knowing which backend provides it. */
export function createBackendHealthCheck(gateway: BackendHealthGateway): CheckBackendHealth {
  return () => gateway.check();
}
