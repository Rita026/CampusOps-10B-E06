import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  CreateIncidentInput,
  IncidentClient,
  IncidentClientErrorKind,
  IncidentActionClient,
} from '../../application/incidents/IncidentClient';
import {
  canPerformIncidentAction,
  isAllowedIncidentTransition,
  type IncidentActor,
  type IncidentActionInput,
} from '../../application/incidents/incidentAuthorization';
import type { CloudIncident } from '../../domain/incidents/CloudIncident';
import { IncidentCreateScreen } from './IncidentCreateScreen';
import { IncidentDetailScreen } from './IncidentDetailScreen';
import { IncidentListScreen } from './IncidentListScreen';

type IncidentsAppProps = Readonly<{ client: IncidentClient & Partial<IncidentActionClient>; actor?: IncidentActor }>;
type Screen = 'list' | 'detail' | 'create';
type CreateAttempt = Readonly<{ signature: string; key: string }>;

const ERROR_MESSAGES: Readonly<Record<IncidentClientErrorKind, string>> = {
  contract: 'La respuesta del servidor no cumple el contrato.',
  timeout: 'El servidor tardó demasiado. Puedes reintentar.',
  network: 'No hay conexión con el servidor. Puedes reintentar.',
  server: 'El servidor no pudo completar la solicitud. Puedes reintentar.',
  unauthorized: 'La sesión de prueba no está autorizada.',
  forbidden: 'Este actor no tiene permiso para esta incidencia.',
  not_found: 'La incidencia solicitada no existe.',
  rate_limited: 'El servidor solicita esperar antes de reintentar.',
  invalid_input: 'Revisa los datos de la incidencia.',
  conflict: 'La operación entró en conflicto. Revisa los datos antes de reintentar.',
  http: 'La solicitud no pudo completarse. Puedes reintentar.',
};

let operationSequence = 0;

function newOperationKey(): string {
  operationSequence += 1;
  return `create-${Date.now().toString(36)}-${operationSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function IncidentsApp({ client, actor }: IncidentsAppProps) {
  const [screen, setScreen] = useState<Screen>('list');
  const [incidents, setIncidents] = useState<readonly CloudIncident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<CloudIncident | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const actionInFlight = useRef(false);
  const actionAttempt = useRef<CreateAttempt | null>(null);
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const createInFlight = useRef(false);
  const createAttempt = useRef<CreateAttempt | null>(null);

  const loadList = useCallback(async () => {
    const requestId = ++listRequestId.current;
    setIsLoadingList(true);
    setListError(null);
    try {
      const result = await client.listIncidents();
      if (requestId !== listRequestId.current) return;
      if (result.ok) {
        setIncidents(result.value);
      } else {
        setIncidents([]);
        setListError(ERROR_MESSAGES[result.error.kind]);
      }
    } catch {
      if (requestId !== listRequestId.current) return;
      setIncidents([]);
      setListError('No fue posible consultar las incidencias. Puedes reintentar.');
    } finally {
      if (requestId === listRequestId.current) setIsLoadingList(false);
    }
  }, [client]);

  const loadDetail = useCallback(async (incidentId: string) => {
    const requestId = ++detailRequestId.current;
    setIsLoadingDetail(true);
    setDetailError(null);
    try {
      const result = await client.getIncidentDetail(incidentId);
      if (requestId !== detailRequestId.current) return;
      if (result.ok) {
        setSelectedIncident(result.value);
      } else {
        setSelectedIncident(null);
        setDetailError(ERROR_MESSAGES[result.error.kind]);
      }
    } catch {
      if (requestId !== detailRequestId.current) return;
      setSelectedIncident(null);
      setDetailError('No fue posible consultar el detalle. Puedes reintentar.');
    } finally {
      if (requestId === detailRequestId.current) setIsLoadingDetail(false);
    }
  }, [client]);

  useEffect(() => {
    const timeoutId = setTimeout(() => { void loadList(); }, 0);
    return () => {
      clearTimeout(timeoutId);
      listRequestId.current += 1;
    };
  }, [loadList]);

  useEffect(() => {
    const timeoutId = screen === 'detail' && selectedIncidentId !== null
      ? setTimeout(() => { void loadDetail(selectedIncidentId); }, 0)
      : null;
    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      detailRequestId.current += 1;
    };
  }, [loadDetail, screen, selectedIncidentId]);

  const openDetail = (incidentId: string) => {
    setSelectedIncidentId(incidentId);
    setSelectedIncident(null);
    setDetailError(null);
    setIsLoadingDetail(true);
    setScreen('detail');
  };

  const openCreate = () => {
    if (actor && actor.role !== 'reporter') return;
    createAttempt.current = null;
    setCreateError(null);
    setScreen('create');
  };

  const editDraft = () => {
    setCreateError(null);
  };

  const submitCreate = async (input: CreateIncidentInput) => {
    if (actor && actor.role !== 'reporter') return;
    if (createInFlight.current) return;
    createInFlight.current = true;
    const signature = JSON.stringify(input);
    if (createAttempt.current?.signature !== signature) {
      createAttempt.current = { signature, key: newOperationKey() };
    }
    const operationKey = createAttempt.current.key;
    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await client.createIncident(input, operationKey);
      if (result.ok) {
        createAttempt.current = null;
        setSelectedIncidentId(result.value.incident.id);
        setSelectedIncident(result.value.incident);
        setIsLoadingDetail(true);
        setScreen('detail');
        void loadList();
      } else {
        setCreateError(ERROR_MESSAGES[result.error.kind]);
      }
    } catch {
      setCreateError('No fue posible crear la incidencia. Puedes reintentar.');
    } finally {
      createInFlight.current = false;
      setIsCreating(false);
    }
  };

  const applyAction = async (action: IncidentActionInput['action'], diagnosis: string) => {
    if (!client.applyAction || !actor || !selectedIncident || actionInFlight.current) return;
    if (!canPerformIncidentAction(actor, selectedIncident, action)) {
      setDetailError(ERROR_MESSAGES.forbidden);
      return;
    }
    actionInFlight.current = true;
    setIsApplyingAction(true);
    setDetailError(null);
    const input: IncidentActionInput = action === 'resolve'
      ? { action, baseVersion: selectedIncident.version, diagnosis }
      : { action, baseVersion: selectedIncident.version };
    const signature = JSON.stringify({ incidentId: selectedIncident.id, ...input });
    if (actionAttempt.current?.signature !== signature) {
      actionAttempt.current = { signature, key: newOperationKey() };
    }
    try {
      const result = await client.applyAction(selectedIncident.id, input, actionAttempt.current.key);
      if (result.ok) {
        actionAttempt.current = null;
        setSelectedIncident(result.value.incident);
        void loadList();
      } else {
        setDetailError(ERROR_MESSAGES[result.error.kind]);
      }
    } catch {
      setDetailError('No fue posible actualizar la incidencia. Puedes reintentar.');
    } finally {
      actionInFlight.current = false;
      setIsApplyingAction(false);
    }
  };

  if (screen === 'detail' && selectedIncidentId !== null) {
    return (
      <View style={styles.section}>
        <IncidentDetailScreen
          actions={actor && selectedIncident && client.applyAction
            ? (['start', 'resolve', 'close', 'reopen'] as const).filter((action) =>
              canPerformIncidentAction(actor, selectedIncident, action) && isAllowedIncidentTransition(selectedIncident, action))
            : []}
          isApplyingAction={isApplyingAction}
          onAction={(action, diagnosis) => void applyAction(action, diagnosis)}
          error={detailError}
          incident={selectedIncident}
          isLoading={isLoadingDetail}
          onBack={() => {
            detailRequestId.current += 1;
            setSelectedIncidentId(null);
            setScreen('list');
          }}
          onRetry={() => void loadDetail(selectedIncidentId)}
        />
      </View>
    );
  }

  if (screen === 'create') {
    return (
      <View style={styles.section}>
        <IncidentCreateScreen
          error={createError}
          isSaving={isCreating}
          onBack={() => setScreen('list')}
          onEdit={editDraft}
          onSubmit={(input) => void submitCreate(input)}
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <IncidentListScreen
        canCreate={actor === undefined || actor.role === 'reporter'}
        error={listError}
        incidents={incidents}
        isLoading={isLoadingList}
        onCreate={openCreate}
        onRetry={() => void loadList()}
        onSelect={openDetail}
      />
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: 12 } });
