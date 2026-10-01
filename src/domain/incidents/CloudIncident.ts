import type { IncidentCategory, IncidentStatus } from '../../campusops/contracts';

/** Data the app can safely use after validating a remote incident. */
export type IncidentDetails = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
  reporterId: string;
  assignedTechnicianId: string | null;
  priority: 'low' | 'medium' | 'high';
}>;

/** A valid envelope may have no payload; that absence is retained as null. */
export type CloudIncident = Readonly<{
  id: string;
  version: number;
  status: IncidentStatus;
  details: IncidentDetails | null;
}>;
