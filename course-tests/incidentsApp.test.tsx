import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { IncidentClient } from '../src/application/incidents/IncidentClient';
import type { CloudIncident } from '../src/domain/incidents/CloudIncident';
import { IncidentsApp } from '../src/ui/incidents/IncidentsApp';

const incident: CloudIncident = {
  id: 'campus-inc-001',
  version: 1,
  status: 'assigned',
  details: {
    category: 'connectivity',
    description: 'Sin conexión de prueba',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
    priority: 'medium',
  },
};

test('UI lists remote app data and opens detail without making HTTP requests', async () => {
  const client: IncidentClient = {
    listIncidents: jest.fn().mockResolvedValue({ ok: true, value: [incident] }),
    getIncidentDetail: jest.fn().mockResolvedValue({ ok: true, value: incident }),
    createIncident: jest.fn(),
  };
  const view = await render(<IncidentsApp client={client} />);

  await waitFor(() => expect(view.getByTestId('incident-row-campus-inc-001')).toBeTruthy());
  await fireEvent.press(view.getByTestId('incident-row-campus-inc-001'));
  await waitFor(() => expect(view.getByTestId('incident-detail')).toBeTruthy());
  expect(view.getByText('Sin conexión de prueba')).toBeTruthy();
  expect(client.getIncidentDetail).toHaveBeenCalledWith('campus-inc-001');
});

test('UI preserves a valid null payload as unavailable details', async () => {
  const noDetails = { ...incident, details: null };
  const client: IncidentClient = {
    listIncidents: jest.fn().mockResolvedValue({ ok: true, value: [noDetails] }),
    getIncidentDetail: jest.fn().mockResolvedValue({ ok: true, value: noDetails }),
    createIncident: jest.fn(),
  };
  const view = await render(<IncidentsApp client={client} />);

  await waitFor(() => expect(view.getByTestId('incident-row-campus-inc-001')).toBeTruthy());
  await fireEvent.press(view.getByTestId('incident-row-campus-inc-001'));
  await waitFor(() => expect(view.getByTestId('incident-null-details')).toBeTruthy());
  expect(view.queryByText('Sin conexión de prueba')).toBeNull();
});

test('creation retries the same intent with the same key after timeout', async () => {
  const created = { ...incident, id: 'campus-inc-101', status: 'open' as const };
  const createIncident = jest.fn()
    .mockResolvedValueOnce({ ok: false, error: { kind: 'timeout' } })
    .mockResolvedValueOnce({ ok: true, value: { incident: created, operationId: 'server-echo', duplicate: true } });
  const client: IncidentClient = {
    listIncidents: jest.fn().mockResolvedValue({ ok: true, value: [incident] }),
    getIncidentDetail: jest.fn().mockResolvedValue({ ok: true, value: created }),
    createIncident,
  };
  const view = await render(<IncidentsApp client={client} />);

  await waitFor(() => expect(view.getByTestId('open-create-incident')).toBeTruthy());
  await fireEvent.press(view.getByTestId('open-create-incident'));
  await fireEvent.changeText(view.getByTestId('incident-description-input'), 'Falla simulada');
  await fireEvent.changeText(view.getByTestId('incident-location-input'), 'Edificio ficticio B');
  await fireEvent.press(view.getByTestId('submit-incident'));
  await waitFor(() => expect(view.getByText(/tardó demasiado/)).toBeTruthy());
  await fireEvent.press(view.getByTestId('category-electrical'));
  await fireEvent.press(view.getByTestId('submit-incident'));
  await waitFor(() => expect(view.getByTestId('incident-detail')).toBeTruthy());

  expect(createIncident).toHaveBeenCalledTimes(2);
  expect(createIncident.mock.calls[0]?.[0]).toEqual({
    category: 'electrical', description: 'Falla simulada', location: 'Edificio ficticio B',
  });
  expect(createIncident.mock.calls[0]?.[1]).toBe(createIncident.mock.calls[1]?.[1]);
  expect((createIncident.mock.calls[0]?.[1] as string).length).toBeGreaterThanOrEqual(8);
});
