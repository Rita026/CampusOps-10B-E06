import { useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { IncidentClient } from '../application/incidents/IncidentClient';
import type { CheckBackendHealth } from '../application/system/checkBackendHealth';
import type { SessionAccess } from '../application/session/SessionAccess';
import { IncidentsApp, type OfflineSync } from './incidents/IncidentsApp';
import { SessionPanel } from './SessionPanel';

type CampusOpsAppProps = Readonly<{
  incidentClient: IncidentClient;
  checkBackendHealth: CheckBackendHealth;
  session: SessionAccess;
  offlineSync?: OfflineSync;
}>;

export function CampusOpsApp({ incidentClient, checkBackendHealth, session, offlineSync }: CampusOpsAppProps) {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>('checking');
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

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
      <SessionPanel session={session} snapshot={snapshot} />
      {snapshot.actor !== null && ['authenticated', 'expired', 'refreshing'].includes(snapshot.status)
        ? <IncidentsApp actor={snapshot.actor} client={incidentClient} key={snapshot.actor.id} offlineSync={offlineSync} />
        : null}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, gap: 16, padding: 24 },
  card: { gap: 12, paddingVertical: 20 },
  title: { fontSize: 24, fontWeight: '700' },
});
