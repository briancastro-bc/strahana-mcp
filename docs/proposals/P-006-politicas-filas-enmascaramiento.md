# P-006 — Políticas de filas y enmascaramiento de columnas

> **Estado:** Propuesta · **Prioridad:** Alta (antes de usar entornos productivos) · **Depende de:** MVP

Restringir **qué filas** puede ver cada entorno o grupo, y enmascarar columnas en lugar de solo excluirlas.

## Problema

Por SQL no se aplican las autorizaciones ABAP. En el MVP, el control es a nivel de objeto y columna: solo se consulta lo que está en el catálogo. No hay restricción por valores (por ejemplo, una sociedad o un centro).

## Propuesta

- El entorno declara políticas de filas:

  ```yaml
  rowPolicies:
    - entity: I_SUPPLIERINVOICEAPI01
      column: COMPANYCODE
      in: ["1000", "1100"]
      groups: [STRAHANA_FI_ES]    # opcional: política por grupo de IAS
  ```

- El validador exige que la consulta incluya el predicado correspondiente (mismo mecanismo que el filtro de mandante del MVP) o lo rechaza con un mensaje que indica cómo corregirlo.
- Columnas con `mask: partial` (por ejemplo, IBAN `ES12 **** **** 1234`) se devuelven enmascaradas por el formateador de resultados.

## Consideraciones

- Exigir predicados (en lugar de reescribir el SQL) mantiene el SQL ejecutado idéntico al validado y es más simple de auditar.
- Alternativa más fuerte: análisis de privilegios o *analytic privileges* de HANA sobre el usuario técnico (requiere BASIS).

## Criterios de aceptación

- [ ] Una consulta sin el predicado exigido se rechaza con un mensaje accionable.
- [ ] Las columnas enmascaradas nunca salen completas, ni siquiera en agregaciones (`MIN`/`MAX`).
