# Auditoría de seguridad — Semana 4

## Alcance de la auditoría

Se revisó el código y los archivos del proyecto CampusOps para identificar posibles problemas de seguridad y privacidad, tomando como referencia los casos indicados en la actividad de Semana 4:

* A. Credenciales o secretos escritos directamente en el código.
* B. Información sensible enviada a consola.
* C. Datos personales almacenados innecesariamente.
* D. Información sensible en mensajes de error.
* E. Archivos sensibles que podrían llegar al repositorio.

La revisión se realizó sobre el código fuente, archivos de configuración, evidencias y el historial de Git. Todos los datos encontrados en los fixtures del curso fueron considerados datos sintéticos cuando el contrato de CampusOps así lo especifica.

## Resultado de la revisión A–E

| Categoría                                                     | Resultado     | Evidencia                                                                                                                                                            |
| ------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Credenciales o secretos escritos directamente en el código | No encontrado | Búsqueda de patrones de contraseñas, tokens, secretos y claves en el código y documentación revisada.                                                                |
| B. Información sensible enviada a consola                     | No encontrado | No se encontraron llamadas `console.log`, `console.error`, `console.warn`, `console.info`, `console.debug` o `console.trace` en `src`.                               |
| C. Datos personales almacenados innecesariamente              | No encontrado | No se encontraron mecanismos de almacenamiento persistente como `AsyncStorage`, `SecureStore`, `localStorage`, `sessionStorage`, MMKV, SQLite o FileSystem en `src`. |
| D. Información sensible en mensajes de error                  | No encontrado | Los errores de la interfaz se reemplazan por mensajes genéricos y no se encontraron usos de `error.message` o `err.message` para mostrarlos al usuario.              |
| E. Archivos sensibles en el repositorio                       | No encontrado | `.env` no está rastreado; solamente existe `.env.example`. La revisión del historial tampoco encontró `.env`, `.pem`, `.key` ni archivos equivalentes.               |

## Hallazgos adicionales de seguridad

La revisión A–E no encontró las vulnerabilidades ejemplificadas por el profesor. Sin embargo, durante la auditoría se identificaron controles de seguridad relacionados directamente con el objetivo de Semana 4 que requieren atención.

| # | Hallazgo                                                                                                  | Riesgo                                                                                                      | Solución aplicada                                                                                       | Evidencia                                                                |
| - | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1 | `redactForTelemetry` está sin implementar                                                                 | La aplicación no puede sanitizar automáticamente información sensible antes de utilizarla en telemetría.    | Control identificado como pendiente de implementación conforme al contrato de CampusOps.                | `src/course-evaluation/index.ts` y `course-tests/public/week-04.test.ts` |
| 2 | No existe un emisor real de telemetría en el código revisado que garantice el uso de `redactForTelemetry` | Un flujo de registro futuro podría conservar información sensible sin pasar por el control de sanitización. | Control identificado como pendiente de integración en un flujo verificable.                             | Búsqueda de referencias a `redactForTelemetry` en `src` y `course-tests` |
| 3 | Se detectaron dependencias transitivas con vulnerabilidades de severidad alta                             | Una dependencia vulnerable puede introducir riesgos de seguridad en la cadena de suministro del proyecto.   | Se documentó el hallazgo para su revisión y actualización compatible con las dependencias del proyecto. | `npm audit --omit=dev --audit-level=moderate`                            |

## Hallazgo 1 — Sanitización de telemetría sin implementar

### Problema encontrado

La función `redactForTelemetry` actualmente no realiza la sanitización de los datos. En su lugar, llama a una función pendiente:

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

El contrato de CampusOps establece que esta función debe ocultar información sensible como autorización, tokens, correos, nombres, identificadores personales, ubicación, fotografías y comentarios internos.

### Riesgo

Mientras el control no esté implementado, no existe una garantía de que esos datos sean transformados a `[REDACTED]` antes de utilizarse en un registro de telemetría.

### Solución

La corrección consiste en implementar `redactForTelemetry` conforme a `docs/CAMPUSOPS_API.md`, incluyendo objetos anidados y listas, sin modificar la entrada original.

### Evidencia

La función pendiente se encontró directamente en `src/course-evaluation/index.ts` y es utilizada por el test público de Semana 4.

---

## Hallazgo 2 — Falta de un flujo verificable de telemetría sanitizada

### Problema encontrado

La revisión de `src` no encontró un emisor real de telemetría conectado a `redactForTelemetry`.

### Riesgo

La existencia de una función de sanitización por sí sola no garantiza que los registros futuros utilicen el control. Un flujo que enviara directamente un objeto original podría exponer datos sensibles.

### Solución

La corrección consiste en integrar `redactForTelemetry` en el punto de emisión o registro de telemetría que corresponda a CampusOps y demostrar mediante una prueba que la información sensible se elimina antes del registro.

### Evidencia

Se realizó una búsqueda de referencias a `redactForTelemetry` dentro de `src` y `course-tests`.

---

## Hallazgo 3 — Dependencias con vulnerabilidades de severidad alta

### Problema encontrado

La auditoría de dependencias actual reportó dos vulnerabilidades de severidad alta:

* `@xmldom/xmldom`
* `js-yaml`

`@xmldom/xmldom` aparece como dependencia transitiva de Expo y sus herramientas relacionadas.

### Riesgo

El uso de versiones vulnerables de dependencias puede introducir riesgos de seguridad en la cadena de suministro del proyecto, aunque el resultado de `npm audit` por sí solo no demuestra que la vulnerabilidad sea explotable directamente desde una ruta de CampusOps.

### Solución

Se debe revisar una actualización compatible de las dependencias y volver a ejecutar la auditoría después del cambio.

### Evidencia

Comando utilizado:

```text
npm audit --omit=dev --audit-level=moderate
```

Resultado:

```text
2 high severity vulnerabilities
```

## Conclusión

La auditoría específica de las categorías A–E no encontró una exposición actual de secretos, información sensible en consola, almacenamiento persistente innecesario, información sensible en mensajes de error ni archivos sensibles rastreados por Git.

Los hallazgos adicionales identificados corresponden a controles de seguridad de Semana 4 y a la seguridad de dependencias. Las correcciones deben demostrarse mediante pruebas reproducibles y evidencia de terminal antes de considerarse cerradas.
