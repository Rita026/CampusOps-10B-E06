import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { IncidentActionClient } from '../src/application/incidents/IncidentClient';
import type { SessionGateway } from '../src/application/session/SessionAccess';
import { SessionManager } from '../src/application/session/SessionManager';
import type { SessionCredentialStore, SessionCredentials } from '../src/domain/session/SessionCredentialStore';
import type { CloudIncident } from '../src/domain/incidents/CloudIncident';
import { CampusOpsApp } from '../src/ui/CampusOpsApp';

const assigned: CloudIncident = {
  id: 'campus-inc-001', version: 1, status: 'assigned',
  details: { category: 'water', description: 'Reporte ficticio', location: 'Laboratorio ficticio',
    reporterId: 'reporter-1', assignedTechnicianId: 'technician-1', priority: 'medium' },
};

test('login opens assigned work, resolution supplies diagnosis, and logout returns to login with an empty store', async () => {
  let persisted: SessionCredentials | null = null;
  const store: SessionCredentialStore = {
    save: async (credentials) => { persisted = credentials; }, load: async () => persisted,
    clear: jest.fn(async () => { persisted = null; }),
  };
  const gateway: SessionGateway = {
    login: async (id) => ({ ok: true, value: { actor: { id, role: 'technician' },
      accessToken: 'synthetic-ui-access', refreshToken: 'synthetic-ui-refresh', expiresIn: 60 } }),
    refresh: jest.fn(),
  };
  const session = new SessionManager({ gateway, credentialStore: store });
  const client: IncidentActionClient = {
    listIncidents: jest.fn().mockResolvedValue({ ok: true, value: [assigned] }),
    getIncidentDetail: jest.fn().mockResolvedValue({ ok: true, value: assigned }), createIncident: jest.fn(),
    applyAction: jest.fn()
      .mockResolvedValueOnce({ ok: true, value: { incident: { ...assigned, status: 'in_progress', version: 2 }, operationId: 'fixture', duplicate: false } })
      .mockResolvedValueOnce({ ok: true, value: { incident: { ...assigned, status: 'resolved', version: 3 }, operationId: 'fixture', duplicate: false } }),
  };
  const view = await render(<CampusOpsApp session={session} incidentClient={client} checkBackendHealth={async () => undefined} />);
  expect(view.getByText('Iniciar sesión')).toBeTruthy();
  expect(client.listIncidents).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('login-technician-1'));
  await waitFor(() => expect(view.getByTestId('incident-row-campus-inc-001')).toBeTruthy());
  expect(view.queryByTestId('open-create-incident')).toBeNull();
  await fireEvent.press(view.getByTestId('incident-row-campus-inc-001'));
  await waitFor(() => expect(view.getByTestId('incident-action-start')).toBeTruthy());
  expect(view.queryByTestId('incident-action-close')).toBeNull();
  await fireEvent.press(view.getByTestId('incident-action-start'));
  await waitFor(() => expect(view.getByTestId('incident-action-resolve')).toBeTruthy());
  await fireEvent.changeText(view.getByTestId('incident-diagnosis-input'), 'Reparación ficticia verificada');
  await fireEvent.press(view.getByTestId('incident-action-resolve'));
  await waitFor(() => expect(view.getByText('Estado: resolved')).toBeTruthy());
  expect(client.applyAction).toHaveBeenNthCalledWith(2, assigned.id,
    { action: 'resolve', baseVersion: 2, diagnosis: 'Reparación ficticia verificada' }, expect.any(String));
  await fireEvent.press(view.getByTestId('logout-session'));
  await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());
  expect(view.queryByTestId('incident-detail')).toBeNull();
  expect(persisted).toBeNull();
  expect(session.getSnapshot().status).toBe('anonymous');
});

test('failed login stays on login and never loads protected incident data', async () => {
  const session = new SessionManager({
    gateway: { login: async () => ({ ok: false, error: { kind: 'unauthorized' } }), refresh: jest.fn() },
    credentialStore: { save: jest.fn(), load: async () => null, clear: jest.fn().mockResolvedValue(undefined) },
  });
  const client: IncidentActionClient = {
    listIncidents: jest.fn(), getIncidentDetail: jest.fn(), createIncident: jest.fn(), applyAction: jest.fn(),
  };
  const view = await render(<CampusOpsApp session={session} incidentClient={client} checkBackendHealth={async () => undefined} />);
  await fireEvent.press(view.getByTestId('login-reporter-1'));
  await waitFor(() => expect(view.getByText(/No fue posible iniciar la sesión/)).toBeTruthy());
  expect(session.getSnapshot().status).toBe('anonymous');
  expect(client.listIncidents).not.toHaveBeenCalled();
});

test('automatic revocation with failed storage deletion exposes a logout retry and blocks new login', async () => {
  let persisted: SessionCredentials | null = null;
  const clear = jest.fn(async () => { persisted = null; });
  const session = new SessionManager({
    gateway: {
      login: async (id) => ({ ok: true, value: { actor: { id, role: 'reporter' },
        accessToken: 'synthetic-ui-access', refreshToken: 'synthetic-ui-refresh', expiresIn: 60 } }),
      refresh: jest.fn(),
    },
    credentialStore: { save: async (credentials) => { persisted = credentials; }, load: async () => persisted, clear },
  });
  await session.login('reporter-1');
  const client: IncidentActionClient = {
    listIncidents: jest.fn().mockResolvedValue({ ok: true, value: [] }), getIncidentDetail: jest.fn(),
    createIncident: jest.fn(), applyAction: jest.fn(),
  };
  const view = await render(<CampusOpsApp session={session} incidentClient={client} checkBackendHealth={async () => undefined} />);
  const credentials = await session.getRequestCredentials();
  if (!credentials) throw new Error('Expected credentials for cleanup test');
  clear.mockRejectedValueOnce(new Error('synthetic-native-storage-error'));
  await act(async () => { await session.invalidate(credentials); });
  expect(session.getSnapshot().status).toBe('logging_out');
  expect(view.getByText(/Reintenta el cierre para completar/)).toBeTruthy();
  expect(view.getByTestId('login-reporter-1').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(view.getByTestId('logout-session'));
  await waitFor(() => expect(session.getSnapshot().status).toBe('anonymous'));
  expect(persisted).toBeNull();
});
