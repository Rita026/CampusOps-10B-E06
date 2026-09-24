import { resolveBackendBaseUrl } from '../src/api/courseBackend';

describe('backend configuration', () => {
  it('accepts the local teaching backend and a remote HTTPS endpoint', () => {
    expect(resolveBackendBaseUrl('http://127.0.0.1:4310')).toBe('http://127.0.0.1:4310');
    expect(resolveBackendBaseUrl('https://api.campusops.example.test')).toBe('https://api.campusops.example.test');
  });

  it('rejects a public value that would expose embedded credentials or use remote HTTP', () => {
    expect(() => resolveBackendBaseUrl('https://student:demo-password@api.campusops.example.test')).toThrow(
      'La configuración del backend no es válida.',
    );
    expect(() => resolveBackendBaseUrl('http://api.campusops.example.test')).toThrow(
      'La configuración del backend no es válida.',
    );
  });
});
