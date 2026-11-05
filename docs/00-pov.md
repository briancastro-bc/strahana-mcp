# 00 — Point of View: STRAHANA (MVP)

> **Estado:** MVP aprobado · Fases 0 (spike del parser), 1, 2 y 3 implementadas en código; **validación contra una base HANA real pendiente** (Fase 0 externa y prueba de integración con `STRAHANA_RO`) · **Alcance:** MVP · **Tipo de activo:** Servidor MCP desplegado en SAP BTP · **Funcionalidades futuras:** [`proposals/`](proposals/README.md)

**STRAHANA** es un servidor MCP (Model Context Protocol) que permite a perfiles funcionales y técnicos consultar en **solo lectura** bases SAP HANA desde su propio asistente de IA, **sin conocer las credenciales de conexión** y con el **menor consumo de tokens** posible.

En el MVP, STRAHANA detecta en el catálogo YAML las tablas y los campos relevantes para la pregunta del usuario; con ese contexto, el **LLM del usuario** escribe el SQL, y STRAHANA lo valida y lo ejecuta de forma segura.

**Piloto:** SAP HANA Cloud propio (contenedores HDI de proyectos CAP). El soporte de S/4HANA queda en [P-016](proposals/P-016-soporte-s4hana.md).

---

## Resumen ejecutivo

| Pregunta | Respuesta |
|----------|-----------|
| ¿Qué resuelve? | Consultar datos de HANA sin credenciales, sin conocer el modelo físico y sin acceso de escritura. |
| ¿Quién genera el SQL? | El LLM del asistente del usuario, a partir de las tablas y los campos que STRAHANA detecta en el catálogo. |
| ¿Qué garantiza STRAHANA? | Autenticación de cada llamada, contexto mínimo, validación estricta del SQL (solo `SELECT` sobre objetos permitidos), ejecución con un usuario de solo lectura y respuestas compactas. |
| ¿Cuál es el riesgo técnico principal? | Validar SQL de HANA escrito por un LLM: no existe un parser oficial del dialecto HANA en Node. Se mitiga con un **subconjunto de SQL restringido** que falla de forma cerrada y con los permisos de la base de datos como garantía final. |
| ¿Hay riesgo de licenciamiento? | **No en el piloto.** SAP HANA Cloud propio permite el acceso SQL directo. El riesgo reaparece con S/4HANA ([P-016](proposals/P-016-soporte-s4hana.md)). |

### Veredicto del MVP: **VIABLE — GO**

| Dimensión | Evaluación | Fundamento |
|-----------|------------|------------|
| Licenciamiento | **Resuelto** | Piloto sobre SAP HANA Cloud propio. |
| Técnica | **Alta** | MCP, Cloud Foundry, `@sap/hana-client` y HANA Cloud son piezas maduras. Sin LLM en el servidor ni Cloud Connector, la arquitectura es simple: una aplicación Node.js y una base accesible por TLS. |
| Seguridad | **Alta, con controles obligatorios** | Solo lectura garantizada por la base de datos (usuario dedicado de solo `SELECT`), catálogo como lista blanca, contexto firmado y autenticación por API key en el piloto. |
| Precisión | **Media-alta** | Depende del LLM del usuario y de la calidad del catálogo. Con tablas y campos detectados y joins explícitos, los LLM actuales escriben SQL de lectura correcto en la gran mayoría de los casos. |
| Tokens | **Alta** | Dos herramientas, contexto top-k compacto y resultados TSV paginados ([§10](#10-estrategia-de-tokens-para-el-llm-del-usuario)). |
| Costo | **Bajo** | Sin consumo de LLM en el servidor: solo el runtime de Cloud Foundry y HANA Cloud. |

**Tareas de la Fase 0 (técnicas, no bloquean la decisión):**

- [x] Spike del parser (hecho y aprobado): el subconjunto de SQL de [§6](#6-validación-del-sql-paso-5) se parsea de forma confiable.
- [ ] Usuario técnico de solo `SELECT` creado en HANA Cloud (rol `.hdbrole` del contenedor HDI piloto).
- [ ] Instancia de HANA Cloud configurada para aceptar conexiones desde las IP de SAP BTP.
- [ ] El cliente MCP aprobado admite encabezados HTTP personalizados (para la API key).

---

## 1. Decisiones del MVP

| Tema | Decisión |
|------|----------|
| Base de datos del piloto | **SAP HANA Cloud propio**, contenedores HDI de proyectos CAP. |
| Protocolo | MCP, Streamable HTTP (BTP) + stdio (desarrollo local). Servidor **sin estado**. |
| Hosting | SAP BTP, **Cloud Foundry**, empaquetado como MTA. |
| Runtime | Node.js ≥ 22 (LTS), TypeScript estricto, ESM, **pnpm**. |
| Arquitectura | Screaming + hexagonal **por bounded context**: `access`, `catalog`, `query`, sobre una `platform` compartida. |
| Autenticación del piloto | **API key por usuario** (hash en un servicio *user-provided*) detrás del puerto `TokenVerifier`. |
| Autenticación objetivo | **IAS**, diseñada a nivel conceptual en [§9.3](#93-diseño-conceptual-con-ias); se implementa en [P-017](proposals/P-017-autenticacion-ias.md) reemplazando solo el adaptador. |
| Autorización | Grupos del usuario → entornos permitidos (mismo modelo con API key y con IAS). |
| Detección de tablas y campos | STRAHANA, por búsqueda en el catálogo YAML (`<dominio>.catalog.yaml`). |
| Generación del SQL | **LLM del usuario.** El servidor no usa LLM ([P-001](proposals/P-001-llm-intermedio-servidor.md)). |
| Validación | Subconjunto de SQL restringido, parseado a AST y validado contra el contexto. Falla de forma cerrada. |
| Ejecución | Pool por entorno, usuario técnico **solo `SELECT`**, timeout, límite de filas. |
| Credenciales | Formato **`VCAP_SERVICES`**: servicios *user-provided* en BTP y `default-env.json` en local (convención de CAP). |
| Respuesta | TSV + conteo de filas + notas + cursor de paginación (`next_offset`). |
| Herramientas MCP | `hana_context` y `hana_query`. |

---

## 2. Alcance del MVP

### Incluido

- Las 7 etapas del flujo de consulta ([§3](#3-flujo-de-una-consulta)).
- SAP HANA Cloud propio, un dominio funcional curado (15–30 tablas o vistas), uno o más entornos no productivos.
- Despliegue en SAP BTP Cloud Foundry con autenticación por API key.
- Modo local por stdio para desarrollo.

### Fuera del MVP

| Tema | Propuesta |
|------|-----------|
| LLM intermedio en el servidor | [P-001](proposals/P-001-llm-intermedio-servidor.md) |
| Backend OData | [P-002](proposals/P-002-backend-odata.md) |
| Propagación de identidad | [P-003](proposals/P-003-propagacion-identidad.md) |
| Destination service / Credential Store | [P-004](proposals/P-004-credenciales-servicios-btp.md) |
| Búsqueda con embeddings | [P-005](proposals/P-005-busqueda-semantica-embeddings.md) |
| Políticas de filas y enmascaramiento | [P-006](proposals/P-006-politicas-filas-enmascaramiento.md) |
| Varias instancias / estado compartido | [P-007](proposals/P-007-escalamiento-horizontal.md) |
| Observabilidad y auditoría avanzada | [P-008](proposals/P-008-observabilidad-auditoria-avanzada.md) |
| Evaluación continua | [P-009](proposals/P-009-evaluacion-continua.md) |
| Entornos productivos (workload class, `EXPLAIN PLAN`) | [P-010](proposals/P-010-proteccion-carga-productivo.md) |
| Generación y verificación asistida del catálogo | [P-011](proposals/P-011-catalogo-asistido.md) |
| Exportación de resultados grandes | [P-012](proposals/P-012-exportacion-resultados.md) |
| SaaS multi-tenant | [P-013](proposals/P-013-saas-multitenant.md) |
| Escritura (INSERT / UPDATE) | [P-014](proposals/P-014-escritura-controlada.md) |
| Unificación con SSFF MCP | [P-015](proposals/P-015-unificacion-ssff-mcp.md) |
| **Soporte S/4HANA** (mandante, Cloud Connector, licencias, vistas CDS) | [P-016](proposals/P-016-soporte-s4hana.md) |
| **Autenticación con IAS** (implementación) | [P-017](proposals/P-017-autenticacion-ias.md) |

---

## 3. Flujo de una consulta

### 3.1 Vista general

```
Usuario ──pregunta──► LLM del usuario (cliente MCP)
                         │
                         │ API key en cada llamada (Authorization: Bearer …)
                         ▼
          ┌────────────── STRAHANA (BTP · Cloud Foundry) ──────────────┐
          │  hana_context(question)                                    │
          │   1. Autenticación                                         │
          │   2. Guardas de entrada                                    │
          │   3. Detección de tablas y campos en el catálogo YAML ──►  │
          │      contexto compacto + context_id                        │
          └────────────────────────────────────────────────────────────┘
                         │
                         ▼
               4. El LLM del usuario escribe el SQL con ese contexto
                         │
          ┌──────────────▼─────────────────────────────────────────────┐
          │  hana_query(sql, context_id)                               │
          │   1. Autenticación   2. Guardas                            │
          │   5. Validación ──✗──► error accionable (el LLM reintenta) │
          │   6. Ejecución (pool, usuario solo SELECT, timeout) ──► SAP HANA Cloud
          │   7. Respuesta compacta (TSV, conteos, notas, cursor)      │
          └────────────────────────────────────────────────────────────┘
```

### 3.2 Paso a paso

| # | Etapa | Dónde | Qué ocurre |
|---|-------|-------|------------|
| 1 | **Autenticación** | Ambas herramientas | En el piloto se valida la **API key** del usuario y se obtiene su identidad y sus grupos. Con IAS ([P-017](proposals/P-017-autenticacion-ias.md)) se validará el JWT y se obtendrá la misma información. |
| 2 | **Guardas de entrada** | Ambas herramientas | Longitud máxima (`question` ≤ 300 caracteres, `sql` ≤ 4 000), **rate limit** por usuario y, en `hana_context`, **rechazo de SQL crudo** en la pregunta. |
| 3 | **Detección de tablas y campos** | `hana_context` | A partir de la entrada del usuario se busca en el catálogo YAML del entorno (nombres, etiquetas y sinónimos) y se seleccionan **las tablas o vistas y los campos** relevantes. Devuelve un contexto compacto y un `context_id` firmado. |
| 4 | **Generación del SQL** | LLM del usuario | El asistente combina la pregunta del usuario con el contexto recibido y escribe un `SELECT` que respeta las reglas incluidas en el contexto. |
| 5 | **Validación** | `hana_query` | Esquema de la llamada, parseo del SQL, solo `SELECT`, tablas y campos existentes en el contexto, inferencia de alias y columnas sin calificar, funciones y operadores permitidos, y límites. Si falla, devuelve un error accionable que indica qué no existe o no está disponible y cómo corregirlo, para que el LLM vuelva a consultar. |
| 6 | **Ejecución** | `hana_query` (invocada por el LLM del usuario) | Conexión desde el pool del entorno, usuario técnico de solo lectura, schema por defecto del entorno, `LIMIT`/`OFFSET` controlados por el servidor y timeout. |
| 7 | **Respuesta compacta** | `hana_query` | TSV con encabezado de una línea: filas devueltas, si hay más, notas (límites aplicados, truncados) y `next_offset` como cursor de paginación. |

### 3.3 Precisiones sobre el flujo

- **Rechazo de SQL crudo (paso 2).** Aplica a la pregunta de `hana_context`. `hana_query` recibe SQL por diseño, así que STRAHANA **no puede distinguir** si lo escribió el LLM o lo dictó el usuario. Por eso `hana_query` exige un `context_id` emitido por `hana_context`: el SQL solo puede usar las tablas y los campos detectados a partir de una pregunta. La protección real es la validación (paso 5) y los permisos de la base de datos (paso 6).
- **"Inferencia" en la validación (paso 5).** Resolver alias y columnas sin calificar contra las tablas del contexto, y rechazar las ambigüedades.
- **Ejecución (paso 6).** El LLM del usuario **decide e invoca** la ejecución mediante `hana_query`; la ejecución ocurre en STRAHANA, nunca en el cliente.

### 3.4 Recomendaciones estrictamente necesarias (incorporadas al MVP)

| # | Recomendación | Por qué es necesaria |
|---|---------------|----------------------|
| R1 | **Autenticación interina por API key** por usuario, guardada como hash. | Un endpoint MCP público en BTP, sin autenticación y conectado a una base de datos, no se puede desplegar. IAS se diseñó conceptualmente pero todavía no está configurado. |
| R2 | **Autorización por entorno**: grupos del usuario → entornos permitidos. | Sin esto, cualquier usuario con una key podría consultar cualquier entorno. |
| R3 | **`context_id` firmado** que vincula `hana_query` con un `hana_context` previo (entorno, tablas, usuario, expiración). | Hace cumplible el "solo lenguaje natural" del paso 2 y el rechazo de tablas no disponibles del paso 5. |
| R4 | **Usuario técnico dedicado de solo `SELECT`**, con un rol `.hdbrole` del contenedor HDI. **Nunca** el usuario de runtime del HDI, que tiene permisos de escritura. | Es la única garantía de solo lectura que no depende del código. |
| R5 | **Conexiones permitidas en HANA Cloud** restringidas a las IP de SAP BTP. | Sin esto, Cloud Foundry no puede conectarse, o la instancia queda abierta a cualquier IP. |
| R6 | **Log de auditoría mínimo** por consulta: usuario, entorno, hash del SQL, filas, duración, resultado. **Sin valores.** | Hay que poder rastrear quién consultó qué. |
| R7 | **Clave de firma configurada** (no aleatoria por proceso). | Los `context_id` deben sobrevivir a los reinicios. |

---

## 4. Interfaz MCP

### 4.1 Herramientas

Solo dos herramientas, ambas con `readOnlyHint: true`, descripciones de una línea en inglés y orden determinista en `tools/list`.

| Herramienta | Entrada | Salida |
|-------------|---------|--------|
| `hana_context` | `question` (string, 3–300), `environment?` (string), `entities?` (string[], máximo 5) | Contexto compacto + `context_id` |
| `hana_query` | `sql` (string, ≤ 4 000), `context_id` (string), `limit?` (entero), `offset?` (entero) | TSV + conteos + notas + `next_offset` |

```json
[
  {
    "name": "hana_context",
    "description": "Get the SAP HANA tables/views and columns relevant to a business question. Call before hana_query.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "question": { "type": "string", "minLength": 3, "maxLength": 300 },
        "environment": { "type": "string" },
        "entities": { "type": "array", "items": { "type": "string" }, "maxItems": 5 }
      },
      "required": ["question"]
    },
    "annotations": { "readOnlyHint": true }
  },
  {
    "name": "hana_query",
    "description": "Run a read-only SELECT using only objects from a hana_context result. Returns TSV.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sql": { "type": "string", "maxLength": 4000 },
        "context_id": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1 },
        "offset": { "type": "integer", "minimum": 0 }
      },
      "required": ["sql", "context_id"]
    },
    "annotations": { "readOnlyHint": true }
  }
]
```

| Detalle | Comportamiento |
|---------|----------------|
| `environment` omitido | Si el usuario tiene un solo entorno, se usa ese. Si tiene varios, el error lista los disponibles en una línea. No hay entorno por defecto implícito (igual que `ssff-mcp`). |
| `entities` | Revelación progresiva: devuelve **todos** los campos de esas tablas, en lugar de solo los más relevantes. |
| `context_id` | Firmado con HMAC; contiene el entorno, la versión del catálogo, las tablas del contexto, el usuario y la expiración (**TTL fijo de 60 minutos**, no configurable por entorno). `hana_query` lo verifica **antes** de aplicar el rate limit. Se puede reutilizar en preguntas de seguimiento sin volver a llamar a `hana_context`. |
| `limit` | Filas a devolver (por defecto `pageSize`, máximo `maxRows` del entorno). Reemplaza a `LIMIT`/`TOP` en el SQL. Si supera `maxRows`, `SQL_FORBIDDEN`. |
| `offset` | Paginación: el LLM repite la llamada con el mismo `sql` y `context_id`, y el `offset` recibido en `next_offset`. |
| `;` final | Se acepta **un solo** `;` al final del `sql` (seguido, como mucho, de espacios): el servidor lo quita antes de validar y ejecuta el texto sin él, con su `LIMIT`/`OFFSET` ([§6.2](#62-subconjunto-permitido)). |

### 4.2 Respuesta de `hana_context`

Formato compacto, diseñado para gastar pocos tokens (ejemplo con un contenedor HDI de un proyecto CAP):

```
ctx=eyJlIjoiREVWLVNBTEVTIi...k3Jd9a env=DEV-SALES ttl=60m
COM_ACME_SALES_ORDERS "Pedidos de venta"
  ID s36 PK · ORDERNUMBER s10 "Nº pedido" · CREATEDAT ts "Creado" · CUSTOMER_ID s36 "Cliente" · STATUS_CODE s1 "Estado" · TOTALAMOUNT d15.2 "Importe total" · CURRENCY_CODE s3 "Moneda" · +6 cols
  join COM_ACME_SALES_CUSTOMERS ON CUSTOMER_ID=ID
COM_ACME_SALES_CUSTOMERS "Clientes"
  ID s36 PK · NAME s111 "Nombre" · COUNTRY_CODE s3 "País" · +9 cols
rules: SELECT only; list columns (no *); no LIMIT/TOP (use limit); prefer GROUP BY
```

| Código de tipo | Significado |
|----------------|-------------|
| `s36` | String de longitud 36 |
| `d15.2` | Decimal (precisión 15, escala 2) |
| `i` / `bi` | Integer / BigInt |
| `dt` / `ts` | Date / Timestamp |
| `b` | Boolean |
| `PK` | Parte de la clave |

Una tabla puede traer reglas propias del catálogo (campo opcional `rules`, [§5.2](#52-contenido)); se muestran como líneas `  rule: …` bajo la tabla, y solo cuando existen.

### 4.3 Respuesta de `hana_query`

```
rows=10 more=yes next_offset=10
NAME	ORDERS	TOTAL	CURRENCY_CODE
Acme S.A.	42	125000.00	EUR
Iberia Parts	31	98210.50	EUR
...
notes: NAME truncated to 120 chars in 1 row
```

| Regla | Motivo |
|-------|--------|
| TSV; tabuladores y saltos de línea dentro de valores se escapan. | Es el formato tabular más barato en tokens. |
| `NULL` se representa como celda vacía. | Ahorro de tokens. |
| Textos de más de 120 caracteres se truncan con `…`. | Evita que un texto largo consuma la respuesta. |
| Las columnas completamente vacías en la página se omiten y se informan en `notes`. | Ahorro de tokens sin perder información. |
| **Sin conteo total** (`COUNT(*)`): solo `rows` y `more`. | Un conteo total duplica la carga en la base de datos; si hace falta, el LLM escribe un `COUNT`. |
| `notes:` solo cuando el servidor aplicó o advierte algo (columnas omitidas, textos truncados, respuesta recortada por `maxResponseBytes`, o `no ORDER BY, page order is not guaranteed` al paginar una consulta sin `ORDER BY`). | Sin texto de relleno; el LLM sabe que el orden entre páginas no es estable. |
| Tope de bytes por respuesta (`maxResponseBytes`, por defecto 16 KiB). Si una **sola fila** no cabe, se devuelve `SQL_FORBIDDEN` pidiendo seleccionar menos columnas o más cortas. | Techo absoluto de tokens por llamada; nunca una página vacía sin explicación. |
| Sin `structuredContent` ni `outputSchema`. | La especificación pide duplicar el contenido estructurado como texto: se pagaría dos veces. |

### 4.4 Errores

Formato alineado con `ssff-mcp` (`SanitizedError { code, message }`): una línea, con la causa y la corrección.

| Código | Ejemplo de mensaje |
|--------|--------------------|
| `AUTH_REQUIRED` | `Missing or invalid API key.` |
| `ENV_REQUIRED` | `environment required: DEV-SALES, QAS-SALES` |
| `ENV_FORBIDDEN` | `No access to environment QAS-SALES.` |
| `RATE_LIMITED` | `Too many requests. Retry in 20s.` |
| `QUESTION_IS_SQL` | `hana_context expects a natural-language question, not SQL.` |
| `CONTEXT_INVALID` | `context_id expired or invalid. Call hana_context again.` |
| `SQL_PARSE` | `Unsupported SQL near "TOP 10". Use the limit parameter.` |
| `SQL_NOT_SELECT` | `Only SELECT statements are allowed.` |
| `SQL_ENTITY_NOT_IN_CONTEXT` | `COM_ACME_SALES_ITEMS is not in this context. Call hana_context with entities:["COM_ACME_SALES_ITEMS"].` |
| `SQL_ENTITY_UNAVAILABLE` | `COM_ACME_HR_SALARIES is not available in the catalog of DEV-SALES.` |
| `SQL_UNKNOWN_COLUMN` | `COM_ACME_SALES_CUSTOMERS.CUSTOMERNAME does not exist. Did you mean NAME?` |
| `SQL_AMBIGUOUS_COLUMN` | `Column ID is ambiguous; qualify it with an alias.` |
| `SQL_FORBIDDEN` | `SELECT * is not allowed; list the columns.` |
| `DB_TIMEOUT` | `Query exceeded 30s. Narrow the filters or aggregate.` |
| `DB_ERROR` | Mensaje de HANA saneado, sin credenciales ni host. |
| `INPUT_INVALID` | Entrada fuera del contrato que el esquema no cubre (pregunta demasiado larga, entidad desconocida en `entities`). |
| `NOT_IMPLEMENTED` | `hana_query is not available yet (planned for phase 3).` Solo si una herramienta se registra sin su manejador; con ambas fases implementadas no ocurre. |
| `CONFIG_INVALID` | `Invalid configuration: …` Error de arranque (no de una llamada): impide iniciar el servidor. |
| `INTERNAL_ERROR` | `Internal error. Retry later or contact an administrator.` Cualquier fallo inesperado, sin detalles. |

Los últimos cuatro son adiciones de la plataforma respecto de `ssff-mcp`. Además, los errores del **transporte HTTP** (antes de llegar a una herramienta) no usan estos códigos de herramienta: `/mcp` responde `401` con `AUTH_REQUIRED`, `405` con `BAD_METHOD` (`Use POST for /mcp.`) y `400`/`413` con `BAD_REQUEST` (`Invalid request body.`), en un cuerpo JSON `{ "error": { "code", "message" } }`.

---

## 5. Catálogo

### 5.1 Nombre y ubicación del archivo

**Decisión:** `catalog/<dominio>.catalog.yaml` (por ejemplo, `catalog/sales.catalog.yaml`).

- Un archivo por dominio: catálogos chicos, con un responsable funcional cada uno, y reutilizables entre entornos.
- El sufijo `.catalog.yaml` permite asociar un **JSON Schema** (generado desde el esquema `zod`) para tener autocompletado y validación en el editor (BAS / VS Code con la extensión de YAML).
- Cada entorno referencia el catálogo que usa ([§8](#8-configuración-y-credenciales)).

### 5.2 Contenido

```yaml
# yaml-language-server: $schema=../schemas/catalog.schema.json
domain: sales
version: 1
label: Ventas
entities:
  - name: COM_ACME_SALES_ORDERS           # nombre físico exacto en HANA
    label: Pedidos de venta
    synonyms: [pedidos, órdenes, ventas]
    columns:
      - { name: ID, type: string, length: 36, key: true, label: ID }
      - { name: ORDERNUMBER, type: string, length: 10, label: Nº pedido, synonyms: [número de pedido] }
      - { name: CREATEDAT, type: timestamp, label: Creado, synonyms: [fecha de creación] }
      - { name: CUSTOMER_ID, type: string, length: 36, label: Cliente }
      - { name: STATUS_CODE, type: string, length: 1, label: Estado }
      - { name: TOTALAMOUNT, type: decimal, precision: 15, scale: 2, label: Importe total }
      - { name: CURRENCY_CODE, type: string, length: 3, label: Moneda }
    joins:
      - { entity: COM_ACME_SALES_CUSTOMERS, on: { CUSTOMER_ID: ID } }
    rules: ["STATUS_CODE: O=open, C=closed"]   # opcional, hasta 3 líneas de 120 caracteres
  - name: COM_ACME_SALES_CUSTOMERS
    label: Clientes
    synonyms: [clientes, compradores]
    columns:
      - { name: ID, type: string, length: 36, key: true, label: ID }
      - { name: NAME, type: string, length: 111, label: Nombre, synonyms: [razón social] }
      - { name: COUNTRY_CODE, type: string, length: 3, label: País }
```

> Los nombres del ejemplo son ilustrativos. En proyectos CAP con `cds.sql.names: plain` (el valor por defecto), una entidad `com.acme.sales.Orders` se despliega como `COM_ACME_SALES_ORDERS`, y una asociación `customer` como la columna `CUSTOMER_ID`. El catálogo puede incluir también las vistas que CAP genera para las proyecciones de los servicios.

### 5.3 Reglas del catálogo

| Regla | Motivo |
|-------|--------|
| **El catálogo es una lista blanca**: lo que no está, no se puede consultar. | Es el principal control de alcance de datos. |
| Las columnas sensibles (salarios, datos bancarios, datos personales) **no se incluyen**. | El usuario técnico puede leer todo lo que su rol permite; el catálogo acota lo que el LLM ve y usa. |
| `label` breve (≤ 4 palabras); los `synonyms` sirven **solo para la búsqueda** y no se envían al LLM. | Ahorro de tokens. |
| `joins` declarados explícitamente. | El LLM no adivina relaciones y el contexto es más corto. |
| `rules` (opcional, por tabla): hasta 3 líneas de 120 caracteres con convenciones de datos que el LLM no puede deducir (por ejemplo, el significado de un código de estado). Se envían tal cual bajo la tabla. | Evita consultas semánticamente erróneas; es el único texto libre del catálogo que viaja al LLM, así que se mantiene corto y no sensible. |
| `version` se incrementa en cada cambio. | Invalida los `context_id` emitidos con la versión anterior. |
| Se valida contra el esquema al arrancar; un catálogo inválido impide iniciar. | Falla de forma cerrada. |
| El rol `.hdbrole` del usuario técnico otorga `SELECT` **solo** sobre los objetos del catálogo. | Catálogo y permisos de la base de datos coinciden: doble barrera. |

### 5.4 Detección de tablas y campos (paso 3)

- Índice en memoria con **MiniSearch** sobre nombres, etiquetas y sinónimos de tablas y campos.
- Normalización para español: minúsculas, sin tildes y con un stemming liviano de plurales.
- Selección: **top-k tablas (k ≤ 5)** y, por tabla, las **claves** más los campos mejor rankeados (≤ 12), con un indicador `+N cols`.
- Se agregan las tablas destino de `joins` cuando ambas aparecen en el ranking.
- Si la pregunta no coincide con nada: un resumen de una línea por tabla del dominio, para orientar al usuario.

---

## 6. Validación del SQL (paso 5)

### 6.1 Estrategia

No existe un parser del dialecto HANA en Node. La estrategia es:

1. Definir un **subconjunto de SQL de lectura** que STRAHANA acepta.
2. Parsearlo a AST con `node-sql-parser` usando la gramática **PostgreSQL** (identificadores con comillas dobles y `LIMIT`/`OFFSET`, compatibles con HANA).
3. **Fallar de forma cerrada**: todo lo que no se parsea o no se reconoce se rechaza con un error accionable.
4. Ejecutar **el texto original validado** (sin su `;` final, si lo traía, y con `LIMIT`/`OFFSET` agregados por el servidor), nunca un SQL regenerado desde el AST, para evitar diferencias de dialecto.

El spike de la Fase 0 confirma que el subconjunto se parsea de forma confiable. Si no es así, la alternativa es una gramática propia del subconjunto (por ejemplo, con un generador de parsers PEG).

### 6.2 Subconjunto permitido

| Permitido | No permitido |
|-----------|--------------|
| Una sola sentencia `SELECT`, con **un solo `;` final** opcional (seguido, como mucho, de espacios o saltos de línea) | Múltiples sentencias, `;` intermedios, `;;` o cualquier texto después del `;` (incluidos comentarios) |
| Columnas explícitas, alias | `SELECT *` |
| `JOIN` (`INNER`, `LEFT`) hasta 4 tablas base en **toda** la sentencia (subconsultas incluidas) | `CROSS JOIN` sin condición, más de 4 tablas |
| `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY` | `LIMIT`, `OFFSET`, `TOP` (los controla el servidor) |
| Subconsultas en `WHERE` (`IN`, `EXISTS`) y en `FROM`, hasta 2 niveles | `WITH` (CTE), `UNION`, `INTERSECT`, `EXCEPT` |
| Agregaciones: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `COUNT(DISTINCT …)` | Funciones de ventana |
| Funciones de una lista blanca **explícita** (texto, fecha, numéricas, nulos y conversión, incluidas `TO_VARCHAR` y `LOCATE`; ver `ALLOWED_FUNCTIONS` en `src/hana/query/domain/sql-policy.ts`), `CAST` a tipos soportados, `COALESCE`, `CASE` | Procedimientos, funciones de tabla, `CALL` |
| Nombres sin schema (el servidor fija el schema del entorno); identificadores sin comillas (HANA los pliega a mayúsculas) o entre comillas dobles | Nombres calificados con schema, objetos `SYS.*` o `_SYS_*` |
| Literales y operadores estándar | Comentarios (`--`, `/* */`), `INTO`, `FOR UPDATE` |

### 6.3 Reglas de validación

| # | Regla | Error |
|---|-------|-------|
| 1 | El `context_id` es válido, no expiró, pertenece al usuario y coincide con la versión del catálogo. | `CONTEXT_INVALID` |
| 2 | El SQL se parsea con el subconjunto. | `SQL_PARSE` |
| 3 | Todas las sentencias y subconsultas son `SELECT`. | `SQL_NOT_SELECT` |
| 4 | Cada tabla referenciada está en el contexto (si está en el catálogo pero no en el contexto, se indica cómo pedirla). | `SQL_ENTITY_NOT_IN_CONTEXT` / `SQL_ENTITY_UNAVAILABLE` |
| 5 | Cada campo existe en el catálogo de su tabla; los alias y los campos sin calificar se resuelven sin ambigüedad (**inferencia**). | `SQL_UNKNOWN_COLUMN` / `SQL_AMBIGUOUS_COLUMN` |
| 6 | Solo funciones y operadores de la lista blanca. | `SQL_FORBIDDEN` |
| 7 | Límites: `limit ≤ maxRows`, ≤ 4 tablas, ≤ 2 niveles de subconsulta, longitud del SQL. | `SQL_FORBIDDEN` |

**Precisiones del MVP:**

- **`;` final.** El validador (`checkSqlText`) quita un único `;` de nivel superior que solo tenga espacios después, antes de parsear. Un `;` dentro de un literal o de un identificador entre comillas es un carácter normal y nunca se quita. Se ejecuta el texto sin el `;` más ` LIMIT n OFFSET m`. Cualquier otro `;` produce `SQL_FORBIDDEN` (`Only one statement is allowed; ";" is only accepted once, at the very end.`); un `;` solo produce `SQL_PARSE` (SQL vacío).
- **Tablas contadas globalmente.** El límite de 4 tablas cuenta las tablas base de **toda** la sentencia, incluidas las de subconsultas y las repetidas, no por `SELECT`.
- **Mayúsculas y minúsculas.** Los identificadores sin comillas coinciden con el catálogo sin distinguir mayúsculas (se pliegan a mayúsculas, como en HANA); los que van entre comillas dobles deben coincidir exactamente con el nombre del catálogo.
- **Funciones.** La lista blanca es explícita y cerrada (`ALLOWED_FUNCTIONS` y `ALLOWED_AGGREGATES` en `src/hana/query/domain/sql-policy.ts`); agregar una función es una decisión de seguridad. Incluye `TO_VARCHAR` y `LOCATE`, que el spike marcó como brechas de política.
- **Limitaciones conocidas del parser** (no hay dialecto HANA; se rechazan con un mensaje que indica la alternativa): `CAST` a `NVARCHAR`, `SECONDDATE`, `DAYDATE`, `SMALLDECIMAL` y `NCLOB`; `SUBSTRING(x FROM … FOR …)` (usar `SUBSTRING(x, inicio, largo)`); y literales con exponente (`1.5E3`). Se documentan como limitaciones del MVP, no como errores.
- **Orden y control previos.** `hana_query` verifica el `context_id` (regla 1) **antes** de aplicar el rate limit.

Los errores de campo incluyen sugerencias por similitud (`fastest-levenshtein`), para que el LLM corrija en un solo intento sin volver a pedir contexto.

---

## 7. Solo lectura: capas de protección del MVP

| Capa | Control | Qué evita |
|------|---------|-----------|
| 1. Base de datos | Usuario técnico dedicado con un rol `.hdbrole` de **solo `SELECT`** sobre los objetos del catálogo. Sin `EXECUTE`, sin acceso a `SYS`. | Cualquier escritura, aunque fallen todas las demás capas. |
| 2. Validador | Subconjunto de SQL, solo `SELECT`, lista blanca del catálogo, contexto firmado. | Sentencias no deseadas y acceso fuera de alcance. |
| 3. Sesión | Transacción de solo lectura en la conexión (`SET TRANSACTION READ ONLY`; **validar en el spike**) y schema por defecto del entorno. | Escrituras accidentales; referencias a otros schemas. |
| 4. Ejecución | `LIMIT`/`OFFSET` del servidor, timeout de la sentencia, tope de bytes de la respuesta. | Consultas costosas y respuestas gigantes. |
| 5. Entrada | API key, longitudes máximas, rate limit, rechazo de SQL en la pregunta. | Accesos no autorizados, abuso y uso fuera del contrato. |

### 7.1 Usuario técnico en SAP HANA Cloud (contenedor HDI)

1. El proyecto CAP piloto define un rol de solo lectura en su contenedor HDI, por ejemplo `db/src/STRAHANA_READER.hdbrole`, con `SELECT` sobre las tablas y vistas del catálogo.
2. El administrador de la base de datos crea un usuario dedicado (por ejemplo, `STRAHANA_RO`) sin otros privilegios.
3. Se otorga el rol del contenedor a ese usuario con la API del contenedor HDI (`GRANT_CONTAINER_SCHEMA_ROLES`).
4. Las credenciales de `STRAHANA_RO` se cargan en el servicio *user-provided* del entorno ([§8](#8-configuración-y-credenciales)).

> El procedimiento exacto se valida con quien administre la instancia de HANA Cloud durante la Fase 0.

---

## 8. Configuración y credenciales

### 8.1 Decisión: formato `VCAP_SERVICES` (`default-env.json`)

| Opción | Evaluación |
|--------|------------|
| **`default-env.json` / `VCAP_SERVICES`** | **Elegida.** Es el mismo formato que BTP inyecta al hacer el binding de un servicio. El mismo código lee las credenciales en local y en Cloud Foundry. Se lee con `@sap/xsenv`. |
| `.cdsrc-private.json` | Descartada. CAP la usa sobre todo con `cds bind`, que guarda **referencias** a service keys de Cloud Foundry (no credenciales) y requiere la CLI `cf` con sesión iniciada: no sirve para el runtime de un servidor. |

### 8.2 Separación de secretos y configuración

| Archivo | Contenido | ¿Se versiona? |
|---------|-----------|---------------|
| `default-env.json` (local) / `VCAP_SERVICES` (BTP) | **Solo secretos**: credenciales de cada conexión, la clave de firma y los hashes de las API keys. | **Nunca** (`.gitignore`). |
| `strahana.config.json` | Entornos: servicio de credenciales, schema, catálogo, grupos y límites. | Sí |
| `catalog/*.catalog.yaml` | Catálogos por dominio. | Sí |

`default-env.json`, local:

```json
{
  "VCAP_SERVICES": {
    "user-provided": [
      {
        "name": "strahana-dev-sales",
        "tags": ["strahana-hana"],
        "credentials": {
          "host": "<instance-id>.hana.prod-eu10.hanacloud.ondemand.com",
          "port": "443",
          "user": "STRAHANA_RO",
          "password": "********",
          "encrypt": true,
          "sslValidateCertificate": true
        }
      },
      {
        "name": "strahana-secrets",
        "tags": ["strahana-secrets"],
        "credentials": {
          "signingKey": "<32+ bytes aleatorios, base64>",
          "apiKeys": [
            { "user": "jdoe", "keyHash": "sha256:<hash>", "groups": ["STRAHANA_DEV_SALES"] }
          ]
        }
      }
    ]
  }
}
```

`strahana.config.json`, versionado:

```json
{
  "$schema": "./schemas/strahana.config.schema.json",
  "environments": {
    "DEV-SALES": {
      "kind": "hana",
      "label": "HANA Cloud DEV · Ventas",
      "productive": false,
      "service": "strahana-dev-sales",
      "schema": "SALES_HDI_DB_1",
      "catalog": "catalog/sales.catalog.yaml",
      "groups": ["STRAHANA_DEV_SALES"],
      "limits": { "pageSize": 50, "maxRows": 500, "timeoutSeconds": 30, "maxResponseBytes": 16384, "rateLimitPerMinute": 30, "poolSize": 4 }
    }
  }
}
```

- **Límites por entorno** (`limits`): `pageSize`, `maxRows`, `timeoutSeconds`, `maxResponseBytes`, y dos agregados durante la implementación: `rateLimitPerMinute` (llamadas por usuario por minuto, en memoria; 30 por defecto) y `poolSize` (conexiones máximas del pool del entorno, de 1 a 50; 4 por defecto).
- **Multi-schema / multi-entorno:** un entorno por combinación de conexión × schema × catálogo.
- `productive: true` marca entornos productivos: el modo stdio los rechaza y el MVP no los habilita ([P-010](proposals/P-010-proteccion-carga-productivo.md)).
- `kind: "hana"` deja preparado el discriminador para la unificación con `ssff-mcp` ([P-015](proposals/P-015-unificacion-ssff-mcp.md)), cuya configuración también usa un mapa `environments`.
- Ambos archivos se validan con `zod` al arrancar; un error impide iniciar el servidor.
- En BTP, cada conexión y los secretos son servicios *user-provided* (`cf create-user-provided-service strahana-dev-sales -p credentials.json -t strahana-hana`) vinculados a la aplicación.

---

## 9. Autenticación y autorización

### 9.1 Modelo común

Todo adaptador de autenticación produce el mismo `Principal { userId, groups[] }`. La autorización cruza `groups` con `environments.*.groups` de la configuración: sin grupo, sin acceso. Cambiar de API key a IAS **no** cambia la autorización ni el resto del código.

### 9.2 Piloto: API key por usuario

| Aspecto | Decisión |
|---------|----------|
| Transporte | Encabezado `Authorization: Bearer <api-key>` (alternativa `X-API-Key`), igual que el plan de `ssff-mcp`. Solo HTTPS. |
| Formato | `stk_` + 32 bytes aleatorios en base64url. |
| Almacenamiento | Solo el **hash SHA-256**, en el servicio *user-provided* `strahana-secrets`. La key en claro no se guarda en ningún lado. |
| Verificación | Comparación en tiempo constante (`timingSafeEqual`) en cada llamada. |
| Emisión | Script `pnpm apikey:new -- --user jdoe --groups STRAHANA_DEV_SALES`: genera la key (se muestra **una sola vez**) y la entrada con el hash para pegar en el servicio. |
| Distribución | Por un canal seguro; el usuario la configura en su cliente MCP como encabezado. **Nunca** en repositorios ni en chats. |
| Rotación / revocación | Reemplazar o quitar la entrada en `strahana-secrets` y ejecutar `cf restage`. |
| Auditoría | Cada llamada queda asociada al `user` de la key. |
| Limitaciones aceptadas | Sin SSO, revocación manual y keys de larga vida. Aceptable para un piloto con pocos usuarios; se resuelve con IAS ([P-017](proposals/P-017-autenticacion-ias.md)). |

### 9.3 Diseño conceptual con IAS

| Elemento | Diseño |
|----------|--------|
| Proveedor de identidad | SAP Cloud Identity Services (IAS), con una aplicación OIDC dedicada para STRAHANA. |
| Flujo | OAuth 2.1 con PKCE desde el cliente MCP; STRAHANA actúa como *resource server*. |
| Descubrimiento | `/.well-known/oauth-protected-resource` apuntando a IAS como servidor de autorización. |
| Registro del cliente | Client ID preregistrado en IAS (la especificación depreca Dynamic Client Registration). |
| Validación | `@sap/xssec`: firma, emisor, audiencia y expiración del JWT. |
| Autorización | Claim `groups` del token → mismo modelo que en [§9.1](#91-modelo-común). |
| Implementación | Adaptador `IasTokenVerifier` en lugar de `ApiKeyVerifier`. Detalle en [P-017](proposals/P-017-autenticacion-ias.md). |

### 9.4 Modo local (stdio)

Sin autenticación: usa el `default-env.json` del propio desarrollador y su identidad local. Rechaza los entornos con `productive: true`. Solo para desarrollo.

---

## 10. Estrategia de tokens para el LLM del usuario

En el MVP todo el consumo ocurre en el asistente del usuario, por eso cada byte que devuelve STRAHANA importa.

### 10.1 Costo fijo (en cada turno de la conversación)

| Estrategia | Detalle |
|------------|---------|
| **Dos herramientas** | Menos definiciones = menos tokens en cada turno. |
| Descripciones de una línea, en inglés | Descripciones de los parámetros solo cuando no son obvias. |
| Sin `instructions` del servidor, sin recursos ni prompts MCP en el MVP | Todo eso también se envía o se anuncia al modelo. |
| Orden determinista de `tools/list` | Mejora la tasa de acierto de la caché de prompts del cliente (recomendación de la especificación `2026-07-28`). |
| **Objetivo** | ≤ 300 tokens para las dos definiciones. |

### 10.2 Contexto (por pregunta nueva)

| Estrategia | Detalle |
|------------|---------|
| Top-k (≤ 5 tablas, ≤ 12 campos por tabla) | Solo lo relevante; nunca el catálogo completo. |
| Serialización compacta | Códigos de tipo (`s36`, `d15.2`), etiquetas cortas y separador `·`, en lugar de JSON o YAML. |
| Revelación progresiva | `+N cols` y el parámetro `entities` para pedir el detalle solo cuando hace falta. |
| Sinónimos fuera de la respuesta | Se usan para buscar, no para el LLM. |
| Reglas en una línea, dentro del contexto | Solo se pagan cuando se piden, no en cada turno. |
| `context_id` reutilizable por 60 min (TTL fijo) | Las preguntas de seguimiento del mismo tema no vuelven a pedir contexto. |
| **Objetivo** | ≤ 800 tokens por contexto. |

### 10.3 SQL (tokens de salida del LLM)

| Estrategia | Detalle |
|------------|---------|
| Sin schema en los nombres | El servidor fija el schema por defecto. |
| `limit` como parámetro | No hace falta reescribir el SQL para paginar o limitar. |
| Errores con sugerencias exactas | Una corrección en un intento, sin pedir contexto de nuevo. |

### 10.4 Resultados

| Estrategia | Detalle |
|------------|---------|
| TSV | El formato tabular más compacto. |
| `pageSize` por defecto de 50 filas, `limit` configurable | El LLM pide solo lo necesario. |
| Columnas vacías omitidas, textos largos truncados | Sin perder información útil. |
| `notes:` solo cuando el servidor aplicó o advierte algo (incluido `no ORDER BY, page order is not guaranteed` al paginar) | Sin texto de relleno. |
| Sin conteo total ni `structuredContent` | Sin costo duplicado. |
| Recomendación de agregar (`GROUP BY`) incluida en las reglas | Un total por cliente cuesta menos que mil filas crudas. |
| `maxResponseBytes` | Techo duro por llamada. |
| **Objetivo** | ≤ 1 500 tokens por página típica. |

### 10.5 Medición

- **Pruebas de presupuesto en CI**: tamaño de `tools/list`, del contexto de las preguntas de referencia y de respuestas típicas (estimación de bytes / 4).
- El log de auditoría registra los bytes devueltos por llamada para ajustar los límites con datos reales.

---

## 11. Arquitectura

### 11.1 Bounded contexts

| Contexto | Responsabilidad | Lenguaje del dominio |
|----------|-----------------|----------------------|
| `access` | Quién puede usar qué entorno; guardas de entrada; rate limit. | Principal, grupo, entorno, permiso |
| `catalog` | Modelo del catálogo, detección de tablas y campos, construcción y firma del contexto. | Dominio, tabla, campo, join, contexto |
| `query` | Política de SQL, validación, ejecución, formato de resultados, paginación. | Consulta, política, resultado, página |

### 11.2 Estructura

```
src/
├── platform/                  # transversal (futuro compartido con ssff-mcp)
│   ├── mcp/                   # createMcpServer(deps), registro de herramientas, stdio + Streamable HTTP
│   ├── auth/                  # puerto TokenVerifier + ApiKeyVerifier (IasTokenVerifier en P-017)
│   ├── config/                # strahana.config.json + VCAP_SERVICES / default-env.json
│   ├── errors/                # SanitizedError y códigos
│   ├── logging/               # logger JSON a stderr con lista blanca de campos + auditoría
│   └── security/              # firma HMAC de handles
└── hana/
    ├── access/
    │   ├── domain/            # Principal, EnvironmentAccess, InputGuard (puros)
    │   ├── application/       # authorizeEnvironment
    │   └── infrastructure/    # rate limiter en memoria
    ├── catalog/
    │   ├── domain/            # Catalog, Entity, Column, ContextSelection, ContextRenderer (puros)
    │   ├── application/       # buildContext
    │   └── infrastructure/    # cargador YAML, índice MiniSearch
    ├── query/
    │   ├── domain/            # SqlPolicy, ValidationRules, ResultFormatter (puros)
    │   ├── application/       # runQuery
    │   └── infrastructure/    # adaptador node-sql-parser, ejecutor @sap/hana-client
    └── mcp/                   # adaptadores de entrada: hana_context, hana_query
scripts/
└── apikey-new.ts              # emisión de API keys (§9.2)
```

### 11.3 Puertos

| Puerto | Contexto | Adaptador del MVP |
|--------|----------|-------------------|
| `TokenVerifier` | platform | `ApiKeyVerifier` (`node:crypto`); `IasTokenVerifier` en [P-017](proposals/P-017-autenticacion-ias.md) |
| `CredentialProvider` | platform | `@sap/xsenv` (`VCAP_SERVICES` / `default-env.json`) |
| `RateLimiter` | access | En memoria |
| `CatalogSource` | catalog | Archivos YAML |
| `CatalogSearch` | catalog | MiniSearch |
| `SqlParser` | query | `node-sql-parser` (gramática PostgreSQL) |
| `QueryExecutor` | query | `@sap/hana-client` (pool por entorno) |
| `AuditSink` | platform | Logger JSON a stderr |
| `Clock` | platform | Reloj del sistema (inyectable en pruebas) |

**Reglas:** `domain/` es puro (sin I/O); `application/` depende de puertos; un contexto no importa el `domain/` de otro, sino que usa los tipos públicos de su `application/`.

---

## 12. Compatibilidad con SSFF MCP

Análisis de [`chiptime/ssff-mcp`](https://github.com/chiptime/ssff-mcp) (commit `1e6382c`). El plan completo de unificación está en [P-015](proposals/P-015-unificacion-ssff-mcp.md). En el MVP, STRAHANA se alinea con lo que no cuesta nada alinear:

| Aspecto | `ssff-mcp` | Decisión en STRAHANA |
|---------|------------|----------------------|
| TypeScript estricto, ESM, NodeNext, SDK MCP 1.x (`registerTool`) | Sí | **Igual** |
| Motor `createMcpServer(deps)` independiente del transporte | Sí | **Igual** |
| Catálogo de herramientas único + `docs/tools.md` generado + prueba de deriva | Sí | **Igual** |
| `SanitizedError { code, message }` | Sí | **Igual** |
| Logger JSON a stderr con lista blanca de campos | Sí | **Igual** (sin `pino`) |
| Pruebas con `node:test` | Sí | **Igual** (sin `vitest`) |
| `environment` explícito, sin entorno por defecto implícito | Sí | **Igual** |
| Mapa `environments` en la configuración | Sí | **Igual**, con `kind: "hana"` |
| Autenticación de clientes | API key hasheada planificada (`Bearer` / `X-API-Key`); IAS en su roadmap | **Igual**: API key en el piloto, IAS después |
| Prefijo en herramientas | No (`query_entity`, …) | **`hana_*`**; proponer `sf_*` al unificar |
| Gestor de paquetes | pnpm | **pnpm** (decisión del proyecto; fricción documentada) |
| `zod` | 3.25 | **4** (el SDK acepta ambas; migrar `ssff-mcp` al unificar) |
| Cursor | HMAC con secreto aleatorio por proceso | **Clave configurada** (R7) |
| Arquitectura | Módulos planos | Screaming + hexagonal; `ssff-mcp` se envolvería como contexto `successfactors` |

---

## 13. Stack tecnológico

| Propósito | Librería | Versión | Por qué |
|-----------|----------|---------|---------|

| Servidor MCP | `@modelcontextprotocol/sdk` | 1.32.x | SDK oficial; stdio y Streamable HTTP. **Verificar la revisión de la especificación soportada.** |
| HTTP | `express` | 5.x | Integración con el transporte HTTP del SDK, middleware de autenticación y `/health`. |
| Credenciales | `@sap/xsenv` | 6.x | Lee `VCAP_SERVICES` y `default-env.json`, y filtra servicios por tag. Convención de CAP. |
| Driver de HANA | `@sap/hana-client` | 2.30.x | Driver oficial: pool, TLS, schema por defecto (`currentSchema`). |
| Parser de SQL | `node-sql-parser` | 5.4.x | AST y lista de tablas y columnas. Sin dialecto HANA: se usa la gramática PostgreSQL sobre un subconjunto (spike en la Fase 0). |
| Detección en el catálogo | `minisearch` | 7.2.x | Búsqueda léxica en memoria con búsqueda difusa, prefijos y boosts. Sin dependencias. |
| Sugerencias "¿quisiste decir…?" | `fastest-levenshtein` | 1.x | Pequeña y sin dependencias. |
| Esquemas | `zod` | 4.x | Configuración, catálogo y entradas de las herramientas; genera los JSON Schema del editor. |
| YAML | `yaml` | 2.x | Lectura de catálogos con buenos mensajes de error. |
| API keys y firmas | `node:crypto` | Node 22 | SHA-256, HMAC, `timingSafeEqual`, generación aleatoria. Sin dependencias. |
| Pruebas | `node:test` | Node 22 | Alineado con `ssff-mcp`; sin dependencias. |
| Lint / formato | `eslint` + `typescript-eslint`, `prettier` | 10.x / 8.x / 3.x | Estándar del equipo. |

**Descartadas a propósito:** CAP (no somos dueños del modelo de datos que se consulta), `@sap/xssec` (entra con IAS en [P-017](proposals/P-017-autenticacion-ias.md)), SDKs de IA ([P-001](proposals/P-001-llm-intermedio-servidor.md)), `pino` y `vitest` (alineación con `ssff-mcp`), bases vectoriales ([P-005](proposals/P-005-busqueda-semantica-embeddings.md)).

---

## 14. Despliegue en SAP BTP

| Recurso | Uso en el MVP |
|---------|---------------|

| Cloud Foundry (buildpack de Node.js) | **Una instancia** (el rate limit es en memoria; para escalar, ver [P-007](proposals/P-007-escalamiento-horizontal.md)). |
| Servicios *user-provided* | Uno por conexión de HANA Cloud y uno de secretos (`strahana-secrets`: clave de firma y hashes de API keys). |
| SAP HANA Cloud | Instancia propia con "Allowed connections" restringidas a las IP de SAP BTP (R5). |

- Empaquetado como **MTA** (`mta.yaml`): módulo Node.js y servicios *user-provided* como recursos existentes.
- Endpoints: `/mcp` (Streamable HTTP, requiere API key) y `/health` (sin autenticación, sin datos).
- `catalog/` y `strahana.config.json` se despliegan con la aplicación; un cambio de catálogo es un despliegue.

---

## 15. Criterios de éxito del MVP

- [ ] **0 sentencias distintas de `SELECT`** ejecutadas: pruebas del validador **y** una prueba que confirma que `STRAHANA_RO` no puede escribir.
- [ ] Las credenciales y las API keys no aparecen en logs, respuestas, errores ni archivos versionados.
- [ ] Una llamada sin API key válida o a un entorno no permitido se rechaza.
- [ ] **Recall del contexto ≥ 90 %**: en 30 preguntas de referencia, `hana_context` incluye las tablas y los campos necesarios.
- [ ] **Precisión de punta a punta ≥ 80 %** en esas 30 preguntas con el cliente MCP aprobado (evaluación manual).
- [ ] Presupuestos de tokens de [§10](#10-estrategia-de-tokens-para-el-llm-del-usuario) cumplidos y verificados en CI.
- [ ] p95 de `hana_query` < 3 s (sin contar el tiempo del LLM).
- [ ] Al menos 3 consultores lo usan en tareas reales durante el piloto.

---

## 16. Plan de entrega

| Fase | Resultado | Criterio de salida |
|------|-----------|--------------------|
| **0 — Preparación técnica** | Eliminar las incertidumbres técnicas. | Spike del parser aprobado (corpus de ~100 consultas: el subconjunto se parsea y lo no soportado falla de forma cerrada); `STRAHANA_RO` con su `.hdbrole` creado y verificado como de solo lectura; HANA Cloud acepta conexiones desde BTP; `SET TRANSACTION READ ONLY` verificado; el cliente MCP aprobado envía encabezados personalizados. |
| 1 — Plataforma | `platform/`: configuración, credenciales, errores, logger, API key, servidor MCP (stdio + HTTP), MTA. | Un usuario con API key lista las herramientas desde su asistente contra la instancia en BTP. |
| 2 — Catálogo | Contexto `catalog` + `hana_context`. | Recall ≥ 90 % en las preguntas de referencia; presupuesto de tokens del contexto en CI. |
| 3 — Consulta | Contexto `query` + `hana_query`. | Pruebas del validador (positivas y negativas) en verde; ejecución real en HANA Cloud con `STRAHANA_RO`. |
| 4 — Piloto | Consultores en uso real. | Criterios de [§15](#15-criterios-de-éxito-del-mvp) cumplidos; feedback documentado y propuestas repriorizadas. |

---

## 17. Riesgos del MVP

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| El parser no cubre bien el SQL que escriben los LLM para HANA | Media | Alto | Subconjunto restringido, reglas explícitas en el contexto, falla cerrada, spike en la Fase 0, plan B con gramática propia. |
| Filtración de una API key | Media | Alto | Una key por usuario, solo el hash almacenado, HTTPS, auditoría por usuario, revocación inmediata; IAS en [P-017](proposals/P-017-autenticacion-ias.md). |
| Exposición de datos al proveedor del LLM del usuario | Media | Alto | Solo clientes MCP aprobados por la empresa; catálogo sin columnas sensibles; límites de filas. |
| Se usa por error el usuario de runtime del HDI (con escritura) | Baja | Crítico | Usuario dedicado obligatorio (R4); prueba de escritura que debe fallar como criterio de éxito. |
| La precisión depende del LLM de cada usuario | Media | Medio | Contexto con reglas y joins explícitos; errores con sugerencias; [P-001](proposals/P-001-llm-intermedio-servidor.md) a futuro. |
| El cliente MCP aprobado no admite encabezados personalizados | Baja | Alto | Validación en la Fase 0; elegir un cliente que los admita. |
| Catálogo de baja calidad | Media | Alto | Responsable funcional del dominio; recall medido en CI. |

---

## 18. Preguntas abiertas

- [ ] ¿Qué proyecto CAP y qué contenedor HDI serán el piloto?
- [ ] ¿Qué dominio funcional se curará primero y quién es su responsable?
- [ ] ¿Quién administra la instancia de HANA Cloud y crea `STRAHANA_RO`?
- [ ] ¿Qué cliente o clientes MCP aprueba la empresa para usar con datos?
- [ ] ¿Quién emite y distribuye las API keys del piloto?
- [x] Para la unificación futura con `ssff-mcp`: ¿npm o pnpm? **Resuelto: pnpm** (decisión del proyecto; igual que `ssff-mcp`).

---

## 19. Referencias

- [MCP: cambios de la especificación (revisión actual)](https://modelcontextprotocol.io/specification/latest/changelog)
- [`chiptime/ssff-mcp`](https://github.com/chiptime/ssff-mcp)
- [`node-sql-parser`](https://github.com/taozhi8833998/node-sql-parser)
- [SAP Developers: conectar Node.js en Cloud Foundry con SAP HANA](https://developers.sap.com/tutorials/hana-clients-cf.html)
