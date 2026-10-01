import type {
  CreateIncidentInput,
  CreatedIncident,
  IncidentClient,
  IncidentClientErrorKind,
  IncidentClientResult,
} from '../../application/incidents/IncidentClient';
import type { IncidentCategory, IncidentStatus } from '../../campusops/contracts';
import { parseRemoteResource } from '../../course-evaluation';
import type { CloudIncident, IncidentDetails } from '../../domain/incidents/CloudIncident';
import { logTelemetry } from '../telemetry/logTelemetry';

type CourseScenario =
  | 'success'
  | 'nullable'
  | 'malformed'
  | 'slow'
  | 'server_error'
  | 'rate_limited'
  | 'timeout_after_commit';

export type CourseIncidentClientOptions = Readonly<{
  baseUrl?: string;
  actorId?: string;
  accessToken?: string;
  scenario?: CourseScenario;
  timeoutMs?: number;
  transport?: typeof fetch;
}>;

type JsonResponse = Readonly<{ status: number; body: unknown }>;

const categories: readonly IncidentCategory[] = [
  'electrical', 'laboratory', 'water', 'connectivity', 'equipment', 'safety', 'maintenance',
];
const statuses: readonly IncidentStatus[] = [
  'open', 'assigned', 'in_progress', 'resolved', 'closed',
];
const priorities: readonly IncidentDetails['priority'][] = ['low', 'medium', 'high'];

function ok<T>(value: T): IncidentClientResult<T> {
  return { ok: true, value };
}

function fail<T>(kind: IncidentClientErrorKind, status?: number): IncidentClientResult<T> {
  return { ok: false, error: status === undefined ? { kind } : { kind, status } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCategory(value: unknown): value is IncidentCategory {
  return categories.some((category) => category === value);
}

function isStatus(value: unknown): value is IncidentStatus {
  return statuses.some((status) => status === value);
}

function isPriority(value: unknown): value is IncidentDetails['priority'] {
  return priorities.some((priority) => priority === value);
}

/** The shared parser owns the envelope; this mapper validates every field used by the app. */
function decodeIncident(input: unknown): CloudIncident | null {
  const parsed = parseRemoteResource(input);
  if (!parsed.ok) return null;

  const { id, version, status, payload } = parsed.value;
  if (!isNonemptyString(id) || !isStatus(status)) return null;
  if (payload === null) return { id, version, status, details: null };

  const { category, description, location, reporterId, assignedTechnicianId, priority } = payload;
  if (
    !isCategory(category) || !isNonemptyString(description) || !isNonemptyString(location)
    || !isNonemptyString(reporterId) || !isPriority(priority)
    || (assignedTechnicianId !== null && !isNonemptyString(assignedTechnicianId))
  ) return null;

  return {
    id,
    version,
    status,
    details: { category, description, location, reporterId, assignedTechnicianId, priority },
  };
}

function statusError(status: number): IncidentClientErrorKind {
  if (status >= 500) return 'server';
  switch (status) {
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 400:
    case 422: return 'invalid_input';
    case 429: return 'rate_limited';
    default: return 'http';
  }
}

/** HTTP adapter for the local, synthetic CampusOps backend. */
export class CourseIncidentClient implements IncidentClient {
  private readonly baseUrl: string;
  private readonly actorId: string;
  private readonly accessToken: string;
  private readonly scenario: CourseScenario;
  private readonly timeoutMs: number;
  private readonly transport: typeof fetch;

  public constructor(options: CourseIncidentClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? 'http://127.0.0.1:4310').replace(/\/+$/, '');
    this.actorId = options.actorId ?? 'reporter-1';
    this.accessToken = options.accessToken ?? 'course-valid-token';
    this.scenario = options.scenario ?? 'success';
    this.timeoutMs = options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs : 3000;
    this.transport = options.transport ?? fetch;
  }

  public async listIncidents(): Promise<IncidentClientResult<readonly CloudIncident[]>> {
    const response = await this.request('/v1/incidents', 'GET', 'list');
    if (!response.ok) return response;
    if (response.value.status !== 200 || !isRecord(response.value.body) || !Array.isArray(response.value.body.items)) {
      return this.contractFailure('list');
    }

    const incidents: CloudIncident[] = [];
    const seenIds = new Set<string>();
    for (const item of response.value.body.items) {
      const incident = decodeIncident(item);
      if (incident === null || seenIds.has(incident.id)) return this.contractFailure('list');
      incidents.push(incident);
      seenIds.add(incident.id);
    }
    return ok(incidents);
  }

  public async getIncidentDetail(incidentId: string): Promise<IncidentClientResult<CloudIncident>> {
    if (!isNonemptyString(incidentId)) return fail('invalid_input');
    const response = await this.request(`/v1/incidents/${encodeURIComponent(incidentId)}`, 'GET', 'detail');
    if (!response.ok) return response;
    const incident = decodeIncident(response.value.body);
    if (response.value.status !== 200 || incident === null || incident.id !== incidentId) {
      return this.contractFailure('detail');
    }
    return ok(incident);
  }

  public async createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<IncidentClientResult<CreatedIncident>> {
    if (
      !isRecord(input) || !isCategory(input.category)
      || !isNonemptyString(input.description) || !isNonemptyString(input.location)
      || !isNonemptyString(idempotencyKey) || idempotencyKey.length < 8
    ) return fail('invalid_input');

    const body = JSON.stringify({
      category: input.category,
      description: input.description.trim(),
      location: input.location.trim(),
    });
    const response = await this.request('/v1/incidents', 'POST', 'create', body, idempotencyKey);
    if (!response.ok) return response;
    if ((response.value.status !== 200 && response.value.status !== 201) || !isRecord(response.value.body)) {
      return this.contractFailure('create');
    }

    const { incident: remoteIncident, operationId, duplicate } = response.value.body;
    const incident = decodeIncident(remoteIncident);
    if (
      incident === null || operationId !== idempotencyKey || typeof duplicate !== 'boolean'
      || (response.value.status === 201 && duplicate)
      || (response.value.status === 200 && !duplicate)
    ) return this.contractFailure('create');
    return ok({ incident, operationId, duplicate });
  }

  private contractFailure<T>(operation: string): IncidentClientResult<T> {
    logTelemetry('incident_client_error', { operation, kind: 'contract' });
    return fail('contract');
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    operation: string,
    body?: string,
    idempotencyKey?: string,
  ): Promise<IncidentClientResult<JsonResponse>> {
    const controller = new AbortController();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'X-Course-Actor': this.actorId,
      'X-Course-Scenario': this.scenario,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;

    const fetchAndDecode = async (): Promise<IncidentClientResult<JsonResponse>> => {
      let response: Response;
      try {
        response = await this.transport(`${this.baseUrl}${path}`, {
          method,
          headers,
          signal: controller.signal,
          ...(body === undefined ? {} : { body }),
        });
      } catch (error) {
        return fail(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network');
      }
      if (!response.ok) return fail(statusError(response.status), response.status);
      try {
        return ok({ status: response.status, body: await response.json() as unknown });
      } catch {
        return fail('contract');
      }
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<IncidentClientResult<JsonResponse>>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(fail('timeout'));
      }, this.timeoutMs);
    });
    const result = await Promise.race([fetchAndDecode(), timeout]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (!result.ok) {
      logTelemetry('incident_client_error', {
        operation,
        kind: result.error.kind,
        status: result.error.status ?? null,
      });
    }
    return result;
  }
}
