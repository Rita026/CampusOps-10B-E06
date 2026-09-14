import { getBackendHealth } from '../../api/courseBackend';
import type { BackendHealthGateway } from '../../domain/system/BackendHealthGateway';

/** Adapter around the course backend; swapping it does not affect the UI. */
export class CourseBackendHealthGateway implements BackendHealthGateway {
  public async check(): Promise<void> {
    await getBackendHealth();
  }
}
