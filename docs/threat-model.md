# Modelo de amenazas — CampusOps

## Activos que se protegen

- **Datos de incidencias:** categoría, descripción, ubicación y evidencia fotográfica adjunta por el reportante.
- **Identidad y sesión:** credenciales y token de sesión de reportantes, técnicos y coordinadores.
- **Asignaciones:** relación entre una incidencia y el técnico responsable, y su historial de cambios.
- **Registros técnicos (logs):** salida generada por la app y el backend durante su operación.
- **Ubicación:** coordenadas o referencia de lugar asociada a una incidencia.

## Fronteras de confianza

- **Dispositivo del usuario ↔ backend de CampusOps:** cualquier dato que sale del dispositivo (creación de incidencia, cambio de estado, foto) cruza esta frontera y deja de estar bajo control exclusivo del usuario.
- **Perfil autenticado ↔ datos de otro perfil:** un reportante, técnico o coordinador solo debería ver la porción de datos que su rol autoriza; esta frontera separa "mis datos" de "datos ajenos" dentro del mismo sistema.
- **Aplicación ↔ registros técnicos:** lo que la app decide escribir en un log cruza de "dato operativo" a "texto potencialmente persistente y visible para quien tenga acceso a los logs".
- **Repositorio de código ↔ mundo público:** al ser un repositorio público de GitHub, cualquier credencial o secreto que cruce esta frontera queda expuesto públicamente de forma permanente (incluso si se borra después, queda en el historial).

## Amenazas priorizadas

| Prioridad | Amenaza | Por qué importa |
|---|---|---|
| 1 | **Consultar incidencias ajenas.** Un reportante o técnico accede a incidencias que no le fueron asignadas ni reportó. | Viola la frontera de confianza entre perfiles; expone descripciones, ubicaciones y fotos de otros usuarios sin autorización. |
| 2 | **Alterar asignaciones sin autorización.** Un técnico cambia el estado o la asignación de una incidencia que no le corresponde. | Corrompe la integridad del flujo de atención (reportar→asignar→atender→cerrar) y puede ocultar o desviar la atención real de una incidencia. |
| 3 | **Filtrar datos sensibles en registros (logs).** El registro técnico conserva nombre, correo, ubicación exacta o contenido de fotos/comentarios. | Expone datos personales aunque sean sintéticos en este ejercicio; en un entorno real, violaría privacidad básica. |
| 4 | **Exponer credenciales o secretos en el repositorio.** Un token, contraseña o clave de firma queda commiteado en el código. | El repositorio es público; una credencial expuesta ahí queda comprometida de forma permanente y es explotable por cualquiera. |

## Controles y verificación por amenaza

| Amenaza | Control que la reduce | Implementación o alcance actual | Comprobación reproducible y resultado esperado |
|---|---|---|---|
| Consultar incidencias ajenas | El backend autoriza cada consulta con el actor de la solicitud y limita la lista a las incidencias visibles para ese actor. No se confía en que la UI oculte datos. | `course-backend/campusops.mjs` concentra la regla `visible`: un reportante ve sólo lo que reportó, un técnico sólo lo asignado y el coordinador puede consultar el conjunto. | `npm run backend:self-test` consulta la incidencia `campus-inc-001` como `reporter-2` y espera `403`; también espera una lista vacía para ese perfil. El diagnóstico esperado no incluye los datos de la incidencia. |
| Alterar asignaciones sin autorización | Sólo el coordinador puede ejecutar `assign`; las acciones de técnico requieren, además, que la incidencia continúe asignada a ese técnico. El backend rechaza la operación antes de alterar el estado. | `course-backend/campusops.mjs` separa `coordinatorActions` y `technicianActions`; el self-test usa únicamente identidades sintéticas. | `npm run backend:self-test` confirma que un reportante no puede cerrar una incidencia (`403`) y que, tras reasignarla al técnico 2, el técnico 1 recibe `403` al intentar iniciarla. El registro posterior conserva la asignación al técnico 2. |
| Filtrar datos sensibles en registros (logs) | Toda telemetría futura debe permitir sólo identificador sintético, código de error, intento y duración; nombre, correo, ubicación precisa y contenido de evidencia se deben omitir o redactar antes de registrar. | En la versión actual no hay un emisor de logs de incidencias; por ello no se debe afirmar una sanitización ya implementada. Esta regla es un requisito para cualquier log que se agregue después. | Antes de introducir logs, una prueba debe provocar una operación con datos ficticios y afirmar que la salida sólo contiene los campos permitidos. El resultado y cualquier fallo se registrarán en `reports/week-03/security.json`; no se guardarán los valores sensibles usados por el caso de prueba. |
| Exponer credenciales o secretos | El evaluador ejecuta `secret_scan` en cada verificación y `.gitignore` excluye `.env`, claves y certificados de firma. El flujo conserva los reportes incluso si un paso falla. | `tools/course_public_evaluator.py` detecta patrones de claves privadas, tokens de GitHub, claves AWS y variables públicas que declaran secretos; el workflow llama a `make verify-week-03` y publica `reports/week-03/**`. | `make verify-week-03` debe terminar correctamente sin hallazgos. Para el caso obligatorio de falla se crea un archivo temporal con un patrón ficticio, se confirma que el chequeo `secret_scan` falla con la ruta diagnosticada y se elimina el archivo; después se repite la comprobación con éxito. El reporte conserva el comando, el código/diagnóstico y el resultado corregido, nunca el valor del patrón. |

Las comprobaciones de autorización existentes están en el doble de backend del curso, no sustituyen una autenticación de producción. La evidencia de esta semana debe indicar el SHA evaluado y los resultados realmente observados; una descripción del control, sin el comando y su salida, no es evidencia suficiente.

## Riesgo que atenderíamos primero y por qué

Atenderíamos primero **consultar incidencias ajenas**, porque es la amenaza con mayor superficie de exposición: afecta a los tres perfiles simultáneamente (cualquier reportante, técnico o coordinador podría, por un control ausente, ver datos que no le corresponden), y es la base sobre la que se construyen las demás semanas (sesión, persistencia, asignación). Corregir esto primero evita que una falla de autorización se propague a funciones futuras.

## Riesgo residual

Aun con los controles anteriores, queda un riesgo residual: los datos ficticios de esta actividad no incluyen cifrado en tránsito real ni un sistema de auditoría de accesos; en una implementación real de CampusOps, sería necesario agregar HTTPS obligatorio y un registro de auditoría de quién consultó qué incidencia, control que queda fuera del alcance de esta semana.
