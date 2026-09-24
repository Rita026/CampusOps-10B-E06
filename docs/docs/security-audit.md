# Auditoría de seguridad — Semana 4

## Introducción

Durante la revisión del proyecto CampusOps no se encontraron vulnerabilidades críticas existentes ni credenciales reales expuestas.

Para realizar la actividad de auditoría de seguridad se implementó un ejemplo controlado utilizando información ficticia, con el objetivo de identificar una mala práctica de seguridad, analizar el riesgo que representa y aplicar una solución adecuada.

El proceso realizado fue:

**Problema → Riesgo → Corrección → Evidencia**

---

# Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Clave de prueba escrita directamente dentro del código fuente | Una persona con acceso al repositorio podría visualizar la clave y utilizarla si fuera una credencial real | Se reemplazó el valor escrito directamente por una variable de entorno | api-key-corregida.png |
| 2 | Revisión de manejo de información sensible en consola | Mostrar información completa de objetos podría exponer datos privados durante la ejecución | Se revisaron los mensajes de consola para evitar mostrar información sensible | revision-logs.png |
| 3 | Revisión de archivos sensibles del proyecto | Archivos con variables privadas podrían subirse accidentalmente al repositorio | Se verificó la configuración del archivo `.gitignore` para proteger variables de entorno | gitignore-env.png |

---

# Hallazgo 1 — Clave escrita directamente en el código

## Problema encontrado

Durante la auditoría se creó un ejemplo controlado de una mala práctica de seguridad. Una clave ficticia se encontraba escrita directamente dentro del archivo de configuración:

```ts
export const DEMO_API_KEY = 'demo_key_123456';