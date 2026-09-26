import { logTelemetry } from '../infrastructure/telemetry/logTelemetry';

export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

const DEFAULT_URL = 'http://127.0.0.1:4310';
const PUBLIC_HEALTH_ERROR = 'No fue posible verificar la disponibilidad del servicio.';

function safeStatus(status: number): number | 'unknown' {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown';
}

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
): Promise<BackendHealth> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`);
  } catch {
    logTelemetry('backend_health_network_error', { phase: 'request' });
    throw new Error(PUBLIC_HEALTH_ERROR);
  }
  if (!response.ok) {
    logTelemetry('backend_health_failed', { status: safeStatus(response.status) });
    throw new Error(PUBLIC_HEALTH_ERROR);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    logTelemetry('backend_health_invalid_json', { status: safeStatus(response.status) });
    throw new Error(PUBLIC_HEALTH_ERROR);
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ok' in payload) ||
    payload.ok !== true ||
    !('service' in payload) ||
    payload.service !== 'dmi-controlled-backend' ||
    !('contractVersion' in payload) ||
    payload.contractVersion !== 1
  ) {
    logTelemetry('backend_health_contract_mismatch', { status: safeStatus(response.status) });
    throw new Error(PUBLIC_HEALTH_ERROR);
  }
  return payload as BackendHealth;
}
