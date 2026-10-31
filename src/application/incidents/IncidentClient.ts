import type { IncidentCategory } from '../../campusops/contracts';
import type { CloudIncident } from '../../domain/incidents/CloudIncident';
import type { IncidentActionInput } from './incidentAuthorization';

export type IncidentClientErrorKind =
  | 'contract'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_input'
  | 'conflict'
  | 'http';

export type IncidentClientError = Readonly<{
  kind: IncidentClientErrorKind;
  status?: number;
  /** Wait requested by the server with Retry-After (429/503), in milliseconds. */
  retryAfterMs?: number;
}>;

export type IncidentClientResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: IncidentClientError }>;

export type CreateIncidentInput = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
}>;

export type CreatedIncident = Readonly<{
  incident: CloudIncident;
  operationId: string;
  duplicate: boolean;
}>;

/** UI-facing port. Transport and remote DTOs stay in infrastructure. */
export interface IncidentClient {
  listIncidents(): Promise<IncidentClientResult<readonly CloudIncident[]>>;
  getIncidentDetail(incidentId: string): Promise<IncidentClientResult<CloudIncident>>;
  createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<IncidentClientResult<CreatedIncident>>;
}

export interface IncidentActionClient extends IncidentClient {
  applyAction(
    incidentId: string,
    input: IncidentActionInput,
    idempotencyKey: string,
  ): Promise<IncidentClientResult<CreatedIncident>>;
}
