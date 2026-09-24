# Auditoría de seguridad y privacidad — Semana 4

## Alcance

Se revisaron las rutas de configuración del backend, los datos que podrían llegar a telemetría y las reglas que evitan versionar archivos de entorno. La revisión usa exclusivamente datos sintéticos de CampusOps y no incluye contraseñas, tokens ni datos personales reales.

## Preparación

La auditoría se realizó en la rama `week4/security-audit-quique`, creada antes de modificar archivos. La evidencia visual de la rama se guardará como `docs/evidence/rama-semana4.png`.

Comprobación reproducible:

```cmd
git branch --show-current
```

Resultado observado: `week4/security-audit-quique`.

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---:|---|---|---|---|
| 1 | La función de sanitización de telemetría estaba pendiente y no protegía objetos anidados ni listas. | Un registro futuro podría conservar identificadores, ubicación, correo, tokens, fotos o comentarios internos. | Se implementó una copia recursiva que sustituye campos sensibles por `[REDACTED]` y conserva sólo contexto técnico. | `docs/evidence/telemetria-sanitizada.png` |
| 2 | La URL de `EXPO_PUBLIC_COURSE_BACKEND_URL` se usaba sin validar y podía incluir credenciales incrustadas. | Las variables `EXPO_PUBLIC_*` se exponen en el cliente; una URL con usuario o contraseña divulgaría ese valor. | Se rechazan credenciales incrustadas, se permite HTTP sólo para el backend local de prácticas y se exige HTTPS en endpoints remotos. | `docs/evidence/url-backend-validada.png` |
| 3 | `.gitignore` cubría únicamente `.env`, no las variantes locales de entorno que también puede usar Expo. | Un archivo como `.env.local` o `.env.development` podría añadirse por accidente al repositorio. | Se ignoran las variantes `.env.*` sin ignorar el ejemplo seguro `.env.example`. | `docs/evidence/env-variantes-ignoradas.png` |

## Hallazgo 1 — Telemetría sin sanitización

### Problema encontrado

`src/course-evaluation/index.ts` declaraba `redactForTelemetry`, pero su implementación detenía la ejecución porque aún estaba pendiente. No existía un control reutilizable que pudiera limpiar campos sensibles antes de registrar un objeto de CampusOps.

### Riesgo

Una futura telemetría de sesión, incidencias o errores podría registrar correos, tokens, ubicación, evidencia fotográfica, comentarios internos o historial de asignaciones. Los registros pueden conservarse más tiempo y ser accesibles para personal de soporte, por lo que no deben ser una copia de los datos de la incidencia.

### Solución

Se creó `src/security/redactForTelemetry.ts`. El control recorre objetos y listas sin modificar el valor de entrada. Normaliza claves con guiones o guiones bajos y reemplaza por `[REDACTED]` las categorías sensibles del contrato de CampusOps; conserva, por ejemplo, `incidentId`, `correlationId` y `status` para diagnóstico técnico.

### Antes

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

### Después

```ts
export function redactForTelemetry(input: unknown): unknown {
  return redactTelemetryPayload(input);
}
```

### Evidencia

Se ejecutó una prueba propia con un objeto anidado y una lista, además de la prueba pública del proyecto:

```powershell
npm.cmd test -- --ci --runInBand course-tests/securityTelemetry.test.ts course-tests/public/week-04.test.ts
```

Resultado observado: ambas suites terminaron en `PASS`. La prueba propia confirma la redacción de `authorization`, `display_name`, `email`, `location` y `assignmentHistory`, y confirma que el objeto de entrada conserva sus valores sintéticos.

La captura se guardará como `docs/evidence/telemetria-sanitizada.png`.

## Hallazgo 2 — URL pública sin validación de seguridad

### Problema encontrado

`src/api/courseBackend.ts` tomaba directamente `EXPO_PUBLIC_COURSE_BACKEND_URL` para construir solicitudes. No comprobaba su protocolo ni impedía que incluyera una sección de usuario o contraseña.

### Riesgo

Expo incorpora las variables `EXPO_PUBLIC_*` en el cliente. Si una persona configurara una URL con credenciales incrustadas, estas podrían aparecer en el paquete distribuido o en herramientas de depuración. Además, un endpoint remoto mediante HTTP expondría las solicitudes a una red no confiable.

### Solución

Se agregó `resolveBackendBaseUrl`. La función rechaza URLs inválidas, credenciales incrustadas y HTTP remoto. Conserva el acceso HTTP al simulador local de la materia (`127.0.0.1`, `localhost`, `10.0.2.2` o `::1`) y acepta HTTPS para servicios remotos. El error devuelto no incluye el valor de configuración original.

### Antes

```ts
baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL;
```

### Después

```ts
const baseUrl = resolveBackendBaseUrl(configuredBaseUrl);
```

### Evidencia

Se verificaron una dirección local permitida, una dirección HTTPS remota y dos rechazos: credenciales incrustadas y HTTP remoto.

```powershell
npm.cmd test -- --ci --runInBand course-tests/backendConfiguration.test.ts course-tests/securityTelemetry.test.ts course-tests/public/week-04.test.ts
npm.cmd run typecheck
npm.cmd run lint
```

Resultado observado: 3 suites y 4 pruebas terminaron en `PASS`; TypeScript y ESLint finalizaron sin errores.

La captura se guardará como `docs/evidence/url-backend-validada.png`.

## Hallazgo 3 — Variantes locales de entorno sin ignorar

### Problema encontrado

La regla existente de `.gitignore` sólo excluía el archivo exacto `.env`. Herramientas de Expo y de desarrollo suelen trabajar también con archivos locales como `.env.local` o `.env.development`.

### Riesgo

Una configuración local con credenciales o una URL de desarrollo podría añadirse al repositorio por accidente. Borrar el archivo después de un commit no elimina el dato del historial de Git.

### Solución

Se amplió la regla con `.env.*`, manteniendo `!.env.example` como plantilla segura y versionable. Se comprobará mediante `git check-ignore` que las variantes locales se ignoran y que el archivo de ejemplo no.

### Evidencia

La comprobación reproducible es:

```cmd
git check-ignore -v .env .env.local .env.development
git check-ignore -v .env.example || echo .env.example permanece disponible como plantilla segura.
git status --short
```

La captura se guardará como `docs/evidence/env-variantes-ignoradas.png`.

## Comprobación final

Se ejecutaron las siguientes comprobaciones antes del commit:

```cmd
npm.cmd test -- --ci --runInBand course-tests/backendConfiguration.test.ts course-tests/securityTelemetry.test.ts course-tests/public/week-04.test.ts
npm.cmd run typecheck
npm.cmd run lint
git check-ignore -v .env .env.local .env.development
git check-ignore -v .env.example || echo .env.example permanece disponible como plantilla segura.
git diff --check
git status --short
```

Resultados observados:

- Las 3 suites y sus 4 pruebas terminaron en `PASS`.
- `tsc --noEmit` y `eslint .` finalizaron sin errores.
- `.env`, `.env.local` y `.env.development` quedaron ignorados; `.env.example` permanece disponible como plantilla segura.
- `git diff --check` terminó sin errores de espacios.
- La revisión de `git status --short` no mostró ningún archivo `.env` ni una variante local como cambio a versionar. Los cambios restantes corresponden únicamente al código, las pruebas, esta auditoría y sus capturas.

Las capturas se conservan con nombres claros en `docs/evidence/` y contienen sólo datos sintéticos.
