import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Incident } from '../../domain/incidents/Incident';

type IncidentListScreenProps = Readonly<{
  incidents: readonly Incident[];
  isLoading: boolean;
  error: string | null;
  onSelect: (incidentId: string) => void;
  onRetry: () => void;
}>;

export function IncidentListScreen({
  incidents,
  isLoading,
  error,
  onSelect,
  onRetry,
}: IncidentListScreenProps) {
  if (isLoading) {
    return <Text accessibilityRole="progressbar">Cargando incidencias…</Text>;
  }

  if (error !== null) {
    return (
      <View accessibilityRole="alert" style={styles.message}>
        <Text>No fue posible cargar las incidencias: {error}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (incidents.length === 0) {
    return <Text>No hay incidencias ficticias para mostrar.</Text>;
  }

  return (
    <View testID="incident-list" style={styles.list}>
      {incidents.map((incident) => (
        <Pressable
          accessibilityRole="button"
          key={incident.id}
          onPress={() => onSelect(incident.id)}
          style={styles.card}
          testID={`incident-row-${incident.id}`}
        >
          <Text style={styles.cardTitle}>{incident.title}</Text>
          <Text>{incident.id} · Prioridad {incident.priority}</Text>
          <Text>Estado: {incident.status}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: { backgroundColor: '#eef4ff', borderRadius: 8, gap: 4, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  message: { gap: 12 },
  button: { alignSelf: 'flex-start', backgroundColor: '#164e8c', borderRadius: 6, padding: 10 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
