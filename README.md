# STRAHANA

Servidor MCP para SAP BTP (Cloud Foundry) que permite al LLM del usuario consultar bases SAP HANA en **solo lectura**, sin exponer credenciales y con el mínimo consumo de tokens.

- Fuente de verdad del MVP: [`docs/00-pov.md`](docs/00-pov.md). Propuestas futuras: [`docs/proposals/`](docs/proposals/README.md).
- Herramientas expuestas: [`docs/tools.md`](docs/tools.md) (`hana_context` y `hana_query`).
- **Estado:** Fases 1 (plataforma), 2 (catálogo) y 3 (consulta) implementadas en código. `hana_context` devuelve el contexto compacto y un `context_id` firmado; `hana_query` valida el SQL, lo ejecuta en solo lectura mediante `@sap/hana-client` y devuelve TSV paginado. **Pendiente: la validación contra una instancia real de HANA Cloud** (ver [Prueba de integración opt-in](#prueba-de-integración-opt-in)); todo lo demás se prueba con un ejecutor en memoria.

## Requisitos

- Node.js 22 o superior (`.nvmrc` fija 22).
- pnpm 11 (el campo `devEngines` de `package.json` lo descarga si falta).

## Inicio rápido

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Configuración

La configuración se divide en dos archivos (POV §8):

| Archivo                                          | Contenido                                                                 | ¿Se versiona? |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------- |
| `strahana.config.json`                           | Entornos, grupos, límites. Sin secretos.                                  | Sí            |
| `default-env.json` (local) / `VCAP_SERVICES` (BTP) | Credenciales de HANA, clave de firma y hashes de las API keys.            | **Nunca**     |

1. Copia `default-env.example.json` a `default-env.json` (está en `.gitignore`).
2. Genera la clave de firma y pégala en `signingKey` del servicio `strahana-secrets`:

   ```bash
   openssl rand -base64 48
   ```

3. Ajusta `strahana.config.json` (ejemplo en `strahana.config.example.json`): cada entorno referencia un servicio de conexión (`service`), un `schema`, un `catalog` y los `groups` autorizados.
4. Las credenciales del servicio de conexión las usa `hana_query` para abrir el pool del entorno. Para desarrollo sin base de datos, usa valores sintéticos: el servidor arranca igual y la conexión se abre de forma diferida en la primera consulta.

El servidor falla al arrancar, con un mensaje de una línea sin valores secretos, si falta un servicio, si la clave de firma tiene menos de 32 bytes o si algún archivo no cumple el esquema.

## Emitir una API key

```bash
pnpm apikey:new -- --user jdoe --groups STRAHANA_DEV_SALES
```

El script imprime la key en claro **una sola vez** y la entrada con su hash SHA-256. Pega esa entrada en el arreglo `apiKeys` del servicio `strahana-secrets` y reinicia (`cf restage` en BTP). Reglas:

- Una key por usuario; el grupo de la key decide a qué entornos accede (`groups` del usuario cruzado con `environments.*.groups`).
- Solo el hash se guarda. Entrega la key por un canal seguro; nunca la subas a un repositorio ni la pegues en un chat.
- Para revocar o rotar, quita o reemplaza la entrada y reinicia.

## Ejecutar

### HTTP (BTP y pruebas locales)

```bash
pnpm start                       # puerto 8080 o la variable PORT
node dist/src/index.js --transport http --port 3000
```

- `POST /mcp`: Streamable HTTP, sin estado. **Cada llamada** exige `Authorization: Bearer <api-key>` o `X-API-Key: <api-key>`; sin ella responde `401` y no se procesa el cuerpo.
- `GET /health`: sin autenticación y sin datos (`{"status":"ok"}`).

Configuración del cliente MCP (la sintaxis exacta depende del cliente; debe admitir encabezados personalizados):

```json
{
  "mcpServers": {
    "strahana": {
      "type": "http",
      "url": "https://<tu-app>.cfapps.<region>.hana.ondemand.com/mcp",
      "headers": { "Authorization": "Bearer <api-key>" }
    }
  }
}
```

### stdio (desarrollo local)

```bash
pnpm start:stdio
```

No autentica y usa el `default-env.json` del desarrollador. **Rechaza los entornos con `productive: true`**: no los carga y, si no queda ninguno, no arranca. La salida estándar queda reservada al protocolo; los logs van a stderr.

Opciones comunes: `--config <archivo>` (por defecto `strahana.config.json`) y `--env-file <archivo>` (por defecto `default-env.json`).

## Herramientas

El catálogo único está en `src/hana/mcp/tool-catalog.ts`. Tras modificarlo:

```bash
pnpm docs:tools   # regenera docs/tools.md; una prueba de deriva falla si no coincide
```

Las dos definiciones juntas deben pesar 300 tokens o menos (estimación: bytes serializados / 4, POV §10.5); la prueba de presupuesto lo verifica.

## Catálogo y `hana_context`

El catálogo es una **lista blanca**: lo que no está en `catalog/<dominio>.catalog.yaml` no se puede consultar (POV §5). El ejemplo sintético `catalog/sales.catalog.yaml` sirve de plantilla.

### Escribir un catálogo

```yaml
# yaml-language-server: $schema=../schemas/catalog.schema.json
domain: sales
version: 1
label: Ventas
entities:
  - name: COM_ACME_SALES_ORDERS # nombre físico exacto, sin schema
    label: Pedidos de venta # máximo 4 palabras; se envía al LLM
    synonyms: [pedidos, orders] # solo para buscar; nunca se envían al LLM
    columns:
      - { name: ID, type: string, length: 36, key: true, label: ID }
      - { name: TOTALAMOUNT, type: decimal, precision: 15, scale: 2, label: Importe total }
    joins:
      - { entity: COM_ACME_SALES_CUSTOMERS, on: { CUSTOMER_ID: ID } }
    rules: ["STATUS_CODE: O=open, C=closed"] # opcional, hasta 3 líneas de 120 caracteres
```

- Tipos: `string` (con `length`), `decimal` (con `precision` y `scale`), `integer`, `bigint`, `date`, `timestamp`, `boolean`.
- No incluyas columnas sensibles (salarios, datos bancarios, datos personales) ni objetos `SYS`.
- Cada entorno apunta a su catálogo con la clave `catalog` de `strahana.config.json` (ruta relativa al directorio de trabajo del proceso).
- La versión efectiva del catálogo combina `version` con un resumen del contenido: cualquier cambio invalida los `context_id` emitidos antes, aunque olvides subir `version`. Aun así, súbela en cada cambio (POV §5.3).

### Validar un catálogo

```bash
pnpm catalog:validate                                  # todos los catalog/*.catalog.yaml
pnpm catalog:validate -- catalog/sales.catalog.yaml    # uno solo
pnpm catalog:schema                                    # regenera schemas/catalog.schema.json (esquema para el editor)
```

Los errores son de una línea, indican la ruta del campo y nunca repiten valores (por ejemplo, `catalog catalog/sales.catalog.yaml: entities.0.columns.2.type: Invalid option`). El servidor valida el catálogo de cada entorno al arrancar y **no inicia** si alguno es inválido; una prueba de deriva falla si `schemas/catalog.schema.json` no coincide con el esquema zod.

### Usar `hana_context`

| Parámetro | Descripción |
| --- | --- |
| `question` | Pregunta en lenguaje natural (3 a 300 caracteres). Se rechaza el SQL (`QUESTION_IS_SQL`). |
| `environment` | Opcional si el usuario tiene un solo entorno; si tiene varios, el error los lista (`ENV_REQUIRED`). |
| `entities` | Opcional, hasta 5 nombres físicos: devuelve **todas** las columnas de esas tablas y solo esas. |

La respuesta es un único bloque de texto con el formato compacto del POV §4.2 (`ctx=… env=… ttl=60m`, tablas con tipos y etiquetas, `join …`, `+N cols`, línea `rules:`), con un máximo de 5 tablas y 12 columnas por tabla. Los sinónimos nunca se envían. Si nada coincide, la respuesta es una línea accionable más un resumen de las tablas del dominio, sin `context_id`.

El `context_id` se firma con HMAC usando `signingKey` (nunca una clave aleatoria por proceso) y queda ligado al usuario, el entorno, la versión del catálogo, las tablas del contexto y una expiración de 60 minutos. `hana_query` lo verifica con `verifyContextId`.

Cada llamada deja un registro de auditoría (`event: "context"`) con usuario, entorno, duración, resultado, bytes y un **resumen corto de la pregunta**; nunca el texto de la pregunta, valores ni el contexto. El límite por usuario es `limits.rateLimitPerMinute` del entorno (en memoria, una sola instancia).

### Calidad: recall y presupuesto de tokens

`pnpm test` incluye 30 preguntas de referencia sintéticas (español e inglés, `test/fixtures/reference-questions.ts`) y exige un recall mínimo de 90 % de tablas y campos en el contexto, además de un máximo de 800 tokens por contexto (estimación bytes / 4, POV §10.2). Al ampliar un catálogo real, agrega sus propias preguntas de referencia.

## Consultar con `hana_query`

`hana_query(sql, context_id, limit?, offset?)` ejecuta **un único `SELECT`** sobre las tablas del `context_id` y devuelve TSV (POV §4.3). El entorno sale del propio `context_id`; no hay parámetro `environment`.

```
rows=3 more=yes next_offset=3
ORDERNUMBER	NAME	TOTALAMOUNT	CURRENCY_CODE
SO-00000	Customer 0	1000.00	EUR
SO-00001	Customer 1	1012.50	EUR
SO-00002	Customer 2	1025.00	EUR
notes: no ORDER BY, page order is not guaranteed
```

- **Paginación.** `limit` (por defecto `pageSize` del entorno, máximo `maxRows`; si lo supera, `SQL_FORBIDDEN`) reemplaza a `LIMIT`/`TOP`. Si hay más filas, la primera línea trae `more=yes next_offset=N`: el LLM repite la llamada con el **mismo `sql` y `context_id`** y `offset=N`. El servidor pide una fila de más para saber si hay otra página. Sin `ORDER BY`, el orden entre páginas no está garantizado y la respuesta lo avisa en `notes:`.
- **Formato.** Sin conteo total, sin `structuredContent` ni `outputSchema`. `NULL` es una celda vacía; tabuladores, saltos de línea y `\` dentro de valores se escapan (`\t`, `\n`, `\r`, `\\`); los textos de más de 120 caracteres se truncan con `…`; las columnas vacías en toda la página se omiten. Cada acción del servidor se informa en la línea `notes:`, que solo aparece si hubo alguna.
- **Tope de bytes.** La respuesta nunca supera `limits.maxResponseBytes`: si no cabe la página, se recortan filas y `next_offset` apunta a la primera fila no mostrada (`notes: response capped at N bytes`). Si ni una sola fila cabe, el error pide seleccionar menos columnas.
- **Errores.** Una línea con código, causa y corrección (`SQL_PARSE`, `SQL_NOT_SELECT`, `SQL_ENTITY_NOT_IN_CONTEXT`, `SQL_ENTITY_UNAVAILABLE`, `SQL_UNKNOWN_COLUMN` con sugerencia `Did you mean …?`, `SQL_AMBIGUOUS_COLUMN`, `SQL_FORBIDDEN`, `CONTEXT_INVALID`, `DB_TIMEOUT`, `DB_ERROR`). Nunca incluyen literales del SQL ni mensajes crudos del driver.
- **Auditoría.** Cada llamada deja un registro `event: "audit"` con usuario, entorno, hash SHA-256 del SQL, filas, duración, resultado y bytes. Nunca el texto del SQL ni valores de filas.

### Subconjunto de SQL permitido (POV §6)

Se parsea con `node-sql-parser` (gramática PostgreSQL), se recorre el AST con una lista blanca y **se ejecuta el texto original validado** más `LIMIT n OFFSET m` agregados por el servidor (nunca SQL regenerado desde el AST). Lo que no se reconoce se rechaza (falla cerrada).

| Permitido | Rechazado |
| --- | --- |
| Un solo `SELECT` sin `;` final | Varias sentencias, `;`, comentarios (`--`, `/* */`), `\`, comillas invertidas, `#`, caracteres no ASCII fuera de comillas |
| Columnas explícitas y alias | `SELECT *`, `t.*` |
| `INNER JOIN`, `JOIN`, `LEFT JOIN` con `ON`, hasta 4 tablas en total | `CROSS`/`RIGHT`/`FULL`/`NATURAL JOIN`, `USING`, joins con coma, más de 4 tablas |
| `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY` | `LIMIT`, `OFFSET`, `TOP`, `FETCH`, `NULLS FIRST/LAST`, `ROLLUP`, `GROUPING SETS` |
| Subconsultas en `WHERE` (`IN`, `EXISTS`, escalares) y en `FROM` (con alias), hasta 2 niveles | `WITH` (CTE), `UNION`/`INTERSECT`/`EXCEPT`, funciones de ventana, `INTO`, `FOR UPDATE` |
| `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `COUNT(DISTINCT …)` | Cualquier otra agregación |
| `CAST` a `VARCHAR`, `CHAR`, `INTEGER`, `INT`, `BIGINT`, `SMALLINT`, `TINYINT`, `DECIMAL`, `NUMERIC`, `REAL`, `DOUBLE`, `FLOAT`, `DATE`, `TIME`, `TIMESTAMP`; `CASE`, `COALESCE`, `EXTRACT` | `::`, `INTERVAL`, `COLLATE`, parámetros `?`, literales `N'…'`/`X'…'` |
| Funciones de la lista blanca (`src/hana/query/domain/sql-policy.ts`): texto (`UPPER`, `LOWER`, `LENGTH`, `TRIM`, `SUBSTRING`, `CONCAT`, `REPLACE`, `LEFT`, `RIGHT`, `LPAD`, `RPAD`, `LOCATE`, `INSTR`), numéricas (`ROUND`, `FLOOR`, `CEIL`, `ABS`, `MOD`, `SIGN`, `POWER`, `SQRT`), nulos (`NULLIF`, `IFNULL`), fechas (`ADD_DAYS`, `ADD_MONTHS`, `ADD_YEARS`, `ADD_SECONDS`, `DAYS_BETWEEN`, `SECONDS_BETWEEN`, `MONTHS_BETWEEN`, `YEAR`, `MONTH`, `DAYOFMONTH`, `WEEK`, `HOUR`, `MINUTE`, `SECOND`, `DAYNAME`, `MONTHNAME`, `LAST_DAY`, `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `CURRENT_UTCDATE`, `CURRENT_UTCTIMESTAMP`) y conversión (`TO_DATE`, `TO_TIMESTAMP`, `TO_VARCHAR`, `TO_NVARCHAR`, `TO_INTEGER`, `TO_BIGINT`, `TO_DECIMAL`, `TO_DOUBLE`) | Cualquier otra función, incluidas las calificadas con schema, `SESSION_CONTEXT`, `CURRENT_USER`, procedimientos y funciones de tabla |
| Nombres sin schema; identificadores sin comillas (se pliegan a mayúsculas) o entre comillas dobles en mayúsculas | Nombres con schema, objetos `SYS`/`SYS_*`/`_SYS_*`, identificadores entre comillas con minúsculas (son otro objeto en HANA) |

Además, cada tabla debe estar en el `context_id` (si está en el catálogo pero no en el contexto, el error indica `hana_context` con `entities:[…]`) y cada columna en el catálogo; los alias y las columnas sin calificar se resuelven sin ambigüedad. Un `;` final se rechaza con un mensaje que pide quitarlo (el SQL se ejecuta tal cual se recibe).

**Limitaciones conocidas** (el parser no tiene dialecto HANA; se rechazan con un mensaje que indica la alternativa): `CAST` a `NVARCHAR`, `SECONDDATE`, `DAYDATE`, `SMALLDECIMAL` y `NCLOB` (usa `VARCHAR`, `TIMESTAMP`, `DATE`, `DECIMAL(p,s)`), `SUBSTRING(x FROM … FOR …)` (usa `SUBSTRING(x, inicio, largo)`) y literales con exponente (`1.5E3`). Las pruebas del validador fijan este comportamiento (`test/fixtures/sql/hana-gaps.json`).

### Solo lectura: capas aplicadas por el ejecutor

1. **Base de datos (garantía final).** El servicio de conexión del entorno debe usar el usuario dedicado `STRAHANA_RO`, con un `.hdbrole` de solo `SELECT` sobre los objetos del catálogo, sin `EXECUTE` ni acceso a `SYS`. **Nunca** el usuario de runtime del contenedor HDI.
2. **Validador.** Subconjunto anterior más lista blanca del catálogo y del contexto.
3. **Sesión.** Cada consulta usa su propia transacción con autocommit desactivado: primero se ejecuta `SET TRANSACTION READ ONLY` (si falla, la sentencia **no** se envía) y al terminar se hace `ROLLBACK`. El schema se fija con la opción de conexión `currentSchema` del entorno.
4. **Ejecución.** `LIMIT`/`OFFSET` del servidor, timeout por sentencia (`Statement.setTimeout` con `limits.timeoutSeconds`, más un temporizador local de respaldo), pool por entorno (`limits.poolSize`, 4 por defecto) y tope de bytes.

Los errores del driver se traducen a `DB_TIMEOUT`/`DB_ERROR` con un texto fijo y el código numérico de HANA; el mensaje del driver nunca se reenvía porque puede contener valores, nombres de objetos o hosts.

### Prueba de integración opt-in

`test/hana/query/infrastructure/hana-executor.integration.test.ts` se **omite** salvo que `STRAHANA_IT=1`. Requisitos:

- `default-env.json` con el servicio de conexión del entorno y el usuario **`STRAHANA_RO`** (la prueba se niega a correr con otro usuario), y `strahana.config.json` con ese entorno.
- Datos sintéticos únicamente.

```bash
STRAHANA_IT=1 \
STRAHANA_IT_ENV=DEV-SALES \
STRAHANA_IT_SELECT="SELECT ID FROM COM_ACME_SALES_ORDERS" \
STRAHANA_IT_WRITE_SQL="UPDATE COM_ACME_SALES_ORDERS SET ID = ID WHERE 1 = 0" \
pnpm test
```

Comprueba que (1) un `SELECT` corre como `STRAHANA_RO`, (2) una escritura a través del ejecutor **falla** (transacción de solo lectura) y (3) `STRAHANA_RO` **por sí mismo** no puede escribir, aun sin la transacción de solo lectura. Si (3) pasa a escribir, el rol del usuario está mal: corrígelo antes de continuar. Si `SET TRANSACTION READ ONLY` no se acepta en tu instancia, todas las consultas fallan cerradas con `DB_ERROR`; es el punto del POV §7 que esta prueba debe validar.

## Despliegue en SAP BTP

1. Crea los servicios *user-provided* (nunca con credenciales reales en el repositorio):

   ```bash
   cf create-user-provided-service strahana-dev-sales -p connection.json -t strahana-hana
   cf create-user-provided-service strahana-secrets -p secrets.json -t strahana-secrets
   ```

2. Compila y despliega el MTA (una sola instancia, POV §14):

   ```bash
   mbt build
   cf deploy mta_archives/strahana_0.1.0.mtar
   ```

`mta.yaml` declara los servicios como recursos existentes y vincula la aplicación a cada uno; añade un recurso y un `requires` por cada servicio de conexión que use `strahana.config.json`. `default-env.json` nunca se empaqueta.

## Estructura

```plain
src/
├── platform/   # errors, logging, security (HMAC), config, auth, mcp (sin conocer HANA)
├── hana/       # access (entorno, guardas, rate limit), catalog (catálogo, contexto, firma), query (validador, paginación, TSV, ejecutor HANA) y mcp (herramientas)
├── bootstrap.ts
└── index.ts
catalog/        # catálogos YAML por dominio (ejemplo sintético)
schemas/        # JSON Schema del catálogo, generado desde zod
scripts/        # apikey-new, docs-tools, catalog-validate, catalog-schema
test/           # node:test con puertos en memoria y datos sintéticos
```

## Seguridad

- Las credenciales, los hashes y las API keys no se escriben en logs, errores ni respuestas. El logger solo emite campos de una lista blanca.
- La garantía final de solo lectura es el usuario técnico de HANA (`STRAHANA_RO`) con permiso únicamente de `SELECT` (POV §7); el servidor nunca usa el usuario de runtime de un contenedor HDI.
- El SQL, los literales y los valores de filas no se escriben en logs, errores ni auditoría; solo el hash SHA-256 del SQL.
