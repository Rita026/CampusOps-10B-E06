# CampusOps — modelo de datos local (semana 8)

## Almacenamiento

| Dato | Dónde | Notas |
|------|--------|--------|
| Credenciales de sesión | `expo-secure-store` (`campusops.session.credentials.v1`) | Solo tokens; no cola de incidencias |
| Cola de operaciones pendientes | AsyncStorage (`campusops.sync.state.v1`) | JSON con `schemaVersion` |

## Versión de esquema

- Actual: **`schemaVersion: 1`**
- Forma:

```json
{
  "schemaVersion": 1,
  "pendingOperations": [
    {
      "operationId": "op-start-campus-inc-001",
      "incidentId": "campus-inc-001",
      "actorId": "technician-1",
      "action": "start",
      "payload": { "note": "..." },
      "baseVersion": 1,
      "createdAt": "2026-10-22T12:00:00.000Z"
    }
  ]
}