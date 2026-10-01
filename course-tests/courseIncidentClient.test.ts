import { CourseIncidentClient } from '../src/infrastructure/incidents/CourseIncidentClient';

const baseUrl = 'http://127.0.0.1:4310';
const incident = {
  id: 'campus-inc-001',
  version: 2,
  status: 'assigned',
  payload: {
    category: 'connectivity',
    description: 'Falla ficticia',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
    priority: 'medium',
    notes: [{ actorId: 'reporter-1', text: 'Nota ficticia' }],
    evidence: [],
    history: [],
  },
};

function httpResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function clientWith(transport: jest.Mock, options: { timeoutMs?: number; scenario?: 'nullable' | 'success' } = {}) {
  return new CourseIncidentClient({
    baseUrl,
    actorId: 'reporter-1',
    transport: transport as typeof fetch,
    ...options,
  });
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('list maps a remote DTO to app data and sends the synthetic actor headers', async () => {
  const transport = jest.fn().mockResolvedValue(httpResponse({ items: [incident] }));

  const result = await clientWith(transport).listIncidents();

  expect(result).toEqual({
    ok: true,
    value: [{
      id: 'campus-inc-001',
      version: 2,
      status: 'assigned',
      details: {
        category: 'connectivity',
        description: 'Falla ficticia',
        location: 'Edificio de prueba A',
        reporterId: 'reporter-1',
        assignedTechnicianId: 'technician-1',
        priority: 'medium',
      },
    }],
  });
  expect(transport).toHaveBeenCalledWith(`${baseUrl}/v1/incidents`, expect.objectContaining({
    method: 'GET',
    headers: expect.objectContaining({
      Authorization: 'Bearer course-valid-token',
      'X-Course-Actor': 'reporter-1',
      'X-Course-Scenario': 'success',
    }),
  }));
  expect(JSON.stringify(result)).not.toContain('history');
});

test('an empty list stays empty and a valid null payload stays null', async () => {
  const transport = jest.fn()
    .mockResolvedValueOnce(httpResponse({ items: [] }))
    .mockResolvedValueOnce(httpResponse({ ...incident, payload: null, futureField: 'ignored' }));
  const client = clientWith(transport, { scenario: 'nullable' });

  await expect(client.listIncidents()).resolves.toEqual({ ok: true, value: [] });
  await expect(client.getIncidentDetail('campus-inc-001')).resolves.toEqual({
    ok: true,
    value: { id: 'campus-inc-001', version: 2, status: 'assigned', details: null },
  });
  expect(transport).toHaveBeenNthCalledWith(2, `${baseUrl}/v1/incidents/campus-inc-001`, expect.objectContaining({
    headers: expect.objectContaining({ 'X-Course-Scenario': 'nullable' }),
  }));
});

test('detail is fetched by its encoded ID and rejects a mismatched remote ID', async () => {
  const transport = jest.fn().mockResolvedValue(httpResponse(incident));
  const client = clientWith(transport);

  await expect(client.getIncidentDetail('campus inc/001')).resolves.toEqual({
    ok: false, error: { kind: 'contract' },
  });
  expect(transport).toHaveBeenCalledWith(`${baseUrl}/v1/incidents/campus%20inc%2F001`, expect.any(Object));
});

test('create sends a stable idempotency key and accepts a replay without changing the incident', async () => {
  const created = { ...incident, id: 'campus-inc-101', version: 1, status: 'open', payload: {
    ...incident.payload, assignedTechnicianId: null,
  } };
  const key = 'create-operation-101';
  const transport = jest.fn()
    .mockResolvedValueOnce(httpResponse({ incident: created, operationId: key, duplicate: false }, 201))
    .mockResolvedValueOnce(httpResponse({ incident: created, operationId: key, duplicate: true }, 200));
  const client = clientWith(transport);
  const input = { category: 'connectivity' as const, description: 'Falla ficticia', location: 'Edificio de prueba A' };

  const first = await client.createIncident(input, key);
  const replay = await client.createIncident(input, key);

  expect(first).toMatchObject({ ok: true, value: { operationId: key, duplicate: false } });
  expect(replay).toMatchObject({ ok: true, value: { operationId: key, duplicate: true } });
  if (first.ok && replay.ok) expect(replay.value.incident).toEqual(first.value.incident);
  for (const call of transport.mock.calls) {
    expect(call[0]).toBe(`${baseUrl}/v1/incidents`);
    expect(call[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(input),
    });
  }
});

test('invalid creation input is rejected before any request', async () => {
  const transport = jest.fn();
  const result = await clientWith(transport).createIncident(
    { category: 'water', description: '   ', location: 'Zona ficticia' },
    'stable-create-key',
  );

  expect(result).toEqual({ ok: false, error: { kind: 'invalid_input' } });
  expect(transport).not.toHaveBeenCalled();
});

test('a corrupt list item, corrupt domain payload, or invalid JSON becomes a contract error', async () => {
  const invalidJson = httpResponse(null);
  (invalidJson.json as jest.Mock).mockRejectedValue(new SyntaxError('synthetic malformed JSON'));
  const transport = jest.fn()
    .mockResolvedValueOnce(httpResponse({ items: [{ ...incident, version: '2' }] }))
    .mockResolvedValueOnce(httpResponse({ items: [{ ...incident, payload: { ...incident.payload, category: 'unknown' } }] }))
    .mockResolvedValueOnce(invalidJson);
  const client = clientWith(transport);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(client.listIncidents()).resolves.toEqual({ ok: false, error: { kind: 'contract' } });
  }
});

test('a request that never resolves times out and aborts its signal', async () => {
  const transport = jest.fn(() => new Promise<Response>(() => undefined));
  const client = clientWith(transport, { timeoutMs: 20 });

  await expect(client.listIncidents()).resolves.toEqual({ ok: false, error: { kind: 'timeout' } });
  expect(transport).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    signal: expect.objectContaining({ aborted: true }),
  }));
});

test('server and network failures remain typed and never expose remote error text', async () => {
  const marker = 'synthetic-private-location-marker';
  const transport = jest.fn()
    .mockResolvedValueOnce(httpResponse({ message: marker }, 500))
    .mockRejectedValueOnce(new Error(marker));
  const client = clientWith(transport);

  const server = await client.listIncidents();
  const network = await client.listIncidents();

  expect(server).toEqual({ ok: false, error: { kind: 'server', status: 500 } });
  expect(network).toEqual({ ok: false, error: { kind: 'network' } });
  expect(JSON.stringify([server, network, (console.log as jest.Mock).mock.calls])).not.toContain(marker);
});
