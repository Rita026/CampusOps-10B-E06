import { createIncidentQueries } from '../application/incidents/IncidentQueries';
import { createBackendHealthCheck } from '../application/system/checkBackendHealth';
import { InMemoryIncidentRepository } from '../infrastructure/incidents/InMemoryIncidentRepository';
import { CourseBackendHealthGateway } from '../infrastructure/system/CourseBackendHealthGateway';

/**
 * Composition root: the sole place that selects concrete infrastructure for
 * the UI. It is outside src/ui so screens do not import provider details.
 */
export const campusOpsServices = {
  incidentQueries: createIncidentQueries(new InMemoryIncidentRepository()),
  checkBackendHealth: createBackendHealthCheck(new CourseBackendHealthGateway()),
} as const;
