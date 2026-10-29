import type {
  GeocodingGateway,
  GeocodingOutcome,
  GeocodingResult,
} from '../../domain/location/GeocodingGateway';

export type CourseGeocodingGatewayOptions = Readonly<{
  baseUrl?: string;
  actorId?: string;
  accessToken?: string;
  scenario?: string;
  timeoutMs?: number;
  transport?: typeof fetch;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseResult(body: unknown): GeocodingResult | null {
  if (!isRecord(body)) return null;
  const { label, latitude, longitude } = body;
  if (!isNonemptyString(label)) return null;
  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) return null;
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) return null;
  return { label: label.trim(), latitude, longitude };
}

/** Doble didáctico: GET /v1/geocoding?q=... (no proveedor real de mapas). */
export class CourseGeocodingGateway implements GeocodingGateway {
  private readonly baseUrl: string;
  private readonly actorId: string;
  private readonly accessToken: string;
  private readonly scenario: string;
  private readonly timeoutMs: number;
  private readonly transport: typeof fetch;

  public constructor(options: CourseGeocodingGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? 'http://127.0.0.1:4310').replace(/\/+$/, '');
    this.actorId = options.actorId ?? 'reporter-1';
    this.accessToken = options.accessToken ?? 'course-valid-token';
    this.scenario = options.scenario ?? 'success';
    this.timeoutMs = options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 3000;
    this.transport = options.transport ?? fetch;
  }

  public async lookup(query: string): Promise<GeocodingOutcome> {
    if (!isNonemptyString(query)) {
      return { ok: false, error: { kind: 'invalid_query' } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}/v1/geocoding?q=${encodeURIComponent(query.trim())}`;

    try {
      const response = await this.transport(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'X-Course-Actor': this.actorId,
          'X-Course-Scenario': this.scenario,
        },
        signal: controller.signal,
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (response.status === 429) {
        return { ok: false, error: { kind: 'rate_limited', status: 429 } };
      }
      if (response.status >= 500) {
        return { ok: false, error: { kind: 'server', status: response.status } };
      }
      if (response.status === 422 || response.status === 400) {
        return { ok: false, error: { kind: 'invalid_query', status: response.status } };
      }
      if (response.status !== 200) {
        return { ok: false, error: { kind: 'http', status: response.status } };
      }

      const parsed = parseResult(body);
      if (parsed === null) {
        return { ok: false, error: { kind: 'incomplete' } };
      }
      return { ok: true, value: parsed };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, error: { kind: 'timeout' } };
      }
      return { ok: false, error: { kind: 'network' } };
    } finally {
      clearTimeout(timer);
    }
  }
}