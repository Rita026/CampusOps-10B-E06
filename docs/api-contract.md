# Contrato de API — CampusOps (Semana 5)

## Transporte y autenticación

Todas las solicitudes van contra el backend didáctico (`course-backend`), nunca contra un servicio real. Requieren:
- `Authorization: Bearer course-valid-token`
- `X-Course-Actor: <id del actor>` (ej. `reporter-1`, `technician-1`, `coordinator-1`)

El header `X-Course-Scenario` permite simular variantes sin depender de internet: `success`, `nullable`, `malformed`, `server_error`, `rate_limited`, `slow`.

## Consultar lista de incidencias

`GET /v1/incidents`

**Respuesta (200):**
```json
{ "items": [ { "id": "campus-inc-001", "version": 1, "status": "assigned", "payload": { "category": "connectivity", "description": "...", "location": "...", "reporterId": "...", "assignedTechnicianId": "...", "priority": "medium", "notes": [], "evidence": [], "history": [] } } ] }
```
Solo se reciben las incidencias visibles para el actor autenticado (reportante ve las suyas, técnico las asignadas, coordinador todas).

## Consultar detalle de una incidencia

`GET /v1/incidents/:id`

**Respuesta (200):** el mismo "sobre" `{ id, version, status, payload }` de un solo elemento, directamente (no envuelto en `items`).
**Respuesta (403):** `{ "code": "forbidden" }` si el actor no tiene visibilidad sobre esa incidencia.
**Respuesta (404):** `{ "code": "not_found" }` si no existe.

## Crear una incidencia

`POST /v1/incidents`

Requiere header `Idempotency-Key` (string de al menos 8 caracteres) y body:
```json
{ "category": "electrical", "description": "...", "location": "..." }
```
`category` debe ser una de: `electrical`, `laboratory`, `water`, `connectivity`, `equipment`, `safety`, `maintenance`.

**Respuesta (200):** `{ "incident": {...sobre...}, "operationId": "<key>", "duplicate": false }`
**Respuesta (422):** `{ "code": "invalid_incident" }` si falta un campo o la categoría no es válida.
**Respuesta (409):** `{ "code": "idempotency_key_reused" }` si se reutiliza la misma clave con un cuerpo distinto.

## El "sobre" (DTO) que valida parseRemoteResource

Todo intercambio de una incidencia individual respeta esta forma, sin importar el endpoint:

- `id`: string, no vacío
- `version`: number, entero, mayor o igual a 0
- `status`: string, no vacío
- `payload`: objeto, o `null`

Campos adicionales no declarados (forward-compatible) se ignoran, no provocan rechazo.

`parseRemoteResource` valida únicamente este sobre — **no** valida el contenido interno de `payload`. Esa validación (categoría válida, descripción no vacía, etc.) ocurre en una capa posterior, antes de convertir el DTO en el modelo `Incident` que usa la UI.

## Representación de errores

El cliente HTTP nunca deja una excepción sin controlar. Cada solicitud devuelve un resultado distinguible por tipo:

| Situación | Resultado | Qué hace la app |
|---|---|---|
| Respuesta válida | `{ ok: true, value: Incident }` | Usa los datos normalmente |
| Payload `null` válido (ej. escenario `nullable`) | `{ ok: true, value: {..., payload: null} }` | Lo trata como incidencia sin detalle aún cargado, sin inventar datos |
| Sobre malformado / tipo incorrecto | `{ ok: false, error: 'contract' }` | Rechaza la respuesta, no la muestra como si fuera válida |
| Error de servidor (500) | `{ ok: false, error: 'server' }` | Muestra mensaje de reintento, no expone el detalle técnico |
| Timeout / sin respuesta | `{ ok: false, error: 'timeout' }` | Muestra mensaje de conexión, permite reintentar |
| JSON malformado (`scenario=malformed`) | `{ ok: false, error: 'contract' }` | Igual que un sobre inválido |

## Separación de responsabilidades

- **DTO (lo que llega del servidor):** el "sobre" `{ id, version, status, payload }`, validado por `parseRemoteResource`.
- **Modelo de dominio (lo que usa la app):** el tipo `Incident` ya definido desde la Semana 2 (`src/domain/incidents/Incident.ts`), construido únicamente a partir de un DTO ya validado.
- La UI nunca llama `fetch` directamente ni conoce la forma del DTO; solo conoce el modelo de dominio, a través de la capa de cliente (`src/infrastructure/incidents/`).