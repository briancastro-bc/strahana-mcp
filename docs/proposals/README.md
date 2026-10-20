# Propuestas de STRAHANA

Funcionalidades **fuera del MVP**. Cada propuesta describe el problema, la solución propuesta, sus dependencias y sus criterios de aceptación. El alcance del MVP está en [`../00-pov.md`](../00-pov.md).

## Cómo usar esta carpeta

- Una propuesta no autoriza implementación. Para pasar al roadmap necesita una decisión explícita del responsable del activo.
- Al aprobarse, su estado cambia a `Aprobada` y se planifica; al implementarse, a `Implementada`, con un enlace al cambio.
- Si una propuesta queda obsoleta, se marca `Descartada` con el motivo; no se borra.

## Índice

| ID | Propuesta | Prioridad | Disparador para retomarla |
|----|-----------|-----------|---------------------------|
| [P-001](P-001-llm-intermedio-servidor.md) | LLM intermedio en el servidor (NL → Query IR) | Media | MVP estable + evaluación continua disponible |
| [P-002](P-002-backend-odata.md) | Backend OData para S/4HANA | Alta si la licencia es *runtime* | Licencia que impide el SQL directo, o S/4HANA Cloud Public |
| [P-003](P-003-propagacion-identidad.md) | Propagación de identidad | Media | Necesidad de auditoría por persona en la base de datos |
| [P-004](P-004-credenciales-servicios-btp.md) | Credenciales gestionadas con servicios de BTP | Media | Rotación frecuente o muchos entornos por cliente |
| [P-005](P-005-busqueda-semantica-embeddings.md) | Búsqueda semántica del catálogo | Baja | Catálogos con más de ~100 entidades |
| [P-006](P-006-politicas-filas-enmascaramiento.md) | Políticas de filas y enmascaramiento | **Alta** | Antes de habilitar entornos productivos |
| [P-007](P-007-escalamiento-horizontal.md) | Escalamiento horizontal | Media | Más de una instancia en Cloud Foundry |
| [P-008](P-008-observabilidad-auditoria-avanzada.md) | Observabilidad y auditoría avanzada | Media | Uso más allá del piloto |
| [P-009](P-009-evaluacion-continua.md) | Evaluación continua de precisión | Alta | Prerequisito de P-001 y P-005 |
| [P-010](P-010-proteccion-carga-productivo.md) | Protección de carga para productivo | **Alta** | Antes de habilitar entornos productivos |
| [P-011](P-011-catalogo-asistido.md) | Generación y validación asistida del catálogo | Media | Segundo dominio o primer upgrade de S/4HANA |
| [P-012](P-012-exportacion-resultados.md) | Exportación de resultados grandes | Baja | Demanda de análisis sobre miles de filas |
| [P-013](P-013-saas-multitenant.md) | SaaS multi-tenant | Baja | Decisión de negocio |
| [P-014](P-014-escritura-controlada.md) | Escritura controlada | Baja | Decisión explícita + P-003, P-006 y P-008 |
| [P-015](P-015-unificacion-ssff-mcp.md) | Unificación con SSFF MCP | Media | MVP estable + transporte HTTP en `ssff-mcp` |
| [P-016](P-016-soporte-s4hana.md) | Soporte de S/4HANA | Alta | Después del piloto en HANA Cloud |
| [P-017](P-017-autenticacion-ias.md) | Autenticación con IAS | Alta | Antes de ampliar el piloto más allá de pocos usuarios |

## Plantilla

```markdown
# P-0XX — Título

> **Estado:** Propuesta · **Prioridad:** Alta | Media | Baja · **Depende de:** …

Resumen en una oración.

## Problema
## Propuesta
## Consideraciones
## Criterios de aceptación
## Preguntas abiertas (opcional)
```
