# Herramientas MCP

> Archivo generado con `pnpm docs:tools` a partir del catálogo de herramientas
> (`src/hana/mcp/tool-catalog.ts`). No editar a mano: una prueba de deriva falla si no coincide.

Todas las herramientas son de solo lectura (`readOnlyHint: true`). Las descripciones están en
inglés a propósito: son el texto que recibe el LLM en cada turno.

## `hana_context`

**Descripción:** Get the SAP HANA tables/views and columns relevant to a business question. Call before hana_query.

| Parámetro | Tipo | Obligatorio | Restricciones |
|-----------|------|-------------|---------------|
| `question` | string | sí | min length 3, max length 300 |
| `environment` | string | no | - |
| `entities` | string[] | no | max items 5 |

## `hana_query`

**Descripción:** Run a read-only SELECT using only objects from a hana_context result. Returns TSV.

| Parámetro | Tipo | Obligatorio | Restricciones |
|-----------|------|-------------|---------------|
| `sql` | string | sí | max length 4000 |
| `context_id` | string | sí | - |
| `limit` | integer | no | min 1 |
| `offset` | integer | no | min 0 |
