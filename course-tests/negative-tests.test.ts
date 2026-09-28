import { redactForTelemetry } from '../src/course-evaluation';

describe('Semana 4 - pruebas negativas de exposición', () => {
  test('redacta datos protegidos en estructuras anidadas y listas', () => {
    const input = {
      incidentId: 'campus-inc-001',
      status: 'open',
      reporter: {
        name: 'Nombre ficticio del reportante',
        displayName: 'Reportante ficticio',
        session: {
          authorization: 'Bearer synthetic-token',
          token: 'synthetic-session-token',
        },
      },
      incident: {
        location: 'Ubicación ficticia',
        coordinates: {
          latitude: 18.1234,
          longitude: -97.1234,
        },
        photos: [
          'foto-sintetica-1',
          'foto-sintetica-2',
        ],
        internalComments: [
          'Comentario interno ficticio 1',
          'Comentario interno ficticio 2',
        ],
      },
      safeContext: {
        attempt: 2,
        durationMs: 125,
      },
    };

    const result = redactForTelemetry(input);

    expect(result).toEqual({
      incidentId: 'campus-inc-001',
      status: 'open',
      reporter: {
        name: '[REDACTED]',
        displayName: '[REDACTED]',
        session: {
          authorization: '[REDACTED]',
          token: '[REDACTED]',
        },
      },
      incident: {
        location: '[REDACTED]',
        coordinates: {
          latitude: '[REDACTED]',
          longitude: '[REDACTED]',
        },
        photos: '[REDACTED]',
        internalComments: '[REDACTED]',
      },
      safeContext: {
        attempt: 2,
        durationMs: 125,
      },
    });
  });

  test('no expone datos protegidos cuando el error contiene estructuras anidadas', () => {
    const sensitiveMarker = 'MARCADOR-SENSIBLE-SINTETICO';

    const errorPayload = {
      incidentId: 'campus-inc-001',
      status: 'error',
      error: {
        message: 'Fallo de backend',
        session: {
          authorization: sensitiveMarker,
          token: sensitiveMarker,
        },
        reporter: {
          name: sensitiveMarker,
          displayName: sensitiveMarker,
        },
        incident: {
          location: sensitiveMarker,
          photos: [sensitiveMarker],
          internalComments: [sensitiveMarker],
        },
      },
      attempt: 3,
    };

    const result = redactForTelemetry(errorPayload);

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(sensitiveMarker);
    expect(result).toEqual({
      incidentId: 'campus-inc-001',
      status: 'error',
      error: {
        message: 'Fallo de backend',
        session: {
          authorization: '[REDACTED]',
          token: '[REDACTED]',
        },
        reporter: {
          name: '[REDACTED]',
          displayName: '[REDACTED]',
        },
        incident: {
          location: '[REDACTED]',
          photos: '[REDACTED]',
          internalComments: '[REDACTED]',
        },
      },
      attempt: 3,
    });
  });

  test('no modifica la entrada original al sanitizarla', () => {
    const input = {
      incidentId: 'campus-inc-001',
      profile: {
        name: 'Nombre ficticio',
        location: 'Ubicación ficticia',
      },
      photos: ['foto-sintetica'],
      internalComments: ['Comentario ficticio'],
    };

    const original = JSON.parse(JSON.stringify(input));

    redactForTelemetry(input);

    expect(input).toEqual(original);
    expect(input.profile.name).toBe('Nombre ficticio');
    expect(input.profile.location).toBe('Ubicación ficticia');
    expect(input.photos).toEqual(['foto-sintetica']);
    expect(input.internalComments).toEqual(['Comentario ficticio']);
  });

  test('conserva contexto técnico seguro en un camino de error', () => {
    const result = redactForTelemetry({
      incidentId: 'campus-inc-001',
      correlationId: 'corr-synthetic-001',
      status: 'error',
      attempt: 2,
      durationMs: 250,
      error: {
        name: 'BackendError',
        location: 'Ubicación ficticia',
        displayName: 'Nombre ficticio',
        photos: ['foto-sintetica'],
        internalComments: ['Comentario ficticio'],
      },
    });

    expect(result).toEqual({
      incidentId: 'campus-inc-001',
      correlationId: 'corr-synthetic-001',
      status: 'error',
      attempt: 2,
      durationMs: 250,
      error: {
        name: '[REDACTED]',
        location: '[REDACTED]',
        displayName: '[REDACTED]',
        photos: '[REDACTED]',
        internalComments: '[REDACTED]',
      },
    });
  });
});