import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CreateIncidentInput } from '../../application/incidents/IncidentClient';

type IncidentCreateScreenProps = Readonly<{
  isSaving: boolean;
  error: string | null;
  onBack: () => void;
  onEdit: () => void;
  onSubmit: (input: CreateIncidentInput) => void;
}>;

const CATEGORIES: readonly Readonly<{ value: CreateIncidentInput['category']; label: string }>[] = [
  { value: 'electrical', label: 'Electricidad' },
  { value: 'laboratory', label: 'Laboratorio' },
  { value: 'water', label: 'Agua' },
  { value: 'connectivity', label: 'Conectividad' },
  { value: 'equipment', label: 'Equipo' },
  { value: 'safety', label: 'Seguridad' },
  { value: 'maintenance', label: 'Mantenimiento' },
];

export function IncidentCreateScreen({
  isSaving,
  error,
  onBack,
  onEdit,
  onSubmit,
}: IncidentCreateScreenProps) {
  const [category, setCategory] = useState<CreateIncidentInput['category']>('electrical');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const canSubmit = description.trim().length > 0 && location.trim().length > 0 && !isSaving;

  return (
    <View style={styles.container} testID="incident-create">
      <Pressable accessibilityRole="button" disabled={isSaving} onPress={onBack}>
        <Text>← Lista de incidencias</Text>
      </Pressable>
      <Text style={styles.title}>Crear incidencia</Text>

      <Text style={styles.label}>Categoría</Text>
      <View style={styles.categories}>
        {CATEGORIES.map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: category === item.value, disabled: isSaving }}
            disabled={isSaving}
            key={item.value}
            onPress={() => {
              setCategory(item.value);
              onEdit();
            }}
            style={[styles.category, category === item.value ? styles.categorySelected : null]}
            testID={`category-${item.value}`}
          >
            <Text style={category === item.value ? styles.categoryTextSelected : undefined}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Descripción</Text>
      <TextInput
        accessibilityLabel="Descripción de la incidencia"
        editable={!isSaving}
        multiline
        onChangeText={(value) => {
          setDescription(value);
          onEdit();
        }}
        placeholder="Describe el problema"
        style={[styles.input, styles.description]}
        testID="incident-description-input"
        value={description}
      />

      <Text style={styles.label}>Ubicación</Text>
      <TextInput
        accessibilityLabel="Ubicación de la incidencia"
        editable={!isSaving}
        onChangeText={(value) => {
          setLocation(value);
          onEdit();
        }}
        placeholder="Ej. Edificio de prueba A"
        style={styles.input}
        testID="incident-location-input"
        value={location}
      />

      {error !== null ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={() => onSubmit({ category, description: description.trim(), location: location.trim() })}
        style={[styles.submitButton, !canSubmit ? styles.disabledButton : null]}
        testID="submit-incident"
      >
        <Text style={styles.submitText}>{isSaving ? 'Guardando…' : error === null ? 'Crear incidencia' : 'Reintentar creación'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  label: { fontWeight: '700' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: { borderColor: '#164e8c', borderRadius: 6, borderWidth: 1, padding: 8 },
  categorySelected: { backgroundColor: '#164e8c' },
  categoryTextSelected: { color: '#ffffff' },
  input: { borderColor: '#63758b', borderRadius: 6, borderWidth: 1, minHeight: 44, padding: 10 },
  description: { minHeight: 96, textAlignVertical: 'top' },
  submitButton: { alignSelf: 'flex-start', backgroundColor: '#164e8c', borderRadius: 6, padding: 12 },
  disabledButton: { opacity: 0.45 },
  submitText: { color: '#ffffff', fontWeight: '700' },
});
