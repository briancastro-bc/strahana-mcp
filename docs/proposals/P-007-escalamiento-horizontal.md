# P-007 — Escalamiento horizontal y estado compartido

> **Estado:** Propuesta · **Prioridad:** Media · **Depende de:** más de una instancia en Cloud Foundry

Permitir ejecutar varias instancias de STRAHANA con comportamiento consistente.

## Problema

El MVP es sin estado en lo esencial (los `context_id` son autocontenidos y firmados, y la paginación usa `offset`), pero el **rate limit** se lleva en memoria por instancia. Con N instancias, el límite efectivo por usuario se multiplica por N.

## Propuesta

- Rate limit distribuido con un almacén compartido (Redis on SAP BTP o el servicio equivalente disponible en la subaccount).
- Caché compartida de contextos frecuentes (`hana_context`) por pregunta normalizada + entorno + versión del catálogo.
- Health checks y métricas por instancia.

## Criterios de aceptación

- [ ] Con 2+ instancias, el rate limit por usuario se respeta globalmente.
- [ ] La caída de una instancia no interrumpe la paginación de un resultado.
