import type { IncidentStatus, IncidentWork } from '../../campusops/contracts';
import type { SyncRecord } from '../../course-evaluation/contracts';
import type { CloudIncident } from '../../domain/incidents/CloudIncident';
import type { PendingOperation } from '../../domain/sync/PendingOperation';
import type { PendingOperationQueuePort } from '../../domain/sync/PendingOperationStore';
import type { IncidentActionClient, IncidentClientErrorKind } from '../incidents/IncidentClient';
import {
  canPerformIncidentAction,
  isAllowedIncidentTransition,
  type IncidentActionInput,
  type IncidentActor,
} from '../incidents/incidentAuthorization';
import { classifyIncidentResult, runWithRetry, type RetryRunnerOptions } from '../resilience/runWithRetry';
import { canonicalJson, deduplicateByOperationId, resolveSyncRecords } from './syncResolution';

export type WorkAction = 'start' | 'resolve';

/** Precondition and effect of each technician action on `work` (CampusOps state machine). */
const WORK_TRANSITIONS: Readonly<Record<WorkAction, Readonly<{ from: IncidentStatus; to: IncidentStatus }>>> = {
  start: { from: 'assigned', to: 'in_progress' },
  resolve: { from: 'in_progress', to: 'resolved' },
};

export type SyncPendingReason = IncidentClientErrorKind | 'waiting_previous' | 'unsupported_action';

/** Only `confirmed` removes the operation from the queue. */
export type SyncOutcome =
  | Readonly<{ kind: 'confirmed'; operationId: string; incident: CloudIncident; duplicate: boolean }>
  | Readonly<{ kind: 'conflict'; operationId: string; fields: readonly string[] }>
  | Readonly<{ kind: 'pending'; operationId: string; reason: SyncPendingReason }>;

export type IncidentSyncServiceOptions = Readonly<{
  queue: PendingOperationQueuePort;
  client: IncidentActionClient;
  currentActorId: () => string | null;
  /**
   * Retries each send in place with planRetry, reusing the stored key and content.
   * Without it a transient failure leaves the operation pending for the next pass.
   */
  retry?: RetryRunnerOptions;
}>;

function isWorkAction(action: string): action is WorkAction {
  return action === 'start' || action === 'resolve';
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function workRecord(id: string, version: number, work: IncidentWork): SyncRecord {
  return { id, version, fields: { work } };
}

/**
 * Builds the offline intent only if the actor could perform it on the incident it has
 * stored locally. That precondition is what lets the sync rebuild the base `work` later.
 */
export function createPendingWorkOperation(input: Readonly<{
  actor: IncidentActor;
  incident: CloudIncident;
  action: WorkAction;
  operationId: string;
  createdAt: string;
  diagnosis?: string;
}>): PendingOperation | null {
  const { actor, incident, action } = input;
  const diagnosis = input.diagnosis?.trim() ?? '';
  if (!canPerformIncidentAction(actor, incident, action) || !isAllowedIncidentTransition(incident, action)) return null;
  if (action === 'resolve' && diagnosis.length === 0) return null;
  return {
    operationId: input.operationId,
    incidentId: incident.id,
    actorId: actor.id,
    action,
    payload: action === 'resolve' ? { diagnosis } : {},
    baseVersion: incident.version,
    createdAt: input.createdAt,
  };
}

function actionInput(operation: PendingOperation, action: WorkAction): IncidentActionInput | null {
  if (action === 'start') return { action, baseVersion: operation.baseVersion };
  const { diagnosis } = operation.payload;
  return isNonemptyString(diagnosis) ? { action, baseVersion: operation.baseVersion, diagnosis } : null;
}

/**
 * Replays the persistent queue against the backend. Conflicts and failures leave the
 * operation queued with its identity; only a server confirmation removes it.
 */
export class IncidentSyncService {
  public constructor(private readonly options: IncidentSyncServiceOptions) {}

  public async synchronize(): Promise<readonly SyncOutcome[]> {
    const actorId = this.options.currentActorId();
    if (actorId === null) return [];

    const operations = deduplicateByOperationId(await this.options.queue.list());
    const blockedIncidents = new Set<string>();
    const outcomes: SyncOutcome[] = [];
    for (const operation of operations) {
      // An intent is only sent with its author's session (week 6 authorization).
      if (operation.actorId !== actorId) continue;
      if (this.options.currentActorId() !== actorId) break;
      // Later intents depend on earlier ones for the same incident; keep their order.
      const outcome: SyncOutcome = blockedIncidents.has(operation.incidentId)
        ? { kind: 'pending', operationId: operation.operationId, reason: 'waiting_previous' }
        : await this.synchronizeOne(operation);
      if (outcome.kind !== 'confirmed') blockedIncidents.add(operation.incidentId);
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async synchronizeOne(operation: PendingOperation): Promise<SyncOutcome> {
    const { operationId, action } = operation;
    if (!isWorkAction(action)) return { kind: 'pending', operationId, reason: 'unsupported_action' };

    const detail = await this.options.client.getIncidentDetail(operation.incidentId);
    if (!detail.ok) {
      // A technician only reads its current assignments; losing access to an incident it
      // was allowed to work on means coordination reassigned it.
      return detail.error.kind === 'forbidden'
        ? { kind: 'conflict', operationId, fields: ['work'] }
        : { kind: 'pending', operationId, reason: detail.error.kind };
    }
    const remote = detail.value;
    if (remote.details === null) return { kind: 'pending', operationId, reason: 'contract' };

    const transition = WORK_TRANSITIONS[action];
    const base = workRecord(operation.incidentId, operation.baseVersion,
      { assignedTechnicianId: operation.actorId, status: transition.from });
    const local = workRecord(operation.incidentId, operation.baseVersion,
      { assignedTechnicianId: operation.actorId, status: transition.to });
    const remoteRecord = workRecord(remote.id, remote.version,
      { assignedTechnicianId: remote.details.assignedTechnicianId, status: remote.status });
    const resolution = resolveSyncRecords(base, local, remoteRecord);
    if (resolution.kind === 'conflict') return { kind: 'conflict', operationId, fields: resolution.fields };

    // Merged: the remote already shows the local effect (lost confirmation, so replay the
    // stored content as is), or remote `work` is still the base and only independent data
    // advanced. In the latter case persist the new base before sending, so any retry
    // reuses exactly the content the server may have stored for this key.
    let toSend = operation;
    const alreadyApplied = canonicalJson(remoteRecord.fields) === canonicalJson(local.fields);
    if (!alreadyApplied && remote.version !== operation.baseVersion) {
      toSend = { ...operation, baseVersion: remote.version };
      if (!(await this.options.queue.replace(toSend))) return { kind: 'pending', operationId, reason: 'not_found' };
    }

    const input = actionInput(toSend, action);
    if (input === null) return { kind: 'pending', operationId, reason: 'invalid_input' };
    const send = () => this.options.client.applyAction(operation.incidentId, input, operationId);
    const result = this.options.retry === undefined
      ? await send()
      : (await runWithRetry({ method: 'POST', idempotencyKey: operationId, send, classify: classifyIncidentResult },
        this.options.retry)).result;
    if (!result.ok) {
      return result.error.kind === 'forbidden'
        ? { kind: 'conflict', operationId, fields: ['work'] }
        : { kind: 'pending', operationId, reason: result.error.kind };
    }
    await this.options.queue.remove(operationId);
    return { kind: 'confirmed', operationId, incident: result.value.incident, duplicate: result.value.duplicate };
  }
}
