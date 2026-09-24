import { redactForTelemetry } from '../src/security/redactForTelemetry';

describe('redactForTelemetry', () => {
  it('redacts sensitive values in nested objects and arrays without mutating the input', () => {
    const telemetry = {
      incidentId: 'INC-103',
      correlationId: 'audit-correlation-01',
      request: {
        authorization: 'Bearer synthetic-token-for-test-only',
        profile: { display_name: 'Persona ficticia', email: 'persona@example.test' },
      },
      incidents: [
        {
          location: 'Edificio C, zona ficticia',
          assignmentHistory: ['technician-1'],
          status: 'in_progress',
        },
      ],
    };

    expect(redactForTelemetry(telemetry)).toEqual({
      incidentId: 'INC-103',
      correlationId: 'audit-correlation-01',
      request: {
        authorization: '[REDACTED]',
        profile: { display_name: '[REDACTED]', email: '[REDACTED]' },
      },
      incidents: [
        {
          location: '[REDACTED]',
          assignmentHistory: '[REDACTED]',
          status: 'in_progress',
        },
      ],
    });

    expect(telemetry.request.authorization).toBe('Bearer synthetic-token-for-test-only');
    expect(telemetry.incidents[0]?.location).toBe('Edificio C, zona ficticia');
  });
});
