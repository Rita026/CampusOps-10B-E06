# Controles de seguridad y privacidad — CampusOps

## 1. Sanitización de registros técnicos (Rita González Sánchez)

### Qué se protege
`redactForTelemetry` (en `src/course-evaluation/index.ts`) aplica el contrato de `docs/CAMPUSOPS_API.md`: oculta recursivamente, en objetos y listas anidadas, cualquier campo relacionado con autorización, credenciales, identidad personal (correo, nombre), ubicación, fotografías y comentarios internos, reemplazándolos por `[REDACTED]` sin modificar el objeto original.

### Dónde se aplica
Se conectó con la lógica real en `src/api/courseBackend.ts`: los caminos de error HTTP, red, JSON y contrato envían a `logTelemetry` (`src/infrastructure/telemetry/logTelemetry.ts`) sólo un evento fijo y contexto técnico acotado, que además pasa por `redactForTelemetry` antes de imprimirse.

### Amenaza relacionada
Se conecta directamente con la amenaza "filtrar datos sensibles en registros" identificada en `docs/threat-model.md` (Semana 3).

### Riesgo residual
La sanitización depende de que cada nuevo punto de logging use `logTelemetry` en vez de `console.log` directo; si un desarrollador futuro omite este paso, el dato quedaría expuesto. Se recomienda una regla de lint futura que lo detecte automáticamente.

## 2. Almacenamiento seguro (Enrique)

### Datos y mecanismo elegido

En esta versión, las incidencias de demostración permanecen sólo en RAM (`InMemoryIncidentRepository`); la app aún no inicia sesión ni persiste nombres, ubicaciones, fotos o comentarios. Para las credenciales que entregará el flujo de sesión se añadió `SecureSessionCredentialStore` y su puerto `SessionCredentialStore`, registrado en `campusOpsServices`. Guarda **sólo** `accessToken` y `refreshToken` juntos en una entrada de `expo-secure-store`; ofrece `save`, `load` y `clear`. No se usa `AsyncStorage`, preferencias comunes, archivos planos ni `EXPO_PUBLIC_*` para tokens. El backend didáctico conserva `course-valid-token` como fixture público especificado en `docs/CAMPUSOPS_API.md`, no como secreto productivo.

Elegimos `expo-secure-store` porque está alineado con Expo 57 y usa el almacén protegido del dispositivo: preferencias cifradas con Android Keystore y Keychain en iOS. En iOS solicitamos `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; el plugin de Expo configura la exclusión del respaldo Android para sus datos cifrados. Las operaciones asíncronas comprueban disponibilidad y fallan con un mensaje fijo si el almacén nativo falla; no retroceden a almacenamiento sin cifrar. Una entrada corrupta se elimina y no restaura una sesión parcial. La prueba usa un doble del módulo nativo para verificar escritura, lectura, borrado y fallas; el cifrado en reposo depende de la implementación nativa y requiere prueba adicional en dispositivo.

### Amenazas y errores

El control reduce la exposición de credenciales de sesión en preferencias legibles o respaldos, derivada del activo «identidad y sesión» de `docs/threat-model.md`. `getBackendHealth` ahora devuelve un error público fijo ante fallo HTTP, red, JSON o contrato. La telemetría conserva sólo un evento fijo, la fase o un estado HTTP acotado; nunca registra el cuerpo remoto ni el texto de excepciones, que podrían contener tokens, ubicaciones o detalles internos bajo claves inesperadas. La UI sigue mostrando únicamente el estado `offline`. La revisión del código no encontró secretos productivos escritos directamente; los tokens del simulador son datos de prueba públicos. El escaneo de la entrega se documenta en `reports/week-04/secret-scan.json`.

### Riesgo residual

El almacén protege datos **en reposo**, no frente a un dispositivo comprometido o una app abierta con la sesión cargada en memoria. En iOS puede persistir una entrada de Keychain tras reinstalar la app; el futuro logout debe llamar a `clear`, y el backend debe invalidar la sesión. El adaptador está preparado para el flujo de autenticación de semanas posteriores, pero la app actual no realiza login: las pruebas de semana 4 ejercitan el adaptador directamente y no prueban todavía restauración de sesión de extremo a extremo. Cualquier caché futura de incidencias, cola o fotos necesitará un diseño separado de protección, minimización y borrado. El simulador HTTP local no proporciona autenticación ni transporte seguros de producción.

Referencia de la elección: [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) y [almacenamiento de datos en Expo](https://docs.expo.dev/develop/user-interface/store-data/).

## 3. Pruebas negativas y verificación (Katherine Daniela Gómez Merino)

Se realizaron pruebas negativas con datos sintéticos para comprobar que la sanitización evita la exposición de información protegida en registros técnicos, incluso cuando los datos aparecen dentro de estructuras anidadas, listas y caminos de error.

Las pruebas cubrieron datos de sesión y credenciales (`authorization` y `token`), nombres (`name` y `displayName`), ubicación (`location`, `latitude` y `longitude`), fotografías (`photos`) y comentarios internos (`internalComments`). También se verificó que el contexto técnico seguro, como `incidentId`, `correlationId`, `status`, `attempt` y `durationMs`, permanezca disponible.

El comando ejecutado fue:

`npm.cmd test -- --runInBand course-tests/negative-tests.test.ts`

El resultado observado fue de 1 suite aprobada y 4 pruebas aprobadas, sin fallos. Las pruebas comprobaron la sanitización de datos sensibles anidados y en listas, la protección de datos dentro de un camino de error, la conservación de la entrada original sin mutaciones y la preservación del contexto técnico seguro.

Como comprobación adicional se realizó una búsqueda reproducible de términos relacionados con secretos mediante `git grep`. Las coincidencias encontradas correspondieron a documentación, contratos de prueba y fixtures públicos; no se identificó una credencial productiva en la salida observada.

El riesgo residual es que la protección depende de que los nuevos campos sensibles sean incluidos en las reglas de sanitización y de que el código futuro no registre texto libre sin aplicar el control. Por ello, las pruebas negativas deben mantenerse junto con los cambios relacionados con telemetría y manejo de errores.
