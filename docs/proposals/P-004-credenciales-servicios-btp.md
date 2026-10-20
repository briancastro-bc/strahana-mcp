# P-004 — Credenciales gestionadas con servicios de BTP

> **Estado:** Propuesta · **Prioridad:** Media · **Depende de:** MVP

Mover las credenciales de conexión desde servicios *user-provided* / `default-env.json` hacia el **Destination service** o el **Credential Store** de BTP.

## Problema

En el MVP las credenciales viven en `VCAP_SERVICES` (servicios *user-provided* en BTP) y en `default-env.json` en local. Funciona y sigue la convención de CAP, pero:

- Rotar una contraseña exige recrear el servicio y reiniciar la aplicación.
- No hay un punto central para administrar decenas de conexiones (varios clientes, varios entornos).

## Propuesta

| Opción | Ventaja | Desventaja |
|--------|---------|------------|
| **Destination service** (destinations TCP / on-premise) | Integra el `Location ID` de Cloud Connector; administrable desde el cockpit; rotación sin redespliegue. | Pensado para HTTP; las destinations TCP requieren lectura vía API. |
| **Credential Store** | Secretos cifrados, API de rotación, auditoría de acceso. | Un servicio más que administrar. |

Implementar un adaptador `CredentialProvider` adicional; el MVP ya expone ese puerto con el adaptador `VcapCredentialProvider`.

## Criterios de aceptación

- [ ] Rotar una contraseña no requiere redesplegar ni reiniciar STRAHANA (el pool se recicla).
- [ ] Ninguna credencial aparece en logs, errores ni respuestas.
- [ ] El adaptador `VcapCredentialProvider` sigue disponible para desarrollo local.
