import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CloudIncident } from '../../domain/incidents/CloudIncident';

type IncidentDetailScreenProps = Readonly<{
  incident: CloudIncident | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
}>;

export function IncidentDetailScreen({
  incident,
  isLoading,
  error,
  onBack,
  onRetry,
}: IncidentDetailScreenProps) {
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
