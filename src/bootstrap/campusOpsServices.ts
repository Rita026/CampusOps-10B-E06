import { Platform } from 'react-native';

import { createBackendHealthCheck } from '../application/system/checkBackendHealth';
import { CourseIncidentClient } from '../infrastructure/incidents/CourseIncidentClient';
import { SecureSessionCredentialStore } from '../infrastructure/session/SecureSessionCredentialStore';
import { CourseBackendHealthGateway } from '../infrastructure/system/CourseBackendHealthGateway';

/**
 * Composition root: the sole place that selects concrete infrastructure for
 * the UI. It is outside src/ui so screens do not import provider details.
 */
const backendUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL
  ?? (Platform.OS === 'android' ? 'http://10.0.2.2:4310' : 'http://127.0.0.1:4310');

export const campusOpsServices = {
  incidentClient: new CourseIncidentClient({ baseUrl: backendUrl }),
  checkBackendHealth: createBackendHealthCheck(new CourseBackendHealthGateway(backendUrl)),
  sessionCredentials: new SecureSessionCredentialStore(),
} as const;
