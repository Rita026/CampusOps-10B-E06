import type { IncidentLocation } from '../../campusops/contracts';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Acepta solo un objeto con label y coordenadas válidas.
 * Cualquier otra cosa (null, error, incompleto, fuera de rango) → ubicación manual.
 * No inventa coordenadas.
 */
export function selectIncidentLocationFromProvider(
  provider: unknown,
  manualLabel: string,
): IncidentLocation {
  const manual = manualLabel.trim();
  if (!isNonemptyString(manual)) {
    // Contrato de evaluación: manualLabel no vacío en los tests; si llegara vacío, aún así no inventamos coords.
    return { source: 'manual', label: manualLabel };
  }

  if (provider === null || typeof provider !== 'object' || Array.isArray(provider)) {
    return { source: 'manual', label: manual };
  }

  const record = provider as Record<string, unknown>;
  const { label, latitude, longitude } = record;

  if (!isNonemptyString(label)) {
    return { source: 'manual', label: manual };
  }
  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return { source: 'manual', label: manual };
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return { source: 'manual', label: manual };
  }

  return {
    source: 'provider',
    label: label.trim(),
    latitude,
    longitude,
  };
}