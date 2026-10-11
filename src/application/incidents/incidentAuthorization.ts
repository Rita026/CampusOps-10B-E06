import type { CampusRole } from '../../campusops/contracts';
import type { CloudIncident } from '../../domain/incidents/CloudIncident';

export type IncidentActor = Readonly<{ id: string; role: CampusRole }>;
export type IncidentActionInput =
  | Readonly<{ action: 'start' | 'close' | 'reopen'; baseVersion: number }>
  | Readonly<{ action: 'resolve'; baseVersion: number; diagnosis: string }>;

export function canReadIncident(actor: IncidentActor, incident: CloudIncident): boolean {
  return actor.role === 'coordinator'
    || (actor.role === 'reporter' && incident.details?.reporterId === actor.id)
    || (actor.role === 'technician' && incident.details?.assignedTechnicianId === actor.id);
}

export function canCreateIncident(actor: IncidentActor): boolean {
  return actor.role === 'reporter';
}

/** Applied by the client before POST, independently of which controls the UI shows. */
export function canPerformIncidentAction(
  actor: IncidentActor,
  incident: CloudIncident,
  action: IncidentActionInput['action'],
): boolean {
  if (action === 'start' || action === 'resolve') {
    return actor.role === 'technician' && incident.details?.assignedTechnicianId === actor.id;
  }
  return (action === 'close' || action === 'reopen') && actor.role === 'coordinator';
}

export function isAllowedIncidentTransition(
  incident: CloudIncident,
  action: IncidentActionInput['action'],
): boolean {
  switch (action) {
    case 'start': return incident.status === 'assigned';
    case 'resolve': return incident.status === 'in_progress';
    case 'close': return incident.status === 'resolved';
    case 'reopen': return incident.status === 'resolved' || incident.status === 'closed';
  }
}
