import { CourseGeocodingGateway } from '../src/infrastructure/location/CourseGeocodingGateway';

describe('CourseGeocodingGateway fault injection', () => {
  it('rejects an empty geocoding query without making an HTTP request', async () => {
    const transport = jest.fn() as unknown as typeof fetch;
    const gateway = new CourseGeocodingGateway({ transport });

    await expect(gateway.lookup('   ')).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid_query' },
    });

    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects invalid coordinates returned by the geocoding service', async () => {
    const transport = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        label: 'Ubicación inválida',
        latitude: 91,
        longitude: -99,
      }),
    }) as unknown as typeof fetch;

    const gateway = new CourseGeocodingGateway({ transport });

    await expect(gateway.lookup('laboratorio')).resolves.toEqual({
      ok: false,
      error: { kind: 'incomplete' },
    });
  });

  it('classifies HTTP 429 as rate_limited', async () => {
    const transport = jest.fn().mockResolvedValue({
      status: 429,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const gateway = new CourseGeocodingGateway({ transport });

    await expect(gateway.lookup('Tehuacán')).resolves.toEqual({
      ok: false,
      error: { kind: 'rate_limited', status: 429 },
    });
  });

  it('classifies an aborted request as timeout', async () => {
    const transport = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Request aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;

    const gateway = new CourseGeocodingGateway({
      transport,
      timeoutMs: 20,
    });

    await expect(gateway.lookup('Tehuacán')).resolves.toEqual({
      ok: false,
      error: { kind: 'timeout' },
    });
  });

  it('classifies a disconnected transport as network', async () => {
    const transport = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    const gateway = new CourseGeocodingGateway({ transport });

    await expect(gateway.lookup('Tehuacán')).resolves.toEqual({
      ok: false,
      error: { kind: 'network' },
    });
  });
});
