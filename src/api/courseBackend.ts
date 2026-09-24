export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

const DEFAULT_URL = 'http://127.0.0.1:4310';

function invalidBackendUrl(): Error {
  return new Error('La configuración del backend no es válida.');
}

function isLocalTeachingHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '10.0.2.2' || hostname === '[::1]';
}

/**
 * Expo exposes EXPO_PUBLIC_* values in the client bundle. The backend address
 * therefore must be an address only, never a URL that embeds credentials.
 * HTTP is restricted to the local teaching backend; remote endpoints use HTTPS.
 */
export function resolveBackendBaseUrl(configuredBaseUrl?: string): string {
  const rawUrl = configuredBaseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL;
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw invalidBackendUrl();
  }

  if (
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLocalTeachingHost(parsedUrl.hostname)))
  ) {
    throw invalidBackendUrl();
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

export async function getBackendHealth(
  configuredBaseUrl?: string,
): Promise<BackendHealth> {
  const baseUrl = resolveBackendBaseUrl(configuredBaseUrl);
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Backend health failed with ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ok' in payload) ||
    payload.ok !== true ||
    !('contractVersion' in payload) ||
    payload.contractVersion !== 1
  ) {
    throw new Error('Backend health contract mismatch');
  }
  return payload as BackendHealth;
}
