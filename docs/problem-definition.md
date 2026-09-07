# Definición del problema — CampusOps


## Problema

En el campus ficticio, estudiantes y personal necesitan reportar fallas eléctricas, daños en laboratorios, fugas de agua, problemas de conectividad, equipos descompuestos, riesgos de seguridad y necesidades de mantenimiento. CampusOps busca centralizar estos reportes para que puedan ser clasificados, priorizados, asignados, atendidos y cerrados de forma ordenada, permitiendo dar seguimiento a cada incidencia y conservar su historial y evidencias.


## Alcance

### Incluye

- Creación y consulta de incidencias con categoría, descripción, ubicación y fotografías o evidencias.
- Clasificación, priorización, asignación, atención, resolución y cierre de incidencias, con historial de cambios y funciones según el perfil de reportante, técnico y coordinador.

### No incluye

- Atención de emergencias ni despliegue como servicio institucional real.
- Pagos, chat en tiempo real, inteligencia artificial, datos reales, integración con sistemas institucionales reales ni panel web administrativo completo.

## Actores y responsabilidades

- **Reportante:** Crear una incidencia indicando categoría, descripción y ubicación, adjuntar fotografías, consultar sus reportes y agregar información posterior.
- **Técnico:** Consultar las incidencias asignadas, iniciar su atención, registrar diagnóstico, notas y evidencias, y marcar la incidencia como resuelta.
- **Coordinador:** Consultar las incidencias, priorizarlas, asignarlas o reasignarlas a técnicos, revisar historial y evidencias, cerrar una resolución o reabrir un caso.

## Flujo principal

1. Reportar: El reportante crea una incidencia indicando la categoría, descripción, ubicación y, cuando corresponda, fotografías.
2. Asignar: El coordinador consulta la incidencia, establece su prioridad y la asigna a un técnico.
3. Atender: El técnico consulta la incidencia asignada, inicia la atención, registra diagnóstico, notas y evidencias, y marca la incidencia como resuelta.
4. Cerrar: El coordinador revisa la resolución y las evidencias, y cierra la incidencia. Si es necesario, puede reabrir un caso hacia el estado asignado cuando exista un técnico asignado.

## Criterios de aceptación verificables

1. Dado que un reportante crea una incidencia con categoría, descripción y ubicación, cuando registra el reporte, entonces la incidencia queda creada y puede consultarse posteriormente.
2. Dado que existe una incidencia abierta, cuando el coordinador la asigna a un técnico, entonces la incidencia cambia a estado asignado y el técnico puede consultarla entre sus incidencias asignadas.
3. Dado que un técnico ha atendido una incidencia, cuando registra la resolución, entonces la incidencia queda en estado resuelto y el coordinador puede revisarla para cerrarla o reabrirla.

