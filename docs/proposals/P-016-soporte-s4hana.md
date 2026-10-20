# P-016 — Soporte de S/4HANA

> **Estado:** Propuesta · **Prioridad:** Alta (después del piloto en HANA Cloud) · **Depende de:** MVP, [P-006](P-006-politicas-filas-enmascaramiento.md)

Extender STRAHANA para consultar bases HANA de S/4HANA (on-premise o RISE), además de SAP HANA Cloud propio.

## Problema

El MVP se pilotea sobre SAP HANA Cloud propio. S/4HANA agrega requisitos contractuales, de red y de modelo de datos que no aplican al piloto.

## Propuesta

| Tema | Qué se agrega |
|------|---------------|
| **Licenciamiento** | Compuerta obligatoria por cliente: confirmar por escrito que la licencia de HANA permite el acceso SQL directo (*full use* o autorización de SAP). Con licencia *runtime* (REAB), usar [P-002](P-002-backend-odata.md). En S/4HANA Cloud Public Edition no hay acceso a la base de datos. |
| **Conectividad** | Connectivity service + Cloud Connector (TCP) para sistemas on-premise. Validar cómo `@sap/hana-client` usa el proxy del Connectivity service. |
| **Mandante** | Campo `sapClient` en el entorno y `clientColumn` (normalmente `MANDT`) en las entidades del catálogo. Regla de validación: cada entidad dependiente del mandante debe tener el predicado `alias.MANDT = '<mandante>'` en un `AND` de nivel superior del `WHERE` o del `ON` (error `SQL_CLIENT_FILTER`). La regla se agrega al contexto. |
| **Vistas CDS de ABAP** | Preferir vistas liberadas (`I_*`, `C_*`). Verificar las variables de sesión (por ejemplo, `CDS_CLIENT`) que algunas vistas necesitan al consultarse por SQL nativo, y fijarlas al abrir la conexión. En vistas CDS clásicas, usar el nombre de la vista SQL. |
| **Schema** | El schema ABAP (normalmente `SAPHANADB` o `SAPABAP1`) se configura por entorno. |
| **Autorizaciones ABAP** | Por SQL no aplican los roles PFCG ni las access controls de CDS. Requiere [P-006](P-006-politicas-filas-enmascaramiento.md) y un catálogo especialmente restringido. |
| **Textos e idiomas** | Relaciones de texto con clave de idioma (`SPRAS`) declaradas en el catálogo. |
| **Upgrades** | Los nombres a nivel de base de datos no son un contrato estable: verificar el catálogo después de cada upgrade ([P-011](P-011-catalogo-asistido.md)). |
| **Rendimiento** | El ERP es compartido: aplicar [P-010](P-010-proteccion-carga-productivo.md) incluso en QAS si hay pruebas de usuarios en curso. |

## Criterios de aceptación

- [ ] Licencia confirmada por escrito para el sistema destino.
- [ ] Una consulta sin filtro de mandante se rechaza con un mensaje accionable.
- [ ] Las consultas sobre vistas CDS devuelven los mismos datos que en el sistema ABAP para el mismo mandante.
- [ ] Conexión estable a un sistema on-premise vía Cloud Connector.
