import { z } from 'zod';
import { COLUMN_TYPES } from '../domain/catalog.js';

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Catalog entries must never expose system objects (POV 6.2). */
const SYSTEM_OBJECT_PATTERN = /^(SYS|_?SYS_.*)$/i;
const MAX_LABEL_WORDS = 4;

const nameSchema = z.string().regex(NAME_PATTERN, {
  message: 'must be a plain identifier (letters, digits, underscore; no schema prefix)',
});

const labelSchema = z
  .string()
  .trim()
  .min(1)
  .refine((label) => label.split(/\s+/).length <= MAX_LABEL_WORDS, {
    message: `label must have at most ${MAX_LABEL_WORDS} words`,
  });

const synonymsSchema = z.array(z.string().trim().min(1)).default([]);

const columnSchema = z
  .strictObject({
    name: nameSchema,
    type: z.enum(COLUMN_TYPES),
    length: z.number().int().min(1).optional(),
    precision: z.number().int().min(1).max(38).optional(),
    scale: z.number().int().min(0).optional(),
    key: z.boolean().default(false),
    label: labelSchema,
    synonyms: synonymsSchema,
  })
  .superRefine((column, ctx) => {
    const flag = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (column.type !== 'string' && column.length !== undefined) {
      flag('length', 'length only applies to type string');
    }
    if (column.type === 'decimal') {
      if (column.precision === undefined) flag('precision', 'decimal requires precision');
      else if ((column.scale ?? 0) > column.precision) flag('scale', 'scale exceeds precision');
    } else {
      if (column.precision !== undefined) flag('precision', 'precision only applies to decimal');
      if (column.scale !== undefined) flag('scale', 'scale only applies to decimal');
    }
  });

const joinSchema = z.strictObject({
  entity: nameSchema,
  /** `{ LOCAL_COLUMN: TARGET_COLUMN }` */
  on: z.record(nameSchema, nameSchema).refine((on) => Object.keys(on).length > 0, {
    message: 'at least one column pair is required',
  }),
});

const entitySchema = z.strictObject({
  name: nameSchema.refine((name) => !SYSTEM_OBJECT_PATTERN.test(name), {
    message: 'system objects cannot be part of a catalog',
  }),
  label: labelSchema,
  synonyms: synonymsSchema,
  columns: z.array(columnSchema).min(1),
  joins: z.array(joinSchema).default([]),
  rules: z.array(z.string().trim().min(1).max(120)).max(3).default([]),
});

/** `catalog/<domain>.catalog.yaml` (POV 5.2). The JSON Schema for editors is generated from it. */
export const catalogFileSchema = z
  .strictObject({
    $schema: z.string().optional(),
    domain: z.string().regex(/^[a-z][a-z0-9_-]*$/, { message: 'use lowercase letters and digits' }),
    version: z.number().int().min(1),
    label: labelSchema,
    entities: z.array(entitySchema).min(1),
  })
  .superRefine((catalog, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const byName = new Map<string, Set<string>>();
    catalog.entities.forEach((entity, index) => {
      if (byName.has(entity.name)) issue(['entities', index, 'name'], 'duplicated entity name');
      const columns = new Set<string>();
      entity.columns.forEach((column, columnIndex) => {
        if (columns.has(column.name)) {
          issue(['entities', index, 'columns', columnIndex, 'name'], 'duplicated column name');
        }
        columns.add(column.name);
      });
      byName.set(entity.name, columns);
    });
    catalog.entities.forEach((entity, index) => {
      entity.joins.forEach((join, joinIndex) => {
        const base = ['entities', index, 'joins', joinIndex];
        const target = byName.get(join.entity);
        const local = byName.get(entity.name);
        if (target === undefined) {
          issue([...base, 'entity'], 'join target is not an entity of this catalog');
          return;
        }
        for (const [from, to] of Object.entries(join.on)) {
          if (local?.has(from) !== true)
            issue([...base, 'on', from], 'unknown column in this entity');
          if (!target.has(to)) issue([...base, 'on', from], 'unknown column in the join target');
        }
      });
    });
  });

export type CatalogFile = z.infer<typeof catalogFileSchema>;

/** JSON Schema for the YAML language server (`schemas/catalog.schema.json`). */
export function catalogJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(catalogFileSchema, { io: 'input' });
}
