# Spike Fase 0.1: parser SQL (`node-sql-parser`, gramática PostgreSQL)

Spike descartable. Objetivo (POV §16, Fase 0): comprobar que `node-sql-parser` 5.4.0 parsea de forma confiable el subconjunto de POV §6.2 y que todo lo no soportado falla cerrado.

Reproducir: `cd spikes/parser && pnpm install && pnpm test` (detalle por consulta: `node summary.mjs 1`).

## Resultados

- Permitidas aceptadas: 62/62. Prohibidas rechazadas: 102/102. Prohibidas que se colaron: 0.
- Lagunas HANA conocidas: 8/8 rechazadas (falla cerrada). `node --test`: 175 pruebas en verde.
- Solo con el parser (sin prevalidación ni recorrido del AST): acepta 62/62 permitidas y 72/102 prohibidas. El parser no es una barrera; la seguridad la dan la prevalidación de texto y la lista blanca sobre el AST. Las otras 30 las rechaza el parser por sintaxis (TOP, FOR UPDATE, FETCH FIRST, MERGE, EXPLAIN, `?`).
- Salvedad: el corpus se escribió conociendo el validador. 102/102 demuestra cobertura de las clases de §6.2, no ausencia de bypasses. Se recomienda fuzzing en la Fase 1.

## Permitidas que el parser no procesó

Ninguna en el corpus principal. El sondeo adicional (`corpus/hana-gaps.json`) halló:

- `CAST(x AS NVARCHAR(10))`: tipo desconocido para la gramática PostgreSQL. Relevante: es muy común en HANA.
- `SECONDDATE`, `DAYDATE`, `SMALLDECIMAL`, `NCLOB`: tipos HANA no reconocidos.
- `SUBSTRING(x FROM 1 FOR 3)`: falla (la forma con comas funciona).
- `1.5E3`: nodo `bigint` no reconocido; el validador lo rechaza.
- `TO_VARCHAR`, `LOCATE`: faltan en la lista blanca del prototipo (política, no parser).

Todas se rechazan (falla cerrada), pero son falsos negativos para el LLM.

## Prohibidas que se colaron

Ninguna en el corpus final. Durante el desarrollo:

- `(SELECT a FROM T)` en nivel superior: corregido rechazando `parentheses_symbol`, porque el servidor agrega `LIMIT`/`OFFSET` al texto original.
- `a::int`: sintaxis PostgreSQL inexistente en HANA; ahora se exige `CAST(x AS tipo)`.

## Hallazgos para la Fase 1

1. La gramática PostgreSQL acepta construcciones que HANA no tiene (`::`, `->>`, `~`, `ARRAY`, `$$`); se rechazan por lista blanca de operadores y nodos.
2. Particularidades del AST: `NOT (cond)` sale como función `NOT`; `NOT EXISTS` como unario; `EXISTS` como función; las subconsultas de `IN` vienen envueltas en `expr_list`/`ast`; las subconsultas escalares son `{ast}` sin `type`; `COUNT(*)` usa un nodo `star`; `CROSS`/`NATURAL`/`USING` se detectan por la falta de `ON`.
3. Se ejecuta el texto original: se rechazan `;`, `--`, `/*`, `\`, caracteres no ASCII y de control fuera de literales, y comillas sin cerrar. Costo: se rechaza un `;` final, por lo que hace falta un mensaje de error accionable.
4. Los límites de 4 tablas y 2 niveles de subconsulta están verificados; el conteo de tablas es global, a confirmar con §6.3 regla 7.
5. Fuera de alcance del spike: resolución de columnas, filtro de mandante, pertenencia al `context_id`, `SET TRANSACTION READ ONLY` y `M_*`/`DUMMY` (dependen del catálogo). El validador ya recolecta `{tables, columns}`.

## Recomendación

Aprobar el spike. El criterio de salida se cumple (62/62 permitidas, 0/102 colaradas). Mantener pruebas negativas exhaustivas y agregar fuzzing en la Fase 1. Registrar las lagunas de tipos (NVARCHAR) como limitaciones conocidas; si bloquean al piloto, evaluar la gramática PEG propia (plan B) solo para ese caso.
