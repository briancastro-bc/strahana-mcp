# P-009 — Evaluación continua de precisión

> **Estado:** Propuesta · **Prioridad:** Alta (prerequisito de [P-001](P-001-llm-intermedio-servidor.md)) · **Depende de:** MVP

Medir de forma repetible si STRAHANA responde correctamente, y detectar regresiones al cambiar el catálogo, las reglas o los modelos.

## Problema

En el MVP la precisión depende del LLM de cada usuario y de la calidad del catálogo. Sin un conjunto de referencia, no hay forma objetiva de saber si un cambio en el catálogo mejora o empeora las respuestas.

## Propuesta

- Carpeta `eval/` con preguntas de referencia por dominio (objetivo inicial: 50), cada una con el resultado esperado contra un dataset sintético.
- Runner `npm run eval` que mide:
  - **Recall del contexto:** ¿`hana_context` devolvió las entidades y columnas necesarias?
  - **Precisión de la respuesta:** con un LLM de referencia generando el SQL.
  - **Tokens:** tamaño del contexto y de la respuesta.
- Ejecución obligatoria en CI ante cambios de catálogo, reglas de validación o formato de respuesta.

## Criterios de aceptación

- [ ] Reporte por ejecución: recall, precisión, tokens y latencia, comparado con la ejecución anterior.
- [ ] CI falla si el recall del contexto cae por debajo del umbral acordado.
