import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { IncidentActionClient } from '../src/application/incidents/IncidentClient';
import type { IncidentActor } from '../src/application/incidents/incidentAuthorization';
import { createPendingWorkOperation, IncidentSyncService } from '../src/application/sync/IncidentSyncService';
import { PendingOperationQueue } from '../src/application/sync/PendingOperationQueue';
import type { CloudIncident } from '../src/domain/incidents/CloudIncident';
import { JsonPendingOperationStore } from '../src/infrastructure/sync/JsonPendingOperationStore';
import { IncidentsApp } from '../src/ui/incidents/IncidentsApp';

const technician: IncidentActor = { id: 'technician-1', role: 'technician' };
const assigned: CloudIncident = {
  id: 'campus-inc-001', version: 1, status: 'assigned',
  details: { category: 'water', description: 'Reporte ficticio', location: 'Laboratorio ficticio',
    reporterId: 'reporter-1', assignedTechnicianId: 'technician-1', priority: 'medium' },
};
const started: CloudIncident = { ...assigned, status: 'in_progress', version: 2 };

type Memory = Map<string, string>;

function queueOver(memory: Memory): PendingOperationQueue {
  return new PendingOperationQueue(new JsonPendingOperationStore({ memory }));
}

/** Same composition as src/bootstrap/campusOpsServices.ts, over in-memory storage. */
function offlineSyncFor(memory: Memory, client: IncidentActionClient) {
  const queue = queueOver(memory);
  const service = new IncidentSyncService({ queue, client, currentActorId: () => technician.id });
  return { queue, synchronize: () => service.synchronize() };
}

function clientWith(overrides: Partial<IncidentActionClient>): IncidentActionClient {
  return {
    listIncidents: jest.fn().mockResolvedValue({ ok: true, value: [assigned] }),
    getIncidentDetail: jest.fn().mockResolvedValue({ ok: true, value: assigned }),
    createIncident: jest.fn(),
    applyAction: jest.fn(),
    ...overrides,
  };
}

function sentKey(client: IncidentActionClient, call: number): string {
  return (client.applyAction as jest.Mock).mock.calls[call][2] as string;
}

async function pressStart(view: Awaited<ReturnType<typeof render>>): Promise<void> {
  await fireEvent.press(await view.findByTestId('incident-row-campus-inc-001'));
  await fireEvent.press(await view.findByTestId('incident-action-start'));
}

test('offline start is queued with the key it was sent with, survives a restart and is applied once', async () => {
  const memory: Memory = new Map();
  const offline = clientWith({ applyAction: jest.fn().mockResolvedValue({ ok: false, error: { kind: 'network' } }) });
  const first = await render(<IncidentsApp actor={technician} client={offline} offlineSync={offlineSyncFor(memory, offline)} />);
  await pressStart(first);
  await waitFor(() => expect(first.getByTestId('sync-notice').props.children).toContain('Sin conexión'));

  const key = sentKey(offline, 0);
  expect(await queueOver(memory).list()).toEqual([expect.objectContaining({
    operationId: key, incidentId: assigned.id, actorId: 'technician-1', action: 'start', baseVersion: 1,
  })]);
  await first.unmount();

  // Reopen the app: a new queue instance over the same storage and the connection restored.
  const online = clientWith({ applyAction: jest.fn().mockResolvedValue({
    ok: true, value: { incident: started, operationId: key, duplicate: false } }) });
  const second = await render(<IncidentsApp actor={technician} client={online} offlineSync={offlineSyncFor(memory, online)} />);
  await waitFor(() => expect(second.getByTestId('sync-notice').props.children).toContain('1 confirmadas'));
  expect(online.applyAction).toHaveBeenCalledTimes(1);
  expect(online.applyAction).toHaveBeenCalledWith(assigned.id, { action: 'start', baseVersion: 1 }, key);
  expect(await queueOver(memory).list()).toEqual([]);
});

test('a reassignment made while offline is shown as a conflict and the queued intent is kept', async () => {
  const memory: Memory = new Map();
  const operation = createPendingWorkOperation({
    actor: technician, incident: assigned, action: 'start',
    operationId: 'op-offline-start-001', createdAt: '2026-10-26T12:00:00.000Z',
  });
  if (operation === null) throw new Error('fixture must be a valid offline start');
  await queueOver(memory).enqueue(operation);

  const reassigned = clientWith({
    listIncidents: jest.fn().mockResolvedValue({ ok: true, value: [] }),
    getIncidentDetail: jest.fn().mockResolvedValue({ ok: false, error: { kind: 'forbidden', status: 403 } }),
  });
  const view = await render(<IncidentsApp actor={technician} client={reassigned} offlineSync={offlineSyncFor(memory, reassigned)} />);
  await waitFor(() => expect(view.getByTestId('sync-notice').props.children).toContain('1 en conflicto'));
  expect(view.getByTestId('sync-notice').props.children).toContain('se conserva en el dispositivo');
  expect(reassigned.applyAction).not.toHaveBeenCalled();
  expect(await queueOver(memory).list()).toEqual([operation]);
});

test('an online retry with the same key removes the queued copy so it is never replayed', async () => {
  const memory: Memory = new Map();
  const client = clientWith({ applyAction: jest.fn()
    .mockResolvedValueOnce({ ok: false, error: { kind: 'timeout' } })
    .mockResolvedValueOnce({ ok: true, value: { incident: started, operationId: 'fixture', duplicate: true } }) });
  const view = await render(<IncidentsApp actor={technician} client={client} offlineSync={offlineSyncFor(memory, client)} />);
  await pressStart(view);
  await waitFor(() => expect(view.getByTestId('sync-notice')).toBeTruthy());
  expect(await queueOver(memory).list()).toHaveLength(1);

  await fireEvent.press(view.getByTestId('incident-action-start'));
  await waitFor(() => expect(view.getByText('Estado: in_progress')).toBeTruthy());
  expect(sentKey(client, 1)).toBe(sentKey(client, 0));
  expect(await queueOver(memory).list()).toEqual([]);
});

test('a server error is reported but not queued as offline work', async () => {
  const memory: Memory = new Map();
  const client = clientWith({ applyAction: jest.fn().mockResolvedValue({ ok: false, error: { kind: 'server', status: 500 } }) });
  const view = await render(<IncidentsApp actor={technician} client={client} offlineSync={offlineSyncFor(memory, client)} />);
  await pressStart(view);
  await waitFor(() => expect(view.getByText('El servidor no pudo completar la solicitud. Puedes reintentar.')).toBeTruthy());
  expect(view.queryByTestId('sync-notice')).toBeNull();
  expect(await queueOver(memory).list()).toEqual([]);
});
