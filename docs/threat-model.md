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

| Amenaza | Control que la reduce | Prueba que lo verifica |
|---|---|---|
| Consultar incidencias ajenas | El backend valida el perfil autenticado antes de devolver una incidencia; la UI solo solicita datos a los que el perfil tiene derecho. | Prueba de contrato que solicita una incidencia con un perfil sin permiso y espera un error de autorización, no los datos. |
| Alterar asignaciones sin autorización | Solo el coordinador puede reasignar; el backend rechaza una transición de estado hecha por un perfil no autorizado para esa acción. | Prueba que intenta reasignar con un token de técnico (no coordinador) y confirma que la operación es rechazada y el estado no cambia. |
| Filtrar datos sensibles en registros | Los logs solo conservan ID sintético, código de error, intento y duración; se sanitiza cualquier campo con nombre, ubicación o contenido de foto antes de escribirlo. | Prueba/escaneo que genera una operación real y revisa que el log resultante no contenga los campos prohibidos (nombre, correo, ubicación, contenido de evidencia). |
| Exponer credenciales o secretos | El CI ejecuta una búsqueda de secretos (`secret_scan`) en cada push, y `.gitignore` excluye `.env`, claves y certificados de firma. | El workflow de GitHub Actions falla si `secret_scan` encuentra un patrón de secreto; se demuestra provocando un hallazgo controlado y confirmando que el proceso falla y lo reporta. |

## Riesgo que atenderíamos primero y por qué

Atenderíamos primero **consultar incidencias ajenas**, porque es la amenaza con mayor superficie de exposición: afecta a los tres perfiles simultáneamente (cualquier reportante, técnico o coordinador podría, por un control ausente, ver datos que no le corresponden), y es la base sobre la que se construyen las demás semanas (sesión, persistencia, asignación). Corregir esto primero evita que una falla de autorización se propague a funciones futuras.

## Riesgo residual

Aun con los controles anteriores, queda un riesgo residual: los datos ficticios de esta actividad no incluyen cifrado en tránsito real ni un sistema de auditoría de accesos; en una implementación real de CampusOps, sería necesario agregar HTTPS obligatorio y un registro de auditoría de quién consultó qué incidencia, control que queda fuera del alcance de esta semana.