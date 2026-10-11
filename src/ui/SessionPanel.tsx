import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionAccess, SessionSnapshot } from '../application/session/SessionAccess';

const ACTORS = [
  { id: 'reporter-1', label: 'Reportante 1' },
  { id: 'reporter-2', label: 'Reportante 2' },
  { id: 'technician-1', label: 'Técnico 1' },
  { id: 'technician-2', label: 'Técnico 2' },
  { id: 'coordinator-1', label: 'Coordinación' },
] as const;

export function SessionPanel({ session, snapshot }: Readonly<{ session: SessionAccess; snapshot: SessionSnapshot }>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const loginDisabled = pending || snapshot.status === 'logging_out';

  const login = async (actorId: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await session.login(actorId);
      if (!result.ok) setError('No fue posible iniciar la sesión. Revisa la conexión e inténtalo de nuevo.');
    } catch {
      setError('No fue posible iniciar la sesión.');
    } finally {
      setPending(false);
    }
  };

  const logout = async () => {
    setPending(true);
    setError(null);
    try {
      await session.logout();
    } catch {
      setError('No se pudo borrar la sesión del dispositivo. Reintenta el cierre de sesión.');
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text testID="session-status">Sesión: {snapshot.status}</Text>
      {error !== null ? <Text accessibilityRole="alert">{error}</Text> : null}
      {snapshot.status === 'logging_out' && !pending && error === null
        ? <Text accessibilityRole="alert">La sesión está bloqueada. Reintenta el cierre para completar el borrado seguro.</Text> : null}
      {snapshot.actor === null ? (
        <>
          <Text style={styles.title}>Iniciar sesión</Text>
          <Text>Selecciona un actor ficticio del laboratorio. Este selector sirve para pruebas académicas.</Text>
          {ACTORS.map((actor) => (
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: loginDisabled }} disabled={loginDisabled}
              key={actor.id} onPress={() => void login(actor.id)} style={styles.button} testID={`login-${actor.id}`}>
              <Text style={styles.buttonText}>{actor.label}</Text>
            </Pressable>
          ))}
        </>
      ) : <Text>Perfil: {snapshot.actor.role} · {snapshot.actor.id}</Text>}
      {snapshot.actor !== null || error !== null || snapshot.status === 'logging_out' ? (
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: pending }} disabled={pending}
          onPress={() => void logout()} style={styles.button} testID="logout-session">
          <Text style={styles.buttonText}>Cerrar sesión</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  button: { alignSelf: 'flex-start', backgroundColor: '#164e8c', borderRadius: 6, padding: 10 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
