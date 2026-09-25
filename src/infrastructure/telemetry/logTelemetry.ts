import { redactForTelemetry } from '../../course-evaluation';

export function logTelemetry(event: string, payload: unknown): void {
  const safePayload = redactForTelemetry(payload);
  console.log(`[telemetry] ${event}`, safePayload);
}