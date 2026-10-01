import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CloudIncident } from '../../domain/incidents/CloudIncident';

type IncidentListScreenProps = Readonly<{
  incidents: readonly CloudIncident[];
  isLoading: boolean;
  error: string | null;
  onSelect: (incidentId: string) => void;
  onRetry: () => void;
  onCreate: () => void;
}>;

export function IncidentListScreen({
  incidents,
  isLoading,
  error,
  onSelect,
  onRetry,
  onCreate,
}: IncidentListScreenProps) {
  return (
    <View style={styles.list}>
      <Pressable accessibilityRole="button" onPress={onCreate} style={styles.createButton} testID="open-create-incident">
        <Text style={styles.buttonText}>Crear incidencia</Text>
      </Pressable>

      {isLoading ? <Text accessibilityRole="progressbar">Cargando incidencias…</Text> : null}

      {!isLoading && error !== null ? (
        <View accessibilityRole="alert" style={styles.message}>
          <Text>No fue posible cargar las incidencias: {error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.buttonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}

      {!isLoading && error === null && incidents.length === 0 ? (
        <Text>No hay incidencias para mostrar.</Text>
      ) : null}

      {!isLoading && error === null && incidents.length > 0 ? (
        <View testID="incident-list" style={styles.list}>
          {incidents.map((incident) => (
            <Pressable
              accessibilityRole="button"
              key={incident.id}
              onPress={() => onSelect(incident.id)}
              style={styles.card}
              testID={`incident-row-${incident.id}`}
            >
              <Text style={styles.cardTitle}>{incident.id}</Text>
              <Text>Estado: {incident.status}</Text>
              {incident.details === null ? (
                <Text>Datos de la incidencia no disponibles.</Text>
              ) : (
                <>
                  <Text>Categoría: {incident.details.category}</Text>
                  <Text numberOfLines={2}>{incident.details.description}</Text>
                </>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: { backgroundColor: '#eef4ff', borderRadius: 8, gap: 4, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  message: { gap: 12 },
  createButton: { alignSelf: 'flex-start', backgroundColor: '#164e8c', borderRadius: 6, padding: 10 },
  retryButton: { alignSelf: 'flex-start', backgroundColor: '#164e8c', borderRadius: 6, padding: 10 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
