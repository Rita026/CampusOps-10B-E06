# CampusOps — política de sincronización (semana 8)

Este documento describe cómo la app combina cambios hechos sin conexión con el estado del servidor, cuándo declara un conflicto y cuándo puede retirar una operación de la cola persistente. El modelo de almacenamiento y la migración de la cola están en `docs/data-model.md`.

## Código que aplica la política

| Pieza | Archivo | Responsabilidad |
|---|---|---|
| `resolveSyncRecords` | `src/application/sync/syncResolution.ts` | Combinación de tres vías (base, local, remoto) por campo. |
| `deduplicateByOperationId` | `src/application/sync/syncResolution.ts` | Conserva la primera operación de cada `operationId`. |
| `createPendingWorkOperation` | `src/application/sync/IncidentSyncService.ts` | Crea la intención offline sólo si el actor puede ejecutarla. |
| `IncidentSyncService.synchronize` | `src/application/sync/IncidentSyncService.ts` | Reenvía la cola, clasifica cada operación y retira sólo lo confirmado. |
| `PendingOperationQueue.replace` | `src/application/sync/PendingOperationQueue.ts` | Persiste un rebase conservando posición e identidad. |
| Adaptadores `resolveSync` / `deduplicateOperations` | `src/course-evaluation/index.ts` | Delegan en las dos funciones anteriores; no hay una implementación aparte para las pruebas. |
| Composición | `src/bootstrap/campusOpsServices.ts` | `incidentSync` usa la cola en AsyncStorage, el cliente real y el actor de la sesión. |
| Flujo en la app | `src/ui/incidents/IncidentsApp.tsx` (recibe `offlineSync` desde `App.tsx`) | Encola `start`/`resolve` ante `network`/`timeout`, sincroniza al abrir la sesión y con el botón "Sincronizar pendientes", y muestra el resultado. |

## 1. Identidad estable

- Cada cambio pendiente tiene un `operationId` que se genera una sola vez al crearlo offline y se usa como `Idempotency-Key` en cada envío. Nunca se regenera al reintentar ni al reiniciar la app.
- Si la misma identidad aparece más de una vez (doble toque, cola restaurada dos veces), `deduplicateByOperationId` conserva la **primera** aparición, mantiene el orden y devuelve un arreglo nuevo sin mutar la entrada. `PendingOperationQueue.enqueue` aplica la misma regla al guardar.
- `createPendingWorkOperation` sólo crea `start`/`resolve` si `canPerformIncidentAction` e `isAllowedIncidentTransition` (semana 6) aceptan al actor sobre la incidencia guardada localmente. Por eso la cola puede reconstruir después la base de `work`: el técnico sólo pudo encolar `start` si en `baseVersion` la incidencia estaba `assigned` a él.

## 2. Regla de combinación (`resolveSync`)

Se compara cada campo de primer nivel de `fields` entre la base común, la versión local y la remota. La comparación es por **contenido JSON canónico** (claves ordenadas), no por identidad de objeto ni por orden de claves. Un campo ausente cuenta como un valor propio, distinto de `null`.

| Base → Local | Base → Remoto | Resultado del campo |
|---|---|---|
| sin cambio | sin cambio | se conserva |
| cambió | sin cambio | se toma el local |
| sin cambio | cambió | se toma el remoto |
| cambió | cambió al mismo valor | se acepta una vez |
| cambió | cambió a otro valor | **conflicto** |

- Si algún campo está en conflicto el resultado es `{ kind: 'conflict', fields }`, con los nombres ordenados; no se devuelve una combinación parcial.
- Si no hay conflictos el resultado es `{ kind: 'merged', fields }` con copias nuevas de los valores: modificar el resultado no altera las entradas.
- Comparar versiones de entidades distintas (`id` diferente) lanza un error en vez de mezclarlas.

### `work` agrupa asignado y estado

`work = { assignedTechnicianId, status }` se trata como un solo campo. Un inicio local (`assigned → in_progress`) y una reasignación remota (`technician-1 → technician-2`) cambian ambos `work` desde la misma base, así que son incompatibles aunque toquen sub-campos distintos. Juntar `status` local con `assignedTechnicianId` remoto dejaría una incidencia "en atención" por alguien que no la está atendiendo. Los cambios en otros campos (por ejemplo `priority`) sí se combinan.

## 3. Caso obligatorio: inicio offline + reasignación remota

1. Base común: `campus-inc-X` versión `n`, `work = { technician-1, assigned }`.
2. `technician-1`, sin conexión, inicia la atención: `createPendingWorkOperation` guarda `start` con `baseVersion = n` en la cola persistente.
3. Mientras tanto `coordinator-1` reasigna a `technician-2` en el servidor (versión `n + 1`).
4. Al reconectar, `IncidentSyncService.synchronize()`:
   - Lee la incidencia. Con la autorización real de la semana 6 el técnico ya no puede leerla (403: un técnico sólo ve sus asignaciones). Perder el acceso a una incidencia que tenía permitida significa que se reasignó, así que se declara `{ kind: 'conflict', fields: ['work'] }`.
   - Si el registro remoto sigue siendo legible (por ejemplo, otro backend o un perfil con lectura), el conflicto lo declara `resolveSync` sobre `work`, con el mismo resultado.
   - **No** se envía el `start`: no se impone la asignación antigua ni se sobrescribe la nueva.
   - **No** se retira la operación: la cola conserva la misma identidad y el mismo contenido después de reiniciar y de volver a sincronizar.

### Cómo se informa y se resuelve

- `synchronize()` devuelve un `SyncOutcome` por operación. Para este caso es `conflict` con `fields: ['work']`. `IncidentsApp` muestra el resumen (`sync-notice`) con confirmadas, pendientes y en conflicto por separado, y avisa que el cambio se conserva en el dispositivo sin enviarse. La pantalla detallada por operación queda para la semana 10.
- Resoluciones válidas:
  1. **Coordinación devuelve la asignación al técnico.** En la siguiente sincronización `work` remoto vuelve a ser igual a la base, `resolveSync` combina y la operación se rebasa (ver §5) y se confirma. Lo cubre la prueba "when coordination assigns the incident back…".
  2. **El técnico descarta su intención** con una acción explícita (`pendingOperations.remove(operationId)`). Nunca se descarta de forma automática.
- No es una resolución válida que el técnico se reasigne a sí mismo: `assign` es de coordinación y el backend responde 403.

## 4. Autorización durante la sincronización

- Una operación sólo se envía con la sesión de su autor (`operation.actorId === currentActorId()`). Las de otro actor se dejan en la cola sin enviar ninguna petición. Sin sesión no se sincroniza nada.
- Si la sesión cambia o se cierra a mitad de una sincronización, el recorrido se detiene.
- `CourseIncidentClient.applyAction` vuelve a comprobar `canPerformIncidentAction` antes del POST y el backend lo valida otra vez de forma atómica. Un 403 en ese punto también se reporta como conflicto en `work`.

## 5. Reintento e idempotencia

- **Respuesta perdida:** si el remoto ya muestra el efecto local (`work` remoto igual al local), el servidor aplicó la operación pero la confirmación no llegó. Se reenvía el contenido guardado sin cambios, con la misma clave; el backend responde `200 duplicate: true` y no repite el efecto ni el historial.
- **Cambios independientes:** si `work` remoto sigue igual a la base pero la versión avanzó (por ejemplo, cambió la prioridad), se rebasa `baseVersion` a la versión remota. El rebase se **persiste en la cola antes de enviar** (`PendingOperationQueue.replace`), así cada reintento posterior manda exactamente el contenido que el servidor pudo haber guardado con esa clave. El backend sólo registra la huella de operaciones exitosas, así que el rebase no reutiliza una clave con contenido distinto ya aplicado; si eso pasara, el 409 `idempotency_key_reused` deja la operación en cola.
- **Orden:** si una operación de una incidencia no se confirma, las siguientes de esa misma incidencia quedan `pending` con `waiting_previous`. Un `resolve` no se envía antes que su `start`.
- **Errores de red/servidor** (`timeout`, `network`, `server`, `rate_limited`, `unauthorized`, `contract`, 409 tras el POST): la operación queda `pending` con la razón. La política de espera entre reintentos es de la semana 9 (`planRetry`).

### Desde la app

- Si `applyAction` de `start` o `resolve` termina en `network` o `timeout`, `IncidentsApp` guarda la intención con `createPendingWorkOperation` usando **la misma `operationId` que ya envió como `Idempotency-Key`**. Si la petición sí llegó al servidor, el reenvío se reconoce como `duplicate` en vez de aplicar el efecto dos veces.
- Otros errores (`server`, `forbidden`, `conflict`…) se muestran y no se encolan: no son falta de conexión.
- Si el técnico reintenta en línea y el servidor confirma esa clave, la copia encolada se retira para que no se reenvíe después de acciones posteriores.
- Al montar `IncidentsApp` (inicio de sesión o sesión restaurada al reabrir la app) se ejecuta `synchronize()`; el botón "Sincronizar pendientes" permite repetirlo.

## 6. Cuándo se retira una operación de la cola

| Resultado de `synchronize` | ¿Sale de la cola? |
|---|---|
| `confirmed` (201, o 200 `duplicate: true`) | Sí, después de la confirmación del servidor. |
| `conflict` | No. Espera una resolución (§3). |
| `pending` (error, timeout, `waiting_previous`, `unsupported_action`) | No. |
| Operación de otro actor | No; ni siquiera se envía. |

Un timeout no prueba que el servidor no ejecutó la operación, por eso nunca autoriza a descartarla.

## 7. Pruebas que respaldan cada decisión

| Decisión | Prueba | Comando | Resultado observado |
|---|---|---|---|
| Conflicto `work`, combinación independiente y deduplicación (contrato público) | `course-tests/public/week-08.test.ts` | `npm test -- --runInBand course-tests/public/week-08.test.ts` | PASS, 3/3 pruebas. |
| Comparación JSON canónica, mismo cambio en ambos lados, conflictos ordenados, campos agregados/eliminados, sin mutación, ids distintos, deduplicación | `course-tests/syncResolution.test.ts` | `npm test -- --runInBand course-tests/syncResolution.test.ts` | PASS, 8/8 pruebas. |
| Inicio offline + reasignación: conflicto, cola intacta tras reiniciar y resincronizar, asignación remota sin cambios | `course-tests/incidentSync.integration.test.ts` (backend real) | `npm test -- --runInBand course-tests/incidentSync.integration.test.ts` | PASS: `conflict` en `['work']`; cola igual a la operación original; remoto `assigned` a `technician-2`, sin `start` en el historial. |
| Resolución por reasignación de vuelta (rebase) | misma suite | misma | PASS: `confirmed`, cola vacía, un solo `start` con el `operationId` original. |
| Combinación con cambio remoto independiente (prioridad) | misma suite | misma | PASS: `confirmed`; remoto `in_progress` con prioridad `high`. |
| Respuesta perdida y reenvío con la misma identidad | misma suite | misma | PASS: primer intento `pending/timeout` con la operación en cola; reenvío `confirmed` con `duplicate: true`; un solo `start` en el historial. |
| Falla del servidor y orden por incidencia | misma suite | misma | PASS: `pending/server` y `pending/waiting_previous`; ambas siguen en cola y luego se confirman en orden. |
| Autorización por autor y sin sesión | misma suite | misma | PASS: sin peticiones HTTP con la sesión de `technician-2`, cola intacta. |
| Conflicto calculado por `resolveSync` cuando el remoto es legible | misma suite (cliente controlado) | misma | PASS: `conflict` en `['work']` sin llamar a `applyAction`. |
| Flujo en la app: inicio sin conexión encolado con su clave, reinicio y un solo envío al reconectar; conflicto visible con la cola intacta; reintento en línea que retira la copia; error de servidor no encolado | `course-tests/incidentsAppOfflineSync.test.tsx` | `npm test -- --runInBand course-tests/incidentsAppOfflineSync.test.tsx` | PASS, 4/4 pruebas. |

Las dos suites nuevas juntas: 16/16 pruebas en PASS. `npm run typecheck` y `npm run lint` terminan sin errores.

## 8. Límites conocidos

- Por ahora sólo `start` y `resolve` tienen base de `work` derivable; `comment`, `add_evidence`, `close` y `reopen` se quedan en cola como `pending/unsupported_action` hasta que el cliente las soporte. No se pierden.
- Si el efecto local ya existe en el servidor pero lo aplicó otra operación (otra clave), el reenvío recibe 409 y la operación queda pendiente hasta que el usuario la descarte.
- El conflicto todavía no se guarda como estado propio en la cola: se recalcula en cada sincronización a partir del servidor. La app muestra el resumen; la pantalla de resolución por operación corresponde a la semana 10.
- La sincronización se dispara al abrir la sesión y con el botón; todavía no se detecta automáticamente el regreso de la red (la política de reintentos con espera es de la semana 9).
