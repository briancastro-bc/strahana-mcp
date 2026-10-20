// Prints per-query outcomes for the report (not part of the test run).
import { readFileSync } from 'node:fs';
import { validateSubset } from './validate-subset.mjs';
const a = JSON.parse(readFileSync('corpus/allowed.json', 'utf8'));
const f = JSON.parse(readFileSync('corpus/forbidden.json', 'utf8'));
let ap = 0, fr = 0;
for (const s of a) { const r = validateSubset(s); if (r.ok) ap++; else console.log('ALLOWED-REJECTED', s, '=>', r.reason); }
for (const { sql, label } of f) { const r = validateSubset(sql); if (!r.ok) fr++; else console.log('SLIPPED', label, JSON.stringify(sql)); if (process.argv[2]) console.log('  ', label, '=>', r.reason); }
console.log(`allowed accepted ${ap}/${a.length}; forbidden rejected ${fr}/${f.length}`);

// Parser-only view (no text pre-check, no AST walk): how much does node-sql-parser alone accept?
import sqlParser from 'node-sql-parser';
const parser = new sqlParser.Parser();
const parses = (sql) => { try { parser.astify(sql, { database: 'postgresql' }); return true; } catch { return false; } };
const aParse = a.filter(parses).length;
const fParse = f.filter(({ sql }) => parses(sql));
console.log(`parser-only: allowed parsed ${aParse}/${a.length}; forbidden parsed (needs validator) ${fParse.length}/${f.length}`);
if (process.argv[2]) for (const x of fParse) console.log('  parser accepts:', x.label);
