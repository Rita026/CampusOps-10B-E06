import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { IncidentQueries } from '../../application/incidents/IncidentQueries';
import type { Incident } from '../../domain/incidents/Incident';
import { IncidentDetailScreen } from './IncidentDetailScreen';
import { IncidentListScreen } from './IncidentListScreen';

type IncidentsAppProps = Readonly<{ queries: IncidentQueries }>;

export function IncidentsApp({ queries }: IncidentsAppProps) {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      setIncidents(await queries.listIncidents());
    } catch {
      setListError('Intenta nuevamente.');
    } finally {
      setIsLoadingList(false);
    }
  }, [queries]);

  const loadDetail = useCallback(async (incidentId: string) => {
    setIsLoadingDetail(true);
    setDetailError(null);
    try {
      const detail = await queries.getIncidentDetail(incidentId);
      if (detail === null) {
        setDetailError('La incidencia solicitada no existe.');
      }
      setSelectedIncident(detail);
    } catch {
      setDetailError('No fue posible cargar el detalle.');
      setSelectedIncident(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }, [queries]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadList();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [loadList]);

  useEffect(() => {
    if (selectedIncidentId === null) {
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      void loadDetail(selectedIncidentId);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [loadDetail, selectedIncidentId]);

  if (selectedIncidentId !== null) {
    return (
      <View style={styles.section}>
        <IncidentDetailScreen
          error={detailError}
          incident={selectedIncident}
          isLoading={isLoadingDetail}
          onBack={() => setSelectedIncidentId(null)}
          onRetry={() => void loadDetail(selectedIncidentId)}
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <IncidentListScreen
        error={listError}
        incidents={incidents}
        isLoading={isLoadingList}
        onRetry={() => void loadList()}
        onSelect={setSelectedIncidentId}
      />
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: 12 } });
