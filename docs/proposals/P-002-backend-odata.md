# P-002 — Backend OData para S/4HANA

> **Estado:** Propuesta · **Prioridad:** Alta (si la licencia del cliente es *runtime*) · **Depende de:** [P-001](P-001-llm-intermedio-servidor.md) recomendado

Consultar S/4HANA a través de sus **APIs OData liberadas** en lugar de SQL directo sobre HANA.

## Problema

- Con licencia HANA **runtime (REAB)**, el acceso SQL directo desde aplicaciones propias suele estar prohibido.
- S/4HANA Cloud Public Edition no ofrece acceso a la base de datos.
- Por SQL no se aplican las autorizaciones ABAP (roles PFCG, access controls de CDS).

## Propuesta

- Nuevo adaptador `ODataQueryBackend` detrás del mismo puerto de ejecución del MVP.
- El catálogo declara, por entidad, el servicio OData y el entity set correspondientes.
- Con [P-001](P-001-llm-intermedio-servidor.md), la Query IR compila a `$select`, `$filter`, `$orderby`, `$top`, `$skip` y `$apply` (agregaciones). Sin P-001, el LLM del usuario generaría consultas OData en lugar de SQL.
- Conexión vía Destination service con principal propagation ([P-003](P-003-propagacion-identidad.md)) para respetar las autorizaciones del usuario.

## Beneficios

- Cumplimiento de licenciamiento.
- Autorizaciones de negocio aplicadas por S/4HANA.
- Compatibilidad con S/4HANA Cloud Public Edition.

## Consideraciones

- No todas las vistas están expuestas como API; la cobertura depende de las APIs liberadas.
- `$apply` (agregaciones) no está soportado en todos los servicios.
- Mayor latencia que el SQL directo.
- El repositorio `ssff-mcp` ya resuelve un cliente OData para SuccessFactors; evaluar la reutilización de su capa OData al unificar ([P-015](P-015-unificacion-ssff-mcp.md)).

## Criterios de aceptación

- [ ] El mismo conjunto de preguntas del dominio piloto se responde vía OData con precisión equivalente.
- [ ] Un usuario sin autorización ABAP sobre una sociedad no ve sus datos.
- [ ] El backend se selecciona por entorno, sin cambios en las herramientas MCP.
