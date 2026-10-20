# P-017 — Autenticación con SAP Cloud Identity Services (IAS)

> **Estado:** Propuesta (diseño conceptual en el POV §9.3) · **Prioridad:** Alta (antes de ampliar el piloto) · **Depende de:** MVP

Reemplazar la API key del piloto por autenticación corporativa con IAS, sin cambiar la autorización ni el resto del código.

## Problema

El piloto usa una API key por usuario: no hay SSO, la revocación es manual y las keys son de larga vida. Sirve para pocos usuarios, pero no para un uso amplio.

## Propuesta

| Elemento | Diseño |
|----------|--------|
| Aplicación en IAS | Aplicación OIDC dedicada para STRAHANA, con un cliente público y PKCE. |
| Registro del cliente MCP | **Client ID preregistrado** con los redirect URIs del cliente MCP aprobado. La especificación MCP depreca Dynamic Client Registration en favor de Client ID Metadata Documents; si IAS no los soporta, se mantiene el client ID preregistrado o STRAHANA actúa como proxy OAuth. |
| Descubrimiento | STRAHANA publica `/.well-known/oauth-protected-resource` con IAS como servidor de autorización (OIDC Discovery está soportado desde la especificación MCP `2025-11-25`). |
| Validación | Adaptador `IasTokenVerifier` con `@sap/xssec`: firma, emisor, audiencia y expiración del JWT en cada llamada. |
| Autorización | El claim `groups` del token produce el mismo `Principal { userId, groups[] }` que la API key. `environments.*.groups` no cambia. |
| Convivencia | Durante la transición, ambos verificadores pueden estar activos; después se retira la API key. |
| Despliegue | Servicio `identity` de BTP vinculado a la aplicación en el MTA. |

## Consideraciones

- `ssff-mcp` llegó a la misma conclusión en su roadmap (IAS con client ID preregistrado); conviene implementarlo en `platform/auth` de forma compartida ([P-015](P-015-unificacion-ssff-mcp.md)).
- Validar el flujo completo con el cliente MCP aprobado antes de retirar las API keys.

## Criterios de aceptación

- [ ] Un usuario inicia sesión con su cuenta corporativa desde el cliente MCP aprobado.
- [ ] Un usuario sin el grupo correspondiente no accede al entorno.
- [ ] El cambio de API key a IAS no modifica código fuera de `platform/auth` ni la configuración de entornos.
