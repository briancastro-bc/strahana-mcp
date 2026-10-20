# P-014 — Escritura controlada (INSERT / UPDATE)

> **Estado:** Propuesta · **Prioridad:** Baja · **Depende de:** [P-003](P-003-propagacion-identidad.md), [P-006](P-006-politicas-filas-enmascaramiento.md), [P-008](P-008-observabilidad-auditoria-avanzada.md)

Permitir modificaciones de datos bajo un flujo con previsualización, aprobación humana y auditoría reforzada.

## Problema

El MVP es estrictamente de solo lectura, por decisión explícita. Algunos casos (corrección de datos por incidencias, cargas puntuales) podrían beneficiarse de un flujo asistido.

## Propuesta

- Herramienta separada (por ejemplo, `hana_change`) que **no ejecuta**: genera una solicitud de cambio con el SQL, la cantidad de filas afectadas (vía `SELECT COUNT`) y una muestra antes/después.
- Aprobación humana fuera del LLM (enlace firmado o flujo de aprobación de BTP).
- Ejecución con un usuario técnico distinto, en una transacción, con respaldo previo de las filas afectadas.
- Nunca en el mismo entorno ni con el mismo usuario técnico que las lecturas.

## Consideraciones

- En S/4HANA, escribir directamente en tablas omite la lógica de negocio ABAP y puede romper la consistencia: solo sería aceptable sobre tablas propias (`Z*`) o en HANA Cloud de proyectos CAP. Para S/4HANA estándar, usar APIs ([P-002](P-002-backend-odata.md)).
- Riesgo alto: requiere una revisión de seguridad específica antes de cualquier implementación.

## Criterios de aceptación

- [ ] Ningún cambio se ejecuta sin la aprobación explícita de una persona autorizada.
- [ ] Cada cambio tiene respaldo, auditoría y un procedimiento de reversión.
