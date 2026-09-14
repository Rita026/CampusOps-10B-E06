import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { IncidentQueries } from '../application/incidents/IncidentQueries';
import type { CheckBackendHealth } from '../application/system/checkBackendHealth';
import { IncidentsApp } from './incidents/IncidentsApp';

type CampusOpsAppProps = Readonly<{
  incidentQueries: IncidentQueries;
  checkBackendHealth: CheckBackendHealth;
}>;

export function CampusOpsApp({ incidentQueries, checkBackendHealth }: CampusOpsAppProps) {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>('checking');

  useEffect(() => {
    let active = true;
    checkBackendHealth()
      .then(() => active && setStatus('available'))
      .catch(() => active && setStatus('offline'));
    return () => {
      active = false;
    };
  }, [checkBackendHealth]);

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>
      </View>
      <IncidentsApp queries={incidentQueries} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: 16, padding: 24 },
  card: { gap: 12, paddingVertical: 20 },
  title: { fontSize: 24, fontWeight: '700' },
});
