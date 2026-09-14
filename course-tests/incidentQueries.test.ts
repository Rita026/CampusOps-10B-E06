import { createIncidentQueries } from '../src/application/incidents/IncidentQueries';
import { InMemoryIncidentRepository, fakeIncidents } from '../src/infrastructure/incidents/InMemoryIncidentRepository';

describe('week 02 incident queries', () => {
  const queries = createIncidentQueries(new InMemoryIncidentRepository());

  test('lists the deterministic fake incidents through the domain port', async () => {
    await expect(queries.listIncidents()).resolves.toEqual(fakeIncidents);
  });

  test('returns a detail for a known id and null for an unknown id', async () => {
    await expect(queries.getIncidentDetail('INC-103')).resolves.toMatchObject({
      id: 'INC-103',
      title: 'Fuga de agua en sanitario',
    });
    await expect(queries.getIncidentDetail('INC-999')).resolves.toBeNull();
  });
});
