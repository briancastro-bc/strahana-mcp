import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_CELL_CHARS,
  ResponseTooSmallError,
  escapeCell,
  formatResult,
  type ResultTable,
} from '../../../../src/hana/query/domain/result-formatter.js';

const base = { offset: 0, limit: 10, maxResponseBytes: 16384 };

test('TSV with a status line, a header and one line per row', () => {
  const table: ResultTable = {
    columns: ['NAME', 'ORDERS', 'TOTAL'],
    rows: [
      ['Acme S.A.', 42, '125000.00'],
      ['Iberia Parts', 31, '98210.50'],
    ],
  };
  const result = formatResult(table, base);
  assert.equal(
    result.text,
    [
      'rows=2 more=no',
      'NAME\tORDERS\tTOTAL',
      'Acme S.A.\t42\t125000.00',
      'Iberia Parts\t31\t98210.50',
    ].join('\n'),
  );
  assert.equal(result.rows, 2);
  assert.equal(result.more, false);
  assert.equal(result.bytes, Buffer.byteLength(result.text));
});

test('one extra row means there is a next page; it is not shown', () => {
  const rows = Array.from({ length: 4 }, (_, i) => [`r${i}`]);
  const result = formatResult({ columns: ['A'], rows }, { ...base, limit: 3, offset: 20 });
  assert.equal(result.text.split('\n')[0], 'rows=3 more=yes next_offset=23');
  assert.equal(result.more, true);
  assert.ok(!result.text.includes('r3'));
});

test('no total count, no notes line when the server applied nothing', () => {
  const result = formatResult({ columns: ['A'], rows: [['x']] }, base);
  assert.ok(!result.text.includes('notes:'));
  assert.ok(!/total/i.test(result.text));
});

test('NULL is an empty cell; values are rendered without locale', () => {
  const result = formatResult(
    {
      columns: ['A', 'B', 'C', 'D', 'E'],
      rows: [
        [null, true, 12n, new Date('2024-05-06T07:08:09.000Z'), Buffer.from([1, 255])],
        ['x', false, 0, null, null],
      ],
    },
    base,
  );
  assert.equal(result.text.split('\n')[2], '\ttrue\t12\t2024-05-06T07:08:09.000Z\t0x01ff');
});

test('tabs, line breaks and backslashes inside values are escaped (one row, one line)', () => {
  assert.equal(escapeCell('a\tb\nc\r\\d'), 'a\\tb\\nc\\r\\\\d');
  const result = formatResult({ columns: ['A\tB'], rows: [['x\ty\nz']] }, base);
  const lines = result.text.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], 'A\\tB');
  assert.equal(lines[2], 'x\\ty\\nz');
});

test('long texts are cut with an ellipsis and reported once per column', () => {
  const long = 'x'.repeat(MAX_CELL_CHARS + 30);
  const result = formatResult(
    {
      columns: ['NAME', 'CODE'],
      rows: [
        [long, 'a'],
        [long, 'b'],
        ['short', 'c'],
      ],
    },
    base,
  );
  const lines = result.text.split('\n');
  assert.equal(lines[2], `${'x'.repeat(MAX_CELL_CHARS)}…\ta`);
  assert.equal(lines[4], 'short\tc');
  assert.equal(lines.at(-1), 'notes: NAME truncated to 120 chars in 2 rows');
  const single = formatResult({ columns: ['NAME'], rows: [[long]] }, base);
  assert.match(single.text, /in 1 row$/);
});

test('truncation never splits a surrogate pair', () => {
  const text = 'a'.repeat(MAX_CELL_CHARS - 1) + '😀' + 'tail';
  const cell = formatResult({ columns: ['A'], rows: [[text]] }, base).text.split('\n')[2] ?? '';
  assert.ok(cell.endsWith('…'));
  assert.ok(!/[\ud800-\udbff]…$/.test(cell));
});

test('columns that are empty in the whole page are omitted and reported', () => {
  const result = formatResult(
    {
      columns: ['A', 'B', 'C'],
      rows: [
        ['1', null, ''],
        ['2', null, null],
      ],
    },
    base,
  );
  assert.deepEqual(result.text.split('\n'), [
    'rows=2 more=no',
    'A',
    '1',
    '2',
    'notes: empty columns omitted: B, C',
  ]);
});

test('when every column is empty the page keeps its shape', () => {
  const result = formatResult({ columns: ['A', 'B'], rows: [[null, null]] }, base);
  assert.deepEqual(result.text.split('\n'), ['rows=1 more=no', 'A\tB', '\t']);
});

test('an empty result is just the status line and the header', () => {
  const result = formatResult({ columns: ['A', 'B'], rows: [] }, base);
  assert.deepEqual(result.text.split('\n'), ['rows=0 more=no', 'A\tB']);
});

test('extra notes from the caller are appended after the server notes', () => {
  const result = formatResult(
    { columns: ['A'], rows: [['x']] },
    { ...base, extraNotes: ['no ORDER BY'] },
  );
  assert.equal(result.text.split('\n').at(-1), 'notes: no ORDER BY');
});

test('maxResponseBytes is a hard ceiling: rows are dropped and more=yes points at the next one', () => {
  const rows = Array.from({ length: 200 }, (_, i) => [`row-number-${i}`, 'x'.repeat(50)]);
  const result = formatResult(
    { columns: ['A', 'B'], rows },
    { ...base, limit: 200, offset: 5, maxResponseBytes: 2048 },
  );
  assert.ok(result.bytes <= 2048, `bytes=${result.bytes}`);
  assert.equal(result.bytes, Buffer.byteLength(result.text));
  assert.ok(result.rows > 0 && result.rows < 200);
  assert.equal(result.more, true);
  const lines = result.text.split('\n');
  assert.equal(lines[0], `rows=${result.rows} more=yes next_offset=${5 + result.rows}`);
  assert.equal(lines.at(-1)?.startsWith('notes: response capped at 2048 bytes'), true);
  assert.equal(lines.length, result.rows + 3);
});

test('multi-byte text is measured in bytes, not characters', () => {
  const rows = Array.from({ length: 50 }, () => ['日本語日本語日本語日本語']);
  const result = formatResult(
    { columns: ['A'], rows },
    { ...base, limit: 50, maxResponseBytes: 1100 },
  );
  assert.ok(result.bytes <= 1100);
  assert.ok(result.rows < 50);
});

test('a single row that cannot fit is an error with the fix (no empty page loop)', () => {
  const table: ResultTable = { columns: ['A'], rows: [['x'.repeat(100)]] };
  assert.throws(
    () => formatResult(table, { ...base, maxResponseBytes: 64 }),
    (error: unknown) => error instanceof ResponseTooSmallError && error.maxResponseBytes === 64,
  );
});
