import type { Incident, IncidentRepository } from '../../domain/incidents/Incident';

export type IncidentQueries = Readonly<{
  listIncidents(): Promise<readonly Incident[]>;
  getIncidentDetail(incidentId: string): Promise<Incident | null>;
}>;

/** Creates the two read use cases required by the week-02 skeleton. */
export function createIncidentQueries(repository: IncidentRepository): IncidentQueries {
  return {
    listIncidents: () => repository.list(),
    getIncidentDetail: (incidentId) => repository.findById(incidentId),
  };
}
