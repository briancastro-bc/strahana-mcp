# STRAHANA

Servidor MCP para SAP BTP (Cloud Foundry) que permite al LLM del usuario consultar bases SAP HANA en **solo lectura**, sin exponer credenciales y con el mínimo consumo de tokens.

- Fuente de verdad del MVP: [`docs/00-pov.md`](docs/00-pov.md). Propuestas futuras: [`docs/proposals/`](docs/proposals/README.md).
- Herramientas expuestas: [`docs/tools.md`](docs/tools.md) (`hana_context` y `hana_query`).
- **Estado:** Fase 1 (plataforma) completa. El servidor autentica, lista las dos herramientas y valida la configuración; `hana_context` y `hana_query` responden `NOT_IMPLEMENTED` hasta las fases 2 y 3. Nunca se conecta a HANA todavía.

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
4. En la Fase 1 las credenciales de HANA se validan pero **no se usan**: pon valores sintéticos.

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
├── hana/       # access (autorización por entorno) y mcp (catálogo de herramientas)
├── bootstrap.ts
└── index.ts
scripts/        # apikey-new, docs-tools
test/           # node:test con puertos en memoria y datos sintéticos
```

## Seguridad

- Las credenciales, los hashes y las API keys no se escriben en logs, errores ni respuestas. El logger solo emite campos de una lista blanca.
- La garantía final de solo lectura será el usuario técnico de HANA con permiso únicamente de `SELECT` (POV §7); el servidor nunca usa el usuario de runtime de un contenedor HDI.
