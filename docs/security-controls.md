# Controles de seguridad y privacidad — CampusOps

## 1. Sanitización de registros técnicos (Rita González Sánchez)

### Qué se protege
`redactForTelemetry` (en `src/course-evaluation/index.ts`) aplica el contrato de `docs/CAMPUSOPS_API.md`: oculta recursivamente, en objetos y listas anidadas, cualquier campo relacionado con autorización, credenciales, identidad personal (correo, nombre), ubicación, fotografías y comentarios internos, reemplazándolos por `[REDACTED]` sin modificar el objeto original.

### Dónde se aplica
Se conectó con la lógica real en `src/api/courseBackend.ts`: los dos caminos de error (falla de conexión, contrato inesperado) pasan su información de diagnóstico por `logTelemetry` (`src/infrastructure/telemetry/logTelemetry.ts`), que a su vez llama a `redactForTelemetry` antes de imprimir cualquier dato.

### Amenaza relacionada
Se conecta directamente con la amenaza "filtrar datos sensibles en registros" identificada en `docs/threat-model.md` (Semana 3).

### Riesgo residual
La sanitización depende de que cada nuevo punto de logging use `logTelemetry` en vez de `console.log` directo; si un desarrollador futuro omite este paso, el dato quedaría expuesto. Se recomienda una regla de lint futura que lo detecte automáticamente.

## 2. Almacenamiento seguro (Enrique)

[Enrique: describe aquí qué mecanismo elegiste, por qué, y qué riesgo residual queda]

## 3. Pruebas negativas y verificación (Katherine)

[Katherine: describe aquí qué caminos de error probaste y cómo confirmaste que no exponen datos]