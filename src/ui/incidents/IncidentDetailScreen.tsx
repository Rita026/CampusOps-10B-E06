import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CloudIncident } from '../../domain/incidents/CloudIncident';
import type { IncidentActionInput } from '../../application/incidents/incidentAuthorization';

type IncidentDetailScreenProps = Readonly<{
  incident: CloudIncident | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  actions?: readonly IncidentActionInput['action'][];
  isApplyingAction?: boolean;
  onAction?: (action: IncidentActionInput['action'], diagnosis: string) => void;
}>;

export function IncidentDetailScreen({
  incident,
  isLoading,
  error,
  onBack,
  onRetry,
  actions = [],
  isApplyingAction = false,
  onAction,
}: IncidentDetailScreenProps) {
  const [diagnosis, setDiagnosis] = useState('');
  const labels = { start: 'Iniciar atención', resolve: 'Resolver incidencia', close: 'Cerrar incidencia', reopen: 'Reabrir incidencia' };
  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text>← Lista de incidencias</Text>
      </Pressable>

      {isLoading ? <Text accessibilityRole="progressbar">Cargando detalle…</Text> : null}

      {!isLoading && (error !== null || incident === null) ? (
        <View accessibilityRole="alert" style={styles.container}>
          <Text>{error ?? 'La incidencia solicitada no está disponible.'}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
            <Text style={styles.buttonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}

      {!isLoading && error === null && incident !== null ? (
        <View testID="incident-detail" style={styles.container}>
          <Text style={styles.title}>Incidencia {incident.id}</Text>
          <Text>Estado: {incident.status}</Text>
          <Text>Versión: {incident.version}</Text>
          {incident.details === null ? (
            <Text testID="incident-null-details">Datos de la incidencia no disponibles.</Text>
          ) : (
            <>
              <Text>Categoría: {incident.details.category}</Text>
              <Text>Prioridad: {incident.details.priority}</Text>
              <Text>Ubicación: {incident.details.location}</Text>
              <Text>Reportante: {incident.details.reporterId}</Text>
              <Text>Técnico: {incident.details.assignedTechnicianId ?? 'Sin asignar'}</Text>
              <Text style={styles.description}>{incident.details.description}</Text>
            </>
          )}
          {actions.includes('resolve') ? (
            <TextInput accessibilityLabel="Diagnóstico de resolución" onChangeText={setDiagnosis}
              placeholder="Diagnóstico" testID="incident-diagnosis-input" value={diagnosis} />
          ) : null}
          {actions.map((action) => (
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: isApplyingAction }}
              disabled={isApplyingAction} key={action} onPress={() => onAction?.(action, diagnosis)}
              style={styles.button} testID={`incident-action-${action}`}>
              <Text style={styles.buttonText}>{labels[action]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  description: { lineHeight: 22 },
  button: { alignSelf: 'flex-start', backgroundColor: '#164e8c', borderRadius: 6, padding: 10 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
