# P-005 — Búsqueda semántica del catálogo con embeddings

> **Estado:** Propuesta · **Prioridad:** Baja · **Depende de:** catálogos con más de ~100 entidades o múltiples dominios

Reemplazar o complementar la búsqueda léxica del MVP con búsqueda vectorial.

## Problema

El MVP recupera el contexto con búsqueda léxica (etiquetas, sinónimos y descripciones del catálogo). Funciona bien con catálogos chicos y bien curados, pero degrada cuando:

- El catálogo crece a varios dominios y cientos de entidades.
- Los usuarios usan términos que no están en los sinónimos.

## Propuesta

- Generar embeddings de cada entidad y columna (etiqueta + descripción + sinónimos) al cargar el catálogo.
- Almacenarlos en **SAP HANA Cloud Vector Engine** o en memoria si el volumen lo permite.
- Recuperación híbrida: léxica + vectorial, con fusión de rankings.
- Modelo de embeddings vía SAP Generative AI Hub.

## Consideraciones

- Agrega dependencia de un servicio de IA incluso sin [P-001](P-001-llm-intermedio-servidor.md).
- Los embeddings se recalculan solo cuando cambia la versión del catálogo.

## Criterios de aceptación

- [ ] Mejora medible del recall de entidades relevantes en el conjunto de evaluación ([P-009](P-009-evaluacion-continua.md)).
- [ ] Sin aumento de los tokens devueltos por `hana_context`.
