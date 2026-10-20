# P-010 — Protección de carga para sistemas productivos

> **Estado:** Propuesta · **Prioridad:** Alta (antes de habilitar entornos PRD) · **Depende de:** MVP, [P-006](P-006-politicas-filas-enmascaramiento.md)

Garantizar que las consultas de STRAHANA no degraden un ERP productivo.

## Problema

El MVP se limita a sistemas no productivos y protege la carga con un timeout, un límite de filas y un rate limit. En PRD eso no alcanza: una consulta con un join mal planteado puede consumir memoria y CPU del sistema que usa toda la operación.

## Propuesta

| Control | Descripción |
|---------|-------------|
| **Workload class** de HANA | Asignada al usuario técnico: timeout, límite de memoria y de hilos por sentencia. Definida con BASIS. |
| Pre-chequeo de costo | `EXPLAIN PLAN` antes de ejecutar; rechazo de consultas con un costo estimado por encima del umbral. |
| Réplica de lectura | Si BASIS la ofrece, HANA System Replication *active/active (read enabled)* para desviar las lecturas. |
| Ventanas horarias | Opcional: restringir entornos PRD a ciertos horarios. |

## Criterios de aceptación

- [ ] Una consulta que excede los límites es cancelada por HANA sin afectar a otras sesiones.
- [ ] Las consultas con un costo estimado alto se rechazan antes de ejecutarse, con un mensaje accionable.
- [ ] Aprobación de seguridad y BASIS del cliente antes de habilitar el primer entorno PRD.
