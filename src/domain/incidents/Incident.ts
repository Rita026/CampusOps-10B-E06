/** Core incident vocabulary. It is intentionally independent of React and providers. */
export type IncidentCategory = 'electrical' | 'laboratory' | 'water' | 'connectivity' | 'safety';

export type IncidentPriority = 'low' | 'medium' | 'high';

export type IncidentStatus = 'open' | 'assigned' | 'in_progress' | 'resolved';

export type Incident = Readonly<{
  id: string;
  title: string;
  description: string;
  category: IncidentCategory;
  priority: IncidentPriority;
  status: IncidentStatus;
  reporterLabel: string;
  locationLabel: string;
  assignedTechnicianLabel: string | null;
  createdAt: string;
}>;

/**
 * Port used by the application. A memory fake, HTTP client or local cache can
 * implement it without changing the list or detail use cases.
 */
export interface IncidentRepository {
  list(): Promise<readonly Incident[]>;
  findById(incidentId: string): Promise<Incident | null>;
}
