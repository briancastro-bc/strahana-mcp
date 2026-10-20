# P-011 — Generación y validación asistida del catálogo

> **Estado:** Propuesta · **Prioridad:** Media · **Depende de:** MVP

Reducir el costo de curar catálogos y detectar catálogos desactualizados.

## Problema

En el MVP el catálogo (`*.catalog.yaml`) se escribe a mano. Es el principal costo recurrente del activo y puede quedar desactualizado después de un upgrade de S/4HANA o de un despliegue de un proyecto CAP.

## Propuesta

- **Comando de extracción** (`npm run catalog:extract -- --environment QAS-FI --objects I_SUPPLIER*`): lee las vistas de sistema de HANA (`SYS.VIEWS`, `SYS.VIEW_COLUMNS`, `SYS.TABLE_COLUMNS`) y, en S/4HANA, los textos del diccionario ABAP, y genera un borrador del catálogo con tipos, longitudes y etiquetas.
- **Comando de verificación** (`npm run catalog:verify -- --environment QAS-FI`): comprueba que cada entidad y columna del catálogo existe en la base de datos y que los tipos coinciden. Se ejecuta en CI y después de cada upgrade.
- **Detección de columnas sensibles**: heurísticas por nombre y tipo (IBAN, salario, documento de identidad) que marcan candidatos para revisión.

## Criterios de aceptación

- [ ] Un consultor genera un borrador de catálogo de 20 entidades en minutos, en lugar de horas.
- [ ] `catalog:verify` detecta una columna renombrada o eliminada.
