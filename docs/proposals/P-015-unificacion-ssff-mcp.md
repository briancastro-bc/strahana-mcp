# P-015 — Unificación con SSFF MCP

> **Estado:** Propuesta · **Prioridad:** Media · **Depende de:** MVP de STRAHANA estable; transporte HTTP en `ssff-mcp`

Unir STRAHANA y [`ssff-mcp`](https://github.com/chiptime/ssff-mcp) (MCP de SAP SuccessFactors) en **un solo servidor MCP**, con módulos por producto y una plataforma compartida.

## Situación actual de `ssff-mcp` (análisis del commit `1e6382c`)

| Aspecto | `ssff-mcp` | STRAHANA (MVP) | Fricción |
|---------|------------|----------------|----------|
| Lenguaje / módulos | TypeScript estricto, ESM, NodeNext | Igual | — |
| Runtime | Node ≥ 20 | Node ≥ 22 | Baja: subir `ssff-mcp` a 22 (Node 20 está fuera de soporte). |
| Gestor de paquetes | **pnpm** | **npm** | Media: elegir uno al unificar. |
| SDK MCP | `@modelcontextprotocol/sdk` 1.x (`registerTool`) | Igual | — |
| Validación | `zod` 3.25 | `zod` 4 | Baja: el SDK acepta ambas; migrar `ssff-mcp` a zod 4. |
| Pruebas | `node:test` | `node:test` (alineado a propósito) | — |
| Arquitectura | Módulos planos; `tools.ts` de ~1 500 líneas | Screaming + hexagonal por bounded context | **Alta**: envolver `ssff-mcp` como bounded context. |
| Transporte | stdio (HTTP propuesto en su PRD de hosting) | stdio + Streamable HTTP | Media |
| Autenticación de clientes MCP | Ninguna (API key planificada; IAS en su roadmap) | API key hasheada en el piloto; IAS en [P-017](P-017-autenticacion-ias.md) | Baja: el mismo plan en ambos. |
| Configuración | `~/.config/ssff-mcp/config.json`, `environments` / `tenants`, secretos `fromEnv` / `fromCommand` | `strahana.config.json` (`environments`) + `VCAP_SERVICES` / `default-env.json` | Media: unificar el esquema con un discriminador por producto. |
| Herramientas | `list_environments`, `inspect_entity`, `query_entity`, `batch_get` (sin prefijo) | `hana_context`, `hana_query` (con prefijo) | Baja: prefijar las de SSFF (`sf_*`). |
| Errores | `SanitizedError { code, message, httpStatus? }` | Mismo formato (alineado) | — |
| Logger | JSON a stderr con lista blanca de campos | Mismo patrón (alineado) | — |
| Cursores | HMAC con secreto aleatorio por proceso | `context_id` HMAC con clave configurada; paginación por `offset` | Media: el secreto por proceso no sirve con varias réplicas. |
| Límite de respuesta | 256 KiB y 1 000 registros | `pageSize` + `maxResponseBytes` | — |
| Despliegue | npm/npx; Docker planificado | MTA en Cloud Foundry | Media |

## Propuesta: estructura del servidor unificado

```
src/
├── platform/                 # compartido por todos los productos
│   ├── mcp/                  # createMcpServer(deps), registro de herramientas, transportes stdio/HTTP
│   ├── auth/                 # IAS (OAuth resource server), grupos → entornos
│   ├── config/               # carga y validación; secretos (VCAP, fromEnv, fromCommand)
│   ├── errors/               # SanitizedError + códigos por producto
│   ├── logging/              # logger JSON a stderr con lista blanca de campos
│   └── guards/               # rate limit, límites de tamaño, firma de handles
├── hana/                     # STRAHANA: bounded contexts access, catalog, query
└── successfactors/           # ssff-mcp envuelto como bounded context
```

### Decisiones de unificación

1. **Prefijo por producto** en herramientas (`hana_*`, `sf_*`) y en recursos (`hana://`, `sf://`).
2. **Configuración única** con un mapa `environments` y un discriminador `kind: hana | successfactors`.
3. **Grupos de IAS → entornos** como modelo de autorización común.
4. **Clave de firma configurada** (no aleatoria por proceso) para todos los handles y cursores.
5. **Un catálogo de herramientas generado** (`docs/tools.md`) con prueba de deriva, como hace `ssff-mcp` hoy.
6. **Presupuesto de tokens global**: con más productos aumenta el costo fijo de `tools/list`. Evaluar exponer las herramientas por producto según los grupos del usuario o con carga diferida.

## Lo que STRAHANA ya alinea desde el MVP

- Formato de errores `SanitizedError`, logger JSON a stderr con lista blanca de campos y `node:test`.
- Concepto de **entorno** (`environment`) explícito en cada llamada, que falla de forma cerrada cuando falta o no está permitido.
- Motor `createMcpServer(deps)` independiente del transporte.
- Prefijo `hana_` en todas las herramientas.

## Criterios de aceptación

- [ ] Un solo despliegue expone las herramientas `hana_*` y `sf_*` según los grupos del usuario.
- [ ] Las pruebas de ambos productos pasan sin cambios funcionales.
- [ ] El costo de `tools/list` para un usuario con un solo producto no aumenta.

## Preguntas abiertas

- ¿Qué gestor de paquetes se adopta (npm o pnpm)?
- ¿Qué nombre tendrá el producto unificado?
- ¿El hosting definitivo será BTP Cloud Foundry para ambos? `ssff-mcp` identifica un riesgo con la lista blanca de IPs de SuccessFactors al salir desde IPs compartidas de Cloud Foundry.
