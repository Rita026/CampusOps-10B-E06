import type {
  IssuedSession, LoginSession, SessionGateway, SessionResult, SessionRole,
} from '../../application/session/SessionAccess';

type GatewayOptions = Readonly<{
  baseUrl: string;
  transport?: typeof fetch;
  timeoutMs?: number;
  scenario?: string;
}>;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issuedSession(value: unknown): IssuedSession | null {
  if (!object(value) || typeof value.accessToken !== 'string' || !value.accessToken.trim()
    || typeof value.refreshToken !== 'string' || !value.refreshToken.trim()
    || typeof value.expiresIn !== 'number' || !Number.isFinite(value.expiresIn)
    || value.expiresIn <= 0 || value.expiresIn > 86400) return null;
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresIn: value.expiresIn };
}

function role(value: unknown): value is SessionRole {
  return value === 'reporter' || value === 'technician' || value === 'coordinator';
}

/** Local course fixture authentication; actor selection is not institutional login. */
export class CourseSessionGateway implements SessionGateway {
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(private readonly options: GatewayOptions) {
    this.transport = options.transport ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  public async login(actorId: string): Promise<SessionResult<LoginSession>> {
    if (!actorId.trim()) return { ok: false, error: { kind: 'invalid_input' } };
    const response = await this.request('/v1/session/login', { actorId });
    if (!response.ok) return response;
    const tokens = issuedSession(response.value);
    if (!tokens || !object(response.value) || response.value.actorId !== actorId || !role(response.value.role)) {
      return { ok: false, error: { kind: 'contract' } };
    }
    return { ok: true, value: { ...tokens, actor: { id: actorId, role: response.value.role } } };
  }

  public async refresh(refreshToken: string): Promise<SessionResult<IssuedSession>> {
    const response = await this.request('/v1/session/refresh', { refreshToken });
    if (!response.ok) return response;
    const tokens = issuedSession(response.value);
    return tokens ? { ok: true, value: tokens } : { ok: false, error: { kind: 'contract' } };
  }

  private async request(path: string, body: Record<string, string>): Promise<SessionResult<unknown>> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<SessionResult<unknown>>((resolve) => {
      timeout = setTimeout(() => {
        resolve({ ok: false, error: { kind: 'timeout' } });
        controller.abort();
      }, this.timeoutMs);
    });
    const request = (async (): Promise<SessionResult<unknown>> => {
      try {
        const response = await this.transport(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Course-Scenario': this.options.scenario ?? 'success' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) return { ok: false, error: { kind: response.status === 401 ? 'unauthorized' : 'network' } };
        try {
          return { ok: true, value: await response.json() as unknown };
        } catch {
          return { ok: false, error: { kind: 'contract' } };
        }
      } catch {
        return { ok: false, error: { kind: 'network' } };
      }
    })();
    try {
      return await Promise.race([request, expired]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
