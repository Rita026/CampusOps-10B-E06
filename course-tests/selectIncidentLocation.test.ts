import { selectIncidentLocation } from '../src/course-evaluation';

test('accepts valid provider coordinates', () => {
  expect(
    selectIncidentLocation({ label: 'Zona de prueba', latitude: 0, longitude: 0 }, 'Edificio manual'),
  ).toEqual({
    source: 'provider',
    label: 'Zona de prueba',
    latitude: 0,
    longitude: 0,
  });
});

test('falls back to manual for invalid provider payloads', () => {
  for (const value of [
    null,
    { status: 429 },
    { label: 'Incompleta' },
    { label: 'Inválida', latitude: 91, longitude: 0 },
    { label: 'Inválida', latitude: 0, longitude: 200 },
  ]) {
    expect(selectIncidentLocation(value, 'Edificio manual')).toEqual({
      source: 'manual',
      label: 'Edificio manual',
    });
  }
});