# P-001 — LLM intermedio en el servidor (NL → Query IR)

> **Estado:** Propuesta · **Prioridad:** Media · **Depende de:** MVP en producción, [P-009](P-009-evaluacion-continua.md)

Mover la traducción de lenguaje natural a consulta desde el LLM del usuario hacia un LLM propio del servidor (SAP Generative AI Hub), que produce una **representación intermedia (Query IR)** en JSON en lugar de SQL.

## Problema

En el MVP, el LLM del usuario recibe el contexto del catálogo y escribe el SQL. Eso implica:

- La precisión depende del asistente que use cada persona (modelos distintos, resultados distintos).
- El contexto del catálogo consume tokens del usuario en cada pregunta nueva.
- El servidor debe validar SQL libre en un dialecto (HANA) sin parser oficial en Node.

## Propuesta

```
pregunta NL ─► recuperación del catálogo ─► LLM del servidor (AI Hub, salida estructurada)
            ─► Query IR (JSON) ─► validación ─► compilador determinista ─► SQL parametrizado
```

- Nueva herramienta `hana_ask(question)`: el usuario solo envía la pregunta y recibe el resultado. El catálogo nunca entra a su contexto.
- El LLM del servidor recibe **solo** la pregunta y metadatos del catálogo; nunca filas de datos.
- La IR solo admite `from`, `select`, `where`, `groupBy`, `orderBy`, `limit` y relaciones declaradas en el catálogo. El compilador solo emite `SELECT`, con identificadores del catálogo y valores como parámetros.
- Caché de IR por pregunta normalizada + entorno + versión del catálogo.
- Un solo intento de reparación por pregunta.

## Por qué no se hace en el MVP

- Agrega un servicio (AI Core / Generative AI Hub) y su costo por consumo.
- Exige un conjunto de evaluación ([P-009](P-009-evaluacion-continua.md)) para no degradar la precisión al cambiar el modelo o el prompt.
- El MVP valida primero el valor del catálogo y del acceso controlado, que son prerequisitos de esta propuesta.

## Beneficios esperados

| Aspecto | MVP (LLM del usuario) | Con P-001 |
|---------|-----------------------|-----------|
| Tokens en el asistente del usuario | Contexto del catálogo + SQL generado | Solo la pregunta y el resultado |
| Consistencia entre asistentes | Variable | Uniforme |
| Garantía de solo lectura | Validación de SQL + permisos de BD | Por construcción (compilador) |
| Portabilidad de backend | SQL de HANA | La misma IR compila a SQL u OData ([P-002](P-002-backend-odata.md)) |

## Consideraciones

- La especificación MCP `2026-07-28` **depreca sampling**; la integración debe ser directa con el proveedor de LLM, no a través del cliente.
- Las herramientas `hana_context` y `hana_query` del MVP se mantienen para usuarios técnicos; `hana_ask` se agrega como una opción adicional.
- Librerías candidatas: `@sap-ai-sdk/orchestration` (salida estructurada, enmascaramiento de datos, filtrado de contenido).

## Criterios de aceptación

- [ ] Precisión ≥ la del MVP en el conjunto de evaluación del dominio piloto.
- [ ] Tokens en el asistente del usuario reducidos ≥ 50 % frente al MVP en el mismo conjunto de preguntas.
- [ ] Pruebas que demuestran que el compilador no puede emitir sentencias distintas de `SELECT`.
- [ ] Ninguna fila de datos llega al LLM del servidor (verificado con pruebas y revisión).
