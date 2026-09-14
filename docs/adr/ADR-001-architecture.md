# ADR-001 — Arquitectura por capas para CampusOps

## Contexto

CampusOps necesita separar pantallas (lista/detalle de incidencias), reglas de negocio, y el origen real de los datos (backend, almacenamiento local, geocodificación), de forma que el equipo pueda:
- probar la lógica sin depender de Expo, HTTP o un simulador;
- sustituir el backend real por un fake en memoria sin tocar las pantallas;
- incorporar sesión, persistencia y ubicación en semanas futuras sin reescribir el código ya construido.

React Native, Expo y TypeScript ya están definidos como stack; esta decisión no vuelve a elegirlos, solo organiza el código sobre ellos.

## Alternativas consideradas

**Alternativa A — Arquitectura por capas (UI / Application / Domain / Infrastructure).**
El código se organiza por su tipo de responsabilidad: `ui/` (pantallas y presentación), `application/` (casos de uso que coordinan una acción), `domain/` (modelo de una incidencia y el contrato/puerto que la aplicación necesita), `infrastructure/` (implementaciones concretas: fake en memoria hoy, backend HTTP y almacenamiento real más adelante). La UI solo conoce `application`; `application` solo conoce el contrato de `domain`; `infrastructure` implementa ese contrato.

**Alternativa B — Arquitectura por funcionalidad (vertical slices).**
El código se organiza por feature (`features/incidentList/`, `features/incidentDetail/`), y cada carpeta contiene su propia pantalla, lógica y acceso a datos, sin capas transversales compartidas.

## Decisión

Elegimos la **Alternativa A (arquitectura por capas)**.

## Razones

- **Facilidad de prueba:** el contrato de `domain` permite probar `application` con un fake determinista, sin montar ninguna pantalla ni depender de Expo/HTTP — justo lo que exige esta semana (lista/detalle con datos ficticios).
- **Complejidad:** con solo 2 pantallas (lista y detalle) y un fake por ahora, una capa compartida es más simple de razonar que duplicar estructura por feature; la arquitectura por capas escala mejor cuando agreguemos sesión, persistencia y ubicación en semanas futuras, porque cada una es, en sí misma, otra implementación de infraestructura sobre el mismo patrón.
- **Cambio de proveedor:** sustituir el fake de incidencias por un backend real (o el geocodificador, o el almacenamiento local) solo implica escribir una nueva clase en `infrastructure/` que cumpla el mismo contrato de `domain` — la UI y los casos de uso no cambian.

La Alternativa B habría facilitado el trabajo en paralelo de features aisladas, pero habría dificultado compartir el contrato común de incidencia entre lista y detalle, y habría duplicado la lógica de acceso a datos en cada feature — un costo mayor cuando ambas pantallas ya comparten el mismo modelo y el mismo repositorio.

## Consecuencias / Trade-off

**Ganamos:** una UI que nunca conoce infraestructura directamente, casos de uso probables de forma aislada, y un punto único (el contrato de `domain`) para sustituir el fake por integraciones reales en semanas futuras (backend, almacenamiento, geocodificación) sin tocar pantallas.

**Aceptamos como costo:** una capa adicional de indirección (el contrato/puerto) que agrega algunos archivos más comparado con importar los datos directamente desde la pantalla; para un proyecto de 2 pantallas esto es más estructura de la estrictamente necesaria hoy, pero se justifica porque CampusOps va a crecer con sesión, persistencia offline y ubicación en los próximos hitos.

## Límites que impone esta decisión

- La UI (`src/ui/`) no debe importar nada de `src/infrastructure/` directamente.
- `src/application/` solo depende del contrato definido en `src/domain/`, nunca de una clase concreta de infraestructura.
- `src/infrastructure/` implementa el contrato de `src/domain/`, pero `src/domain/` nunca importa nada de infraestructura.
- `src/bootstrap/` es el *composition root*: selecciona `InMemoryIncidentRepository` y los adaptadores concretos, los inyecta en los casos de uso y no contiene pantallas.

## Contraste y corrección de dependencias (AC-03)

Como comprobación controlada se añadió de forma temporal un `import type` de `InMemoryIncidentRepository` dentro de `src/ui/IncidentsApp.tsx`. El escáner de imports lo detectó como una dependencia prohibida de UI hacia infraestructura. Aunque fuera un import de tipos, la pantalla quedaba acoplada al fake concreto y cambiarlo por HTTP o persistencia obligaría a modificar la UI. Se retiró ese import: `IncidentsApp` ahora recibe sólo `IncidentQueries` desde `application`, y `src/bootstrap/campusOpsServices.ts` conserva la elección de `InMemoryIncidentRepository`. La comprobación posterior no encontró importaciones de `infrastructure` dentro de `src/ui/`.
