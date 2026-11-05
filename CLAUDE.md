# CLAUDE.md

**STRAHANA**: servidor MCP desplegado en SAP BTP (Cloud Foundry) que detecta en un catálogo YAML las tablas y los campos relevantes para la pregunta del usuario, para que el **LLM del usuario** escriba el SQL; luego STRAHANA lo valida y lo ejecuta en **solo lectura**, sin exponer credenciales y con el mínimo consumo de tokens. **Piloto: SAP HANA Cloud propio** (contenedores HDI de proyectos CAP).

**Fuente de verdad del MVP:** [`docs/00-pov.md`](docs/00-pov.md). **Funcionalidades futuras:** [`docs/proposals/`](docs/proposals/README.md). Leer el POV antes de implementar. Si el código y el POV no coinciden, preguntar; no divergir en silencio.

## Estado y veredicto

- **Veredicto del MVP: VIABLE — GO.** Licenciamiento resuelto (HANA Cloud propio), hosting en BTP y autenticación interina por API key definidos.
- **Fase 0:** el spike del parser SQL está hecho y aprobado (`spikes/`). Siguen pendientes, y son externos al código: usuario `STRAHANA_RO` con un `.hdbrole` de solo `SELECT`, conexiones permitidas desde BTP en HANA Cloud y cliente MCP aprobado con soporte de encabezados personalizados.
- **Fase 1 (plataforma): implementada.** `platform/` (errores, logger, HMAC, configuración, autenticación por API key, servidor MCP stdio + HTTP), `hana/access` (autorización por entorno), catálogo de herramientas con `hana_context` y `hana_query` como marcadores (`NOT_IMPLEMENTED`), `docs/tools.md`, `mta.yaml` y README.
- **Fase 2 (catálogo + `hana_context`): implementada.** `hana/catalog` (modelo, esquema zod + JSON Schema, cargador YAML, índice MiniSearch, contexto compacto, `context_id` firmado), guardas y rate limit en `hana/access`, `hana_context` operativo con auditoría; recall 96 % en 30 preguntas sintéticas y contexto ≤ 800 tokens verificados en CI. `hana_query` sigue como marcador.
- **Fase 3 (consulta): implementada en código; validación contra una base real pendiente.** `hana/query` (validador de SQL por subconjunto con falla cerrada, paginación `LIMIT`/`OFFSET` del servidor, formato TSV con tope de bytes, caso de uso `runQuery`, ejecutor `@sap/hana-client` detrás del puerto `SqlExecutor`) y `hana_query` operativo con auditoría (sin SQL ni valores). Se probó con un ejecutor en memoria; la prueba de integración contra HANA Cloud con `STRAHANA_RO` (incluida la escritura que debe fallar) es opt-in (`STRAHANA_IT=1`) y sigue sin ejecutarse.
- **Siguiente:** Fase 0 externa (usuario `STRAHANA_RO`, `SET TRANSACTION READ ONLY` verificado, conectividad desde BTP) y luego Fase 4 (piloto).

## Flujo (no cambiar sin actualizar el POV)

```plain
hana_context(question) ─► 1 auth (API key) ─► 2 guardas ─► 3 detección de tablas y campos en el YAML + context_id firmado
LLM del usuario       ─► 4 escribe el SELECT con ese contexto
hana_query(sql, context_id) ─► 1 auth ─► 2 guardas ─► 5 validación ─► 6 ejecución ─► 7 TSV compacto
```

- **No hay LLM en el servidor.** No agregar SDKs de IA ni llamadas a modelos ([P-001](docs/proposals/P-001-llm-intermedio-servidor.md)).
- Solo dos herramientas MCP: `hana_context` y `hana_query`. **Ninguna otra** sin aprobación explícita.

## Alcance

Solo lo que describe el POV. Todo lo que está en `docs/proposals/` está **fuera de alcance**; en particular, **S/4HANA** (mandante, Cloud Connector, vistas CDS: [P-016](docs/proposals/P-016-soporte-s4hana.md)) e **IAS** (solo diseño conceptual en POV §9.3; implementación en [P-017](docs/proposals/P-017-autenticacion-ias.md)). No implementarlo ni dejar estructura preparada "para después", salvo el puerto `TokenVerifier`. Si una tarea lo requiere, detenerse y preguntar.

## Stack

- Node.js ≥ 22, TypeScript estricto, ESM (`"type": "module"`, NodeNext), **pnpm**, compilado con `tsc`.
- `@modelcontextprotocol/sdk` (stdio + Streamable HTTP) · `express` 5
- `@sap/xsenv` (`VCAP_SERVICES` / `default-env.json`) · `@sap/hana-client`
- `node-sql-parser` (gramática PostgreSQL sobre un subconjunto) · `minisearch` · `fastest-levenshtein`
- `zod` 4 · `yaml` · `node:crypto` (API keys, HMAC)
- `node:test` · `eslint` + `typescript-eslint` · `prettier`

No agregar dependencias fuera de esta lista sin consultar primero. `@sap/xssec` entra recién con [P-017](docs/proposals/P-017-autenticacion-ias.md).

## Comandos

```bash
pnpm build                                   # tsc → dist/
pnpm test                                    # compila y ejecuta node --test (unitarias, presupuestos de tokens)
pnpm lint                                    # eslint + prettier --check
pnpm docs:tools                              # genera docs/tools.md desde el catálogo de herramientas
pnpm apikey:new -- --user <id> --groups <g>  # emite una API key (se muestra una sola vez)
pnpm start                                   # servidor HTTP (PORT, 8080 por defecto)
pnpm start:stdio                             # servidor local por stdio (rechaza entornos productivos)
mbt build && cf deploy mta_archives/<archivo>.mtar
```

## Arquitectura: screaming + hexagonal por bounded context

```plain
src/
├── platform/        # mcp (createMcpServer + transportes), auth (TokenVerifier + ApiKeyVerifier), config, errors, logging, security (HMAC)
└── hana/
    ├── access/      # Principal, quién usa qué entorno; guardas de entrada; rate limit
    ├── catalog/     # modelo del catálogo, detección de tablas y campos, contexto y su firma
    ├── query/       # política de SQL, validación, ejecución, formato TSV, paginación
    └── mcp/         # adaptadores de entrada: hana_context, hana_query
```

Cada bounded context tiene `domain/` (puro, sin I/O), `application/` (casos de uso que dependen de puertos) e `infrastructure/` (adaptadores).

- Dependencias: `domain` ← `application` ← `infrastructure` / `mcp`. Nunca al revés.
- Un contexto no importa el `domain/` de otro; usa los tipos públicos de su `application/`.
- `platform/` no conoce HANA: está pensada para compartirse con `ssff-mcp` ([P-015](docs/proposals/P-015-unificacion-ssff-mcp.md)).
- Todo verificador de autenticación produce `Principal { userId, groups[] }`; la autorización cruza `groups` con `environments.*.groups`.

## Reglas no negociables

### Implementación

- No realizar commits automáticamente, los commits deben ser lanzados manualmente por el ser humano.

### Solo lectura

- La garantía final es el usuario **`STRAHANA_RO`** con un `.hdbrole` de solo `SELECT` sobre los objetos del catálogo. **Nunca** usar el usuario de runtime del contenedor HDI (tiene permisos de escritura).
- Todo SQL pasa por el validador antes de ejecutarse. **Falla cerrada:** lo que no se parsea o no se reconoce, se rechaza.
- Solo el subconjunto de POV §6.2: un único `SELECT`; sin `*`, `LIMIT`/`TOP`/`OFFSET`, CTE, `UNION`, funciones de ventana, comentarios, schemas explícitos ni objetos `SYS`. Se admite un único `;` final (se quita antes de validar); cualquier otro `;` se rechaza.
- Se ejecuta **el texto original validado** más `LIMIT`/`OFFSET` generados por el servidor. Nunca SQL regenerado desde el AST.
- Cada tabla del SQL debe estar en el `context_id`; cada campo, en el catálogo.
- `context_id` firmado con HMAC usando la clave configurada (nunca aleatoria por proceso), ligado a usuario, entorno, versión del catálogo y expiración.

### Autenticación del piloto

- `/mcp` exige `Authorization: Bearer <api-key>` (o `X-API-Key`) en **cada** llamada. Nunca exponer `/mcp` sin autenticación.
- Solo se almacena el **hash SHA-256** de cada key, en `strahana-secrets`; comparación con `timingSafeEqual`.
- Una key por usuario; la key en claro solo la muestra `apikey:new`, una única vez.
- El modo stdio (local) no autentica, usa el `default-env.json` del desarrollador y **rechaza entornos `productive: true`**.

### Credenciales y datos

- Las credenciales y los hashes solo existen en `VCAP_SERVICES` / `default-env.json` y en memoria. **Nunca** en logs, errores, respuestas, fixtures ni archivos versionados. `default-env.json` siempre en `.gitignore`.
- Solo los secretos van en `default-env.json`; la configuración no secreta va en `strahana.config.json`.
- **Nunca** registrar valores de filas. La auditoría guarda usuario, entorno, hash del SQL, filas, duración, resultado y bytes devueltos.
- Fixtures y catálogos de prueba **sintéticos**.

### Tokens

- Descripciones de herramientas de una línea, en inglés; orden determinista; dos definiciones ≤ 300 tokens.
- Contexto: top-k ≤ 5 tablas, ≤ 12 campos por tabla, formato compacto de POV §4.2; los sinónimos nunca van en la respuesta.
- Resultados en TSV; sin conteo total, sin `structuredContent` ni `outputSchema`; `notes:` solo si el servidor aplicó o advierte algo (incluido el aviso de paginar sin `ORDER BY`); respetar `maxResponseBytes`.
- Errores en una línea, con la causa y la corrección (y una sugerencia de campo cuando aplica).
- Todo cambio en descripciones, formato del contexto o de los resultados debe mantener verdes las **pruebas de presupuesto de tokens**.

### Alineación con `ssff-mcp`

- Errores con la forma `SanitizedError { code, message }`; logger JSON a stderr con lista blanca de campos (nunca `console.log`).
- `environment` explícito, sin entorno por defecto implícito (salvo un único entorno permitido).
- Herramientas con prefijo `hana_`; un catálogo único de herramientas y `docs/tools.md` generado con prueba de deriva.

## Pruebas

- Test-first para comportamiento: prueba que falla, implementación, refactor.
- `query/domain` (validador): casos positivos y **negativos** exhaustivos: DML/DDL, múltiples sentencias, comentarios, `SELECT *`, tablas fuera del contexto, campos inexistentes, schemas explícitos, funciones no permitidas, límites.
- `platform/auth`: key válida, inválida, ausente y revocada; grupo sin acceso al entorno.
- `catalog`: recall del contexto con preguntas de referencia sintéticas.
- Los casos de uso se prueban con implementaciones en memoria de los puertos.
- Pruebas de presupuesto de tokens para `tools/list`, contextos y respuestas.
- Integración contra HANA Cloud solo con `STRAHANA_RO` y datos sintéticos, incluida una prueba de escritura **que debe fallar**.

## Convenciones

- **Documentación** (`docs/`, este archivo, README, catálogos) en **español latino neutro**.
- **Código, identificadores, comentarios, descripciones de herramientas MCP, mensajes de error y logs** en **inglés**.
- Sigue las **Reglas no negociables**. Conventional Commits. Sin atribución de IA en los commits.
- Nuevas funcionalidades fuera del MVP: crear o actualizar una propuesta en `docs/proposals/` con su plantilla, no código.
