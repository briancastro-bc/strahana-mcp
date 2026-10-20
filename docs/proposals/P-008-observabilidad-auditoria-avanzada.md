# P-008 — Observabilidad y auditoría avanzada

> **Estado:** Propuesta · **Prioridad:** Media · **Depende de:** MVP

Ampliar el log de auditoría mínimo del MVP con trazas, métricas de producto y auditoría nativa de HANA.

## Problema

El MVP registra lo mínimo indispensable por consulta (usuario, entorno, hash del SQL, filas, duración, resultado). No hay trazas de punta a punta ni métricas de adopción o de consumo de tokens agregadas.

## Propuesta

- **OpenTelemetry**: la especificación MCP define la propagación de contexto de trazas en `_meta` (`traceparent`, `tracestate`).
- **Envío a SAP Cloud Logging** con dashboards: preguntas por día, usuarios activos, tasa de errores de validación por regla, tokens estimados por respuesta, latencia p95.
- **Política de auditoría de HANA** para el usuario técnico (coordinada con BASIS).
- Feedback del usuario (útil / no útil) asociado a cada consulta.

## Criterios de aceptación

- [ ] Una consulta se puede rastrear desde la llamada MCP hasta la sentencia en HANA.
- [ ] Dashboard de adopción y consumo disponible para el líder del activo.
- [ ] Ningún valor de fila ni credencial en trazas o métricas.
