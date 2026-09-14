import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Incident } from '../../domain/incidents/Incident';

type IncidentDetailScreenProps = Readonly<{
  incident: Incident | null;
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
  if (isLoading) {
    return <Text accessibilityRole="progressbar">Cargando detalle…</Text>;
  }

  if (error !== null || incident === null) {
    return (
      <View accessibilityRole="alert" style={styles.container}>
        <Text>{error ?? 'La incidencia solicitada ya no está disponible.'}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Reintentar</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text>Volver a la lista</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View testID="incident-detail" style={styles.container}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text>← Lista de incidencias</Text>
      </Pressable>
      <Text style={styles.title}>{incident.title}</Text>
      <Text>{incident.id} · {incident.category} · prioridad {incident.priority}</Text>
      <Text>Estado: {incident.status}</Text>
      <Text>Ubicación: {incident.locationLabel}</Text>
      <Text>Reportó: {incident.reporterLabel}</Text>
      <Text>Técnico: {incident.assignedTechnicianLabel ?? 'Sin asignar'}</Text>
      <Text style={styles.description}>{incident.description}</Text>
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
