# STRAHANA

Servidor MCP para SAP BTP (Cloud Foundry) que permite al LLM del usuario consultar bases SAP HANA en **solo lectura**, sin exponer credenciales y con el mínimo consumo de tokens.

- Fuente de verdad del MVP: [`docs/00-pov.md`](docs/00-pov.md). Propuestas futuras: [`docs/proposals/`](docs/proposals/README.md).
- Herramientas expuestas: [`docs/tools.md`](docs/tools.md) (`hana_context` y `hana_query`).
- **Estado:** Fases 1 (plataforma) y 2 (catálogo) completas. `hana_context` devuelve el contexto compacto y un `context_id` firmado; `hana_query` responde `NOT_IMPLEMENTED` hasta la Fase 3. Nunca se conecta a HANA todavía.

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
4. Hasta la Fase 3 las credenciales de HANA se validan pero **no se usan**: pon valores sintéticos.

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

El `context_id` se firma con HMAC usando `signingKey` (nunca una clave aleatoria por proceso) y queda ligado al usuario, el entorno, la versión del catálogo, las tablas del contexto y una expiración de 60 minutos. `hana_query` (Fase 3) lo verificará con `verifyContextId`.

Cada llamada deja un registro de auditoría (`event: "context"`) con usuario, entorno, duración, resultado, bytes y un **resumen corto de la pregunta**; nunca el texto de la pregunta, valores ni el contexto. El límite por usuario es `limits.rateLimitPerMinute` del entorno (en memoria, una sola instancia).

### Calidad: recall y presupuesto de tokens

`pnpm test` incluye 30 preguntas de referencia sintéticas (español e inglés, `test/fixtures/reference-questions.ts`) y exige un recall mínimo de 90 % de tablas y campos en el contexto, además de un máximo de 800 tokens por contexto (estimación bytes / 4, POV §10.2). Al ampliar un catálogo real, agrega sus propias preguntas de referencia.

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
├── hana/       # access (entorno, guardas, rate limit), catalog (catálogo, contexto, firma) y mcp (herramientas)
├── bootstrap.ts
└── index.ts
catalog/        # catálogos YAML por dominio (ejemplo sintético)
schemas/        # JSON Schema del catálogo, generado desde zod
scripts/        # apikey-new, docs-tools, catalog-validate, catalog-schema
test/           # node:test con puertos en memoria y datos sintéticos
```

## Seguridad

- Las credenciales, los hashes y las API keys no se escriben en logs, errores ni respuestas. El logger solo emite campos de una lista blanca.
- La garantía final de solo lectura será el usuario técnico de HANA con permiso únicamente de `SELECT` (POV §7); el servidor nunca usa el usuario de runtime de un contenedor HDI.
