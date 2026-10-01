import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { IncidentClient } from '../application/incidents/IncidentClient';
import type { CheckBackendHealth } from '../application/system/checkBackendHealth';
import { IncidentsApp } from './incidents/IncidentsApp';

type CampusOpsAppProps = Readonly<{
  incidentClient: IncidentClient;
  checkBackendHealth: CheckBackendHealth;
}>;

export function CampusOpsApp({ incidentClient, checkBackendHealth }: CampusOpsAppProps) {
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
    <ScrollView contentContainerStyle={styles.screen}>
      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>
      </View>
      <IncidentsApp client={incidentClient} />
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, gap: 16, padding: 24 },
  card: { gap: 12, paddingVertical: 20 },
  title: { fontSize: 24, fontWeight: '700' },
});
