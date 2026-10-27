import { Platform } from 'react-native';

import { createBackendHealthCheck } from '../application/system/checkBackendHealth';
import { CourseIncidentClient } from '../infrastructure/incidents/CourseIncidentClient';
import { SessionManager } from '../application/session/SessionManager';
import { IncidentSyncService } from '../application/sync/IncidentSyncService';
import { PendingOperationQueue } from '../application/sync/PendingOperationQueue';
import { CourseSessionGateway } from '../infrastructure/session/CourseSessionGateway';
import { SecureSessionCredentialStore } from '../infrastructure/session/SecureSessionCredentialStore';
import { JsonPendingOperationStore } from '../infrastructure/sync/JsonPendingOperationStore';
import { CourseBackendHealthGateway } from '../infrastructure/system/CourseBackendHealthGateway';

/**
 * Composition root: the sole place that selects concrete infrastructure for
 * the UI. It is outside src/ui so screens do not import provider details.
 */
const backendUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL
  ?? (Platform.OS === 'android' ? 'http://10.0.2.2:4310' : 'http://127.0.0.1:4310');

const sessionCredentials = new SecureSessionCredentialStore();
const session = new SessionManager({
  gateway: new CourseSessionGateway({ baseUrl: backendUrl }),
  credentialStore: sessionCredentials,
});
const incidentClient = new CourseIncidentClient({ baseUrl: backendUrl, session });
const pendingOperations = new PendingOperationQueue(new JsonPendingOperationStore());

export const campusOpsServices = {
  incidentClient,
  pendingOperations,
  incidentSync: new IncidentSyncService({
    queue: pendingOperations,
    client: incidentClient,
    currentActorId: () => session.getSnapshot().actor?.id ?? null,
  }),
  checkBackendHealth: createBackendHealthCheck(new CourseBackendHealthGateway(backendUrl)),
  sessionCredentials,
  session,
} as const;
