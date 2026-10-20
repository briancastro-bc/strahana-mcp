# P-013 — SaaS multi-tenant

> **Estado:** Propuesta · **Prioridad:** Baja · **Depende de:** decisión de negocio, [P-004](P-004-credenciales-servicios-btp.md)

Operar una sola instancia de STRAHANA en la BTP de la consultora, con suscripciones por cliente.

## Problema

El MVP se despliega **una vez por cliente** (en su subaccount de BTP), con múltiples entornos para sus sistemas y schemas. Con muchos clientes, operar N despliegues tiene un costo.

## Propuesta

- SaaS Provisioning service de BTP: cada cliente se suscribe desde su subaccount.
- Aislamiento por tenant: configuración, catálogos, credenciales y auditoría separados por tenant (identificado desde el token de IAS).
- Credenciales por tenant en Destination service o Credential Store ([P-004](P-004-credenciales-servicios-btp.md)).

## Consideraciones

- Los datos de cada cliente transitarían por la infraestructura de la consultora: requiere acuerdos contractuales y de protección de datos.
- El repositorio `ssff-mcp` tiene una propuesta de hosting multi-tenant; alinear el diseño al unificar ([P-015](P-015-unificacion-ssff-mcp.md)).

## Criterios de aceptación

- [ ] Un tenant no puede ver la configuración, los catálogos, los datos ni la auditoría de otro.
- [ ] Alta de un cliente nuevo sin redespliegue.
