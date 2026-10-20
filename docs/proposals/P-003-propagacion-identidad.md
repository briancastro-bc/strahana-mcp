# P-003 — Propagación de identidad (principal propagation)

> **Estado:** Propuesta · **Prioridad:** Media · **Depende de:** MVP

Ejecutar las consultas con la identidad del usuario final en lugar de un usuario técnico compartido.

## Problema

En el MVP todas las consultas de un entorno se ejecutan con un único usuario técnico de solo lectura. La auditoría de HANA ve a ese usuario, no a la persona, y los permisos son iguales para todos los miembros del entorno.

## Propuesta

| Backend | Mecanismo |
|---------|-----------|
| SAP HANA Cloud | Autenticación JWT en HANA: el token de IAS se intercambia y HANA mapea la identidad a un usuario de base de datos. |
| S/4HANA on-premise (SQL) | Usuarios de base de datos por persona mapeados desde IAS (costoso de administrar; evaluar caso a caso). |
| S/4HANA vía OData ([P-002](P-002-backend-odata.md)) | Principal propagation estándar de BTP a través de Cloud Connector. |

## Beneficios

- Auditoría nativa por persona en la base de datos.
- Permisos diferenciados por usuario sin multiplicar entornos.

## Consideraciones

- Requiere configurar la confianza (trust) entre IAS y HANA, y la administración de usuarios por parte de BASIS.
- En S/4HANA por SQL, los usuarios de base de datos por persona no reemplazan las autorizaciones ABAP.

## Criterios de aceptación

- [ ] La auditoría de HANA registra la identidad real del usuario.
- [ ] Un usuario sin permisos sobre un objeto recibe un error de autorización, aunque el objeto esté en el catálogo.
