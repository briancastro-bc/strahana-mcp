# P-012 — Exportación de resultados grandes

> **Estado:** Propuesta · **Prioridad:** Baja · **Depende de:** MVP

Entregar resultados grandes como archivo descargable sin pasar todas las filas por el contexto del LLM.

## Problema

El MVP devuelve como máximo `pageSize` filas por llamada, en TSV. Para analizar miles de filas, paginar dentro del contexto del LLM es costoso en tokens y poco práctico.

## Propuesta

- Parámetro `export: true` en `hana_query`: el servidor ejecuta la consulta completa (con un límite alto acordado), genera un CSV y devuelve un **enlace firmado de descarga** con expiración (`resource_link` de MCP), más un resumen de 2–3 líneas.
- El archivo se almacena temporalmente (Object Store de BTP) y se elimina al expirar.

## Consideraciones

- Es una salida de datos masiva: requiere [P-006](P-006-politicas-filas-enmascaramiento.md), auditoría reforzada y aprobación del responsable de datos.

## Criterios de aceptación

- [ ] Exportar 100 000 filas consume menos de 200 tokens en el contexto del LLM.
- [ ] El enlace expira y solo lo puede usar el usuario que lo generó.
