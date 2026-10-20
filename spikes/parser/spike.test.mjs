import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSubset } from './validate-subset.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`./corpus/${f}`, import.meta.url), 'utf8'));
const allowed = load('allowed.json');
const forbidden = load('forbidden.json');

test('allowed corpus is accepted', async (t) => {
  for (const sql of allowed) {
    await t.test(sql.slice(0, 90), () => {
      const r = validateSubset(sql);
      assert.equal(r.ok, true, `rejected: ${r.reason}`);
      assert.ok(r.tables.length > 0);
    });
  }
});

test('forbidden corpus is rejected (fail closed)', async (t) => {
  for (const { sql, label } of forbidden) {
    await t.test(label, () => {
      const r = validateSubset(sql);
      assert.equal(r.ok, false, `SLIPPED THROUGH: ${JSON.stringify(sql)}`);
      assert.ok(r.reason);
    });
  }
});

// Valid HANA SQL that the prototype does not support. They must stay rejected (fail closed);
// the spike report lists them as dialect gaps.
const gaps = load('hana-gaps.json');
test('known HANA dialect gaps stay rejected (fail closed)', async (t) => {
  for (const { sql, gap } of gaps) {
    await t.test(gap, () => {
      assert.equal(validateSubset(sql).ok, false);
    });
  }
});
