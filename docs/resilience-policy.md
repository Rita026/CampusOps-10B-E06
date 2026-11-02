# CampusOps — política de resiliencia (semana 9)

Este documento describe qué hace la app cuando falla el servicio de ubicación o una escritura en el backend: cuándo reintenta, cuándo sigue con una alternativa y cuándo informa que la operación falló. La cola persistente, la identidad de operación y la resolución de conflictos se mantienen como en `docs/sync-policy.md` (semana 8).

## Código que aplica la política

| Pieza | Archivo | Responsabilidad |
|---|---|---|
| `planRetryWithPolicy` | `src/application/resilience/retryPolicy.ts` | Decide si un intento fallido se repite y cuánto esperar. |
| `parseRetryAfterMs` | `src/application/resilience/retryPolicy.ts` | Convierte `Retry-After` (segundos o fecha HTTP) a milisegundos. |
| `runWithRetry` / `classifyIncidentResult` | `src/application/resilience/runWithRetry.ts` | Repite la misma petición mientras la política lo permite y registra cada intento sin datos sensibles. |
| Adaptador `planRetry` | `src/course-evaluation/index.ts` | Delega en `planRetryWithPolicy` con la política por defecto; no hay una implementación aparte para las pruebas. |
| `CourseIncidentClient` | `src/infrastructure/incidents/CourseIncidentClient.ts` | Entrega `retryAfterMs` en el error cuando el servidor manda `Retry-After`. |
| `IncidentSyncService` (opción `retry`) | `src/application/sync/IncidentSyncService.ts` | Reintenta en el mismo recorrido cada envío de la cola con la clave y el contenido guardados. |
| Composición | `src/bootstrap/campusOpsServices.ts` | La app usa la política por defecto en la sincronización y registra `sync_retry_attempt`. |
| Geocodificación y caché | `src/infrastructure/location/CourseGeocodingGateway.ts`, `CachedGeocodingGateway.ts` | Adaptador del proveedor y caché de resultados válidos (parte de Rita, ver §1). |
| Ubicación manual | `src/application/location/selectIncidentLocation.ts` | Acepta el resultado del proveedor sólo si es válido; si no, usa el texto del usuario (§2). |

## 1. Proveedor, ejecución externa y caché

- **Proveedor:** `CourseGeocodingGateway` consulta `GET /v1/geocoding?q=...` del backend del curso. Es el doble controlado que publica `docs/CAMPUSOPS_API.md`: no consulta lugares reales, no usa cuentas ni cuotas de un proveedor externo y responde `{ label, latitude, longitude }`. Con `X-Course-Scenario` reproduce `rate_limited` (429 con `Retry-After: 1`), `server_error`, `slow`, `incomplete`, `invalid_coordinates` y `malformed`.
- **Restricciones:** tiempo límite de 3 s por consulta (`timeoutMs`), sólo datos ficticios y sin credenciales reales. El adaptador convierte timeout, desconexión, 429, 5xx, 4xx y cuerpos inválidos en un resultado `ok: false`; nunca lanza la excepción hacia la pantalla.
- **Caché:** `CachedGeocodingGateway` guarda en memoria sólo resultados `ok` por consulta normalizada (`trim` + minúsculas). Los errores no se guardan, así que la siguiente consulta vuelve a intentar con el proveedor. La caché se pierde al cerrar la app; no persiste ubicaciones.

## 2. Alternativa manual

`selectIncidentLocation(provider, manualLabel)` acepta únicamente un objeto con `label` no vacío, latitud finita en [-90, 90] y longitud finita en [-180, 180], y devuelve `{ source: 'provider', ... }`. Con `null`, un error representado como dato (`{ status: 429 }`), un objeto incompleto o coordenadas fuera de rango devuelve `{ source: 'manual', label: manualLabel }`: el edificio, zona o referencia que escribió el usuario, **sin inventar coordenadas**. La ubicación no depende de que el proveedor responda, así que reportar una incidencia nunca se bloquea por él.

## 3. Reglas de reintento (`planRetry`)

Entrada: método, estado del intento fallido (`number` o `'timeout'`), número de intento (desde 1), `retryAfterMs` opcional y `idempotencyKey` opcional. Salida: `{ retry, delayMs, requiresStableIdempotencyKey }`. Las reglas se aplican en este orden:

| # | Condición | Resultado |
|---|---|---|
| 1 | `attempt` no es entero ≥ 1, o `attempt >= maxAttempts` (4) | No se reintenta. **Desde el intento 4 nunca se reintenta**: como máximo se envían 4 peticiones. |
| 2 | Estado no transitorio: 400, 401, 403, 404, 409, 422 u otro 4xx | No se reintenta: repetir la misma petición daría la misma respuesta. |
| 3 | `POST` sin clave estable (ausente, vacía o con menos de 8 caracteres, el mínimo del backend) | No se reintenta y `requiresStableIdempotencyKey: true`. |
| 4 | `retryAfterMs` válido (finito y ≥ 0) mayor que `maxRetryAfterMs` (10 s) | No se reintenta: se informa el fallo en vez de dejar al usuario esperando. |
| 5 | `retryAfterMs` válido ≤ 10 s | Se reintenta con `delayMs = retryAfterMs` (redondeado hacia arriba). Nunca antes de lo que pidió el servidor. |
| 6 | Cualquier otro caso transitorio | Se reintenta con espera progresiva: 500, 1000, 2000 ms (`baseDelayMs · 2^(intento-1)`, tope `maxDelayMs` = 4000). |

- **Estados transitorios:** `timeout`, 408, 429, 500, 502, 503 y 504. Un error de red (`network`) también se trata como `timeout`: en ambos no llegó respuesta y el servidor pudo haber guardado el cambio.
- **Retry-After inválido** (negativo, `NaN`, infinito, texto no reconocido): se ignora y se usa la espera progresiva. Ninguna espera es infinita ni negativa.
- **GET** se puede repetir sin clave porque no tiene efecto.
- **Límites configurables y comprobables:** `RetryPolicyConfig` (`maxAttempts`, `baseDelayMs`, `maxDelayMs`, `maxRetryAfterMs`). `assertRetryPolicy` rechaza `maxAttempts` fuera de 1–4 y demoras no finitas, negativas o con `baseDelayMs > maxDelayMs`. Se puede endurecer la política, pero no pasar del límite publicado.
- **Peor caso por operación:** 4 peticiones. Sin `Retry-After` se esperan 3.5 s en total; con `Retry-After`, como máximo 3 × 10 s.
- **Sin jitter:** las esperas son deterministas para poder probarlas. Con muchos dispositivos sincronizando a la vez convendría agregar una variación aleatoria (§8).

## 4. Respuesta perdida tras guardar (resolver o cerrar)

Escenario `timeout_after_commit`: el servidor guarda la acción, registra la huella de la clave y tarda 1.5 s en responder. El cliente aborta antes (su `timeoutMs`), así que sólo ve `timeout`.

1. **Primer intento:** `POST /v1/incidents/:id/actions` con `Idempotency-Key = operationId`. El servidor aplica `resolve` (o `close`) y sube la versión, pero la respuesta no llega. El cliente obtiene `timeout`.
2. **Decisión:** `planRetry` ve `POST` + `timeout` + clave estable + intento 1, y responde reintentar en 500 ms.
3. **Reintento:** `runWithRetry` llama otra vez **la misma función `send`**, que manda la misma clave y el mismo cuerpo. En la cola de la semana 8 son la `operationId` y el `payload`/`baseVersion` ya persistidos; si hubo rebase, se persistió antes del primer envío (ver `docs/sync-policy.md` §5).
4. **Servidor:** la huella coincide y responde `200 { duplicate: true }` sin aplicar otra vez el efecto. El historial conserva **una sola** entrada `resolve` (o `close`) con esa `operationId`.
5. **Cola:** `IncidentSyncService` recibe la confirmación y sólo entonces retira la operación (`confirmed`, `duplicate: true`).

Si con la misma clave se manda un cuerpo distinto (por ejemplo, otra `baseVersion`), el servidor responde `409 idempotency_key_reused`. La política lo trata como respuesta final: no se reintenta y el estado remoto no cambia.

## 5. Cuándo reintentar, cuándo usar la alternativa y cuándo informar el fallo

| Situación | Qué hace CampusOps | Por qué |
|---|---|---|
| Geocodificación falla o devuelve datos inválidos | **Alternativa:** ubicación manual escrita por el usuario. No se reintenta en bucle. | La ubicación textual basta para reportar; esperar al proveedor bloquearía el flujo. |
| Escritura con `timeout`/red/5xx/429 y clave estable, intento < 4 y espera ≤ 10 s | **Reintentar** con la misma clave y cuerpo, tras `Retry-After` o la espera progresiva. | Con clave estable repetir es seguro: el servidor reconoce la operación y no la duplica. |
| Escritura sin clave estable | **Informar fallo.** No se reintenta. | Sin identidad, un reintento tras una respuesta perdida podría duplicar el efecto. |
| 4xx final (403, 409, 422…) | **Informar fallo o conflicto.** No se reintenta. | Repetir no cambia la respuesta; un 409 se resuelve con la política de conflictos de la semana 8. |
| Se agotan los 4 intentos o `Retry-After` > 10 s | **Informar fallo.** En la sincronización la operación queda `pending` en la cola con su clave. | Evita bucles y exceso de peticiones; el cambio no se pierde y se puede volver a sincronizar después. |

Un timeout nunca autoriza a descartar una operación ni a generar una clave nueva: el servidor pudo haberla aplicado.

## 6. Registro de intentos sanitizado

Cada intento produce `{ attempt, outcome, delayMs, durationMs }`: número de intento, resultado (`ok`, `final`, estado HTTP o `timeout`), espera antes del siguiente y duración. No contiene cuerpo, actor, clave, ubicación ni descripción. La app lo registra como `sync_retry_attempt` con `logTelemetry`, que además pasa por `redactForTelemetry` (semana 4).

## 7. Pruebas que respaldan cada decisión

| Decisión | Prueba | Comando | Resultado observado |
|---|---|---|---|
| Contrato público: geocodificación/manual, respuesta perdida con clave, Retry-After, límite del intento 4, POST sin clave | `course-tests/public/week-09.test.ts` | `npm test -- --runInBand course-tests/public/week-09.test.ts` | PASS, 4/4 pruebas. |
| Intentos 1–3 sí y 4–5 no, espera progresiva 500/1000/2000, 4xx finales, Retry-After válido, inválido y > 10 s, parseo de `Retry-After`, clave < 8 caracteres, configuración inválida rechazada, `runWithRetry` acotado a 4 envíos | `course-tests/retryPolicy.test.ts` | `npm test -- --runInBand course-tests/retryPolicy.test.ts` | PASS, 16/16 pruebas. Con falla permanente se observan 4 envíos y esperas `[500, 1000, 2000]`. |
| Resolución perdida reenviada por la cola de la semana 8 | `course-tests/lostResponse.integration.test.ts` (backend real) | `npm test -- --runInBand course-tests/lostResponse.integration.test.ts` | PASS: intentos `[timeout, ok]`, espera `[500]`, 2 POST, `confirmed` con `duplicate: true`, cola vacía, **una** entrada `resolve` con la `operationId` original. |
| Cierre perdido y clave reutilizada con otro cuerpo | misma suite | misma | PASS: `[timeout, ok]` con `duplicate: true` y una sola entrada `close`; la misma clave con otra `baseVersion` recibe 409 en 1 intento, sin cambiar el remoto. |
| 429 con `Retry-After: 1` | misma suite | misma | PASS: 4 POST como máximo, esperas `[1000, 1000, 1000]`, error final `rate_limited` con `retryAfterMs: 1000`, ninguna incidencia creada. |
| 500 persistente | misma suite | misma | PASS: 4 POST, esperas `[500, 1000, 2000]`, error final `server`. |
| Espera real con reloj del sistema | misma suite | misma | PASS: con `maxAttempts: 2` pasa al menos 1 s entre el primer 429 y el segundo intento. |
| La semana 8 sigue igual (sin opción `retry`) | `course-tests/incidentSync.integration.test.ts` | `npm test -- --runInBand course-tests/incidentSync.integration.test.ts` | PASS, 8/8 pruebas: la respuesta perdida sin reintento en el mismo recorrido sigue quedando `pending/timeout`. |

**Las pruebas detectan regresiones** (comprobado modificando el código y restaurándolo después):
- Sin el límite de intentos fallan 7 pruebas.
- Si se ignora `Retry-After` fallan 6.
- Si cada reintento usa una clave nueva falla la prueba de resolución perdida, porque el historial queda con dos `resolve`.

`npm run typecheck`, `npm run lint`, `npm run test:smoke` y `npm run backend:self-test` terminan sin errores.

## 8. Límites conocidos

- **Pantalla de ubicación:** el adaptador de geocodificación y la caché todavía no están conectados a la pantalla de reporte. La captura manual desde la interfaz y la evidencia de una ejecución contra el doble del proveedor quedan como trabajo del equipo.
- **Reintentos en línea:** los reintentos con espera se aplican en la sincronización de la cola y en las operaciones que pasan por `runWithRetry`. El envío directo de `IncidentsApp` sigue encolando ante `network`/`timeout` (semana 8) y no reintenta en la pantalla, para no bloquear al usuario.
- **Sin jitter:** las esperas son deterministas. Con muchos clientes a la vez se recomienda agregar una variación aleatoria acotada.
- **Lectura previa:** si falla la lectura previa (`getIncidentDetail`) dentro de `synchronize`, la operación queda `pending` y se reintenta en la siguiente sincronización. No se reintenta en el mismo recorrido, porque esa lectura decide si hay conflicto.
