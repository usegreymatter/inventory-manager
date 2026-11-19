import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../forecast_lab.js', import.meta.url));
const bridge = fileURLToPath(new URL('./forecast_lab_bridge.py', import.meta.url));
const methods = ['baseline', 'seasonal_naive', 'holt_damped', 'seasonal', 'croston', 'sba', 'similar'];
let comparedOperations = 0;
test.after(() => console.log(`Full-output Python/JS differential comparisons: ${comparedOperations}`));
function load() {
  assert.ok(fs.existsSync(target), 'forecast_lab.js implementation must exist');
  return createRequire(import.meta.url)(target);
}
function compare(actual, expected, path = '$') {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path);
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9,
      `${path}: ${actual} != ${expected} (absolute tolerance 1e-9)`);
  } else if (expected === null || typeof expected !== 'object') {
    assert.equal(actual, expected, path);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, `${path}.length`);
    expected.forEach((value, i) => compare(actual[i], value, `${path}[${i}]`));
  } else {
    assert.ok(actual !== null && typeof actual === 'object', path);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}.keys`);
    for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`);
  }
}
function oracle(operations) {
  const input = JSON.stringify({ operations }, (_, value) => typeof value === 'number' && !Number.isFinite(value)
    ? { __float__: Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf' } : value);
  const child = spawnSync(process.env.FORECAST_LAB_PYTHON || 'python3', [bridge], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const results = JSON.parse(child.stdout);
  assert.equal(results.length, operations.length);
  return results;
}
function call(lab, operation) {
  try {
    const args = operation.args ?? [];
    return { result: ['analyze', 'analyze_sku', 'clean_demand'].includes(operation.op)
      ? lab[operation.op](...args, operation.options ?? {}) : lab[operation.op](...args) };
  } catch (error) {
    return { error: { type: error.name, message: error.message } };
  }
}
function verify(lab, operations) {
  const expected = oracle(operations);
  for (let i = 0; i < operations.length; i++) {
    const before = JSON.stringify(operations[i]);
    compare(call(lab, operations[i]), expected[i], `operation ${i} ${operations[i].op}`);
    assert.equal(JSON.stringify(operations[i]), before, 'must not mutate inputs/options');
    comparedOperations++;
  }
}
let state = 0x5eed1234;
function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; }
function integer(n) { return Math.floor(random() * n); }
function receipts(count, offset = 0) {
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(Date.UTC(2020 + i % 5, i % 12, 1));
    const end = new Date(+start + (offset + integer(90)) * 86400000);
    return { ordered_date: start.toISOString().slice(0, 10), received_date: end.toISOString().slice(0, 10) };
  });
}

test('CommonJS contract, exact fixtures, full frozen Python output', () => {
  const lab = load();
  assert.deepEqual(Array.from(lab.METHODS), methods);
  assert.equal(lab.MAX_VALUE, 1e12);
  const operations = [];
  for (const values of [[], [1], [0, 0, 0], Array(36).fill(10), Array(36).fill(0),
    Array.from({ length: 48 }, (_, i) => i + 1), Array.from({ length: 48 }, (_, i) => [10, 20, 50, 100][i % 4])]) {
    operations.push({ op: 'analyze', args: [values], options: { horizon: 4, similar: Array(24).fill(10), scale: 1.5 } });
    for (const method of methods) operations.push({ op: 'eligible', args: [method, values, [1, 2, 3]] },
      { op: 'forecast', args: [values, 3, method, [1, 2, 3]] },
      { op: 'backtest', args: [values, method, 3, Array(30).fill(2), 1.2] });
  }
  for (const p of [0, 0.05, 0.5, 0.8, 0.95, 1]) operations.push({ op: 'quantile', args: [[7, -2, 1, 5], p] });
  operations.push({ op: 'quantile', args: [[], 0.5] }, { op: 'safety_stock', args: [[], 30] },
    { op: 'safety_stock', args: [[2, -2, 2, -2], 30, 30, 30,
      [11, 21, 31, 21, 21].map(d => ({ ordered_date: '2024-01-01', received_date: `2024-01-${d}` })), 2] });
  verify(lab, operations);
});

test('seeded differential fuzz: 180 patterns/lengths/horizons/donors/receipts', () => {
  const lab = load(), operations = [];
  const lengths = [0, 1, 2, 3, 6, 11, 12, 23, 24, 25, 36, 48, 61, 120, 1200];
  for (let i = 0; i < 180; i++) {
    const n = lengths[i % lengths.length], kind = i % 6;
    const values = Array.from({ length: n }, (_, j) => kind === 0 ? 0 : kind === 1 ? 13 :
      kind === 2 ? j * 1.125 : kind === 3 ? [10, 12, 90, 2, 8, 4, 15, 18, 10, 30, 4, 5][j % 12] :
      kind === 4 ? (random() < 0.8 ? 0 : integer(300)) : random() * 1000);
    const donor = i % 4 === 0 ? null : Array.from({ length: [2, 3, 23, 24, n + 9][i % 5] }, () => integer(400));
    const horizon = [1, 2, 3, 7, 12, 24, 120][i % 7], scale = [0, 0.5, 1, 1.5, 100][i % 5];
    const method = methods[i % methods.length];
    operations.push({ op: 'pattern', args: [values] }, { op: 'eligible', args: [method, values, donor] },
      { op: 'forecast', args: [values, horizon, method, donor, scale] },
      { op: 'backtest', args: [values, method, horizon, donor, scale] },
      { op: 'analyze', args: [values], options: { horizon, similar: donor, scale, lead_days: integer(365),
        review_days: integer(90), receipts: receipts(i % 9), service_z: random() * 4 } },
      { op: 'safety_stock', args: [Array.from({ length: i % 17 }, () => random() * 200 - 100), random() * 1000,
        integer(120), integer(90), receipts(i % 8), random() * 4] });
  }
  assert.equal(operations.length, 1080);
  verify(lab, operations);
});

test('seeded cleaning differential: 120 immutable link/transfer/stockout/outlier cases', () => {
  const lab = load(), operations = [];
  for (let i = 0; i < 120; i++) {
    const rows = [];
    for (let m = 1; m <= 8; m++) {
      const row = { sku: i % 2 ? 'A' : '__proto__', month: `2024-${String(m).padStart(2, '0')}`,
        demand: 50 + integer(150), project_qty: integer(20) };
      if (i % 5 === 0) row.in_stock_fraction = random();
      if (i % 5 === 1) Object.assign(row, { in_stock_days: integer(31), days_in_month: 31 });
      if (i % 5 === 2) row.daily_stock = [0, 1, 0, 5];
      if (i % 5 === 3) row.month_end_stock = 0;
      if (i % 7 === 0) row.backorder = true;
      if (m === 8) row.demand = 10000;
      if (i % 9 === 0) row.one_off = true;
      else row.one_off = integer(10);
      rows.unshift(row);
      rows.push({ sku: 'Z', month: row.month, demand: 20 });
    }
    const source = rows.find(row => row.sku !== 'Z').sku;
    const options = { suggest_outliers: true, supersessions: { [source]: 'B', B: 'C' },
      transfers: [{ from_sku: 'C', to_sku: 'D', month: '2024-01', quantity: i % 9 === 0 ? 0 : 5 }],
      manual_pct: { C: i % 2 ? -100 : 15, D: 1000, Z: -25 } };
    operations.push({ op: 'clean_demand', args: [rows], options });
  }
  verify(lab, operations);
});

test('invalid values/options/dates fail identically to Python', () => {
  const lab = load(), operations = [];
  for (const values of [[-1], [true], [null], ['1'], [NaN], [Infinity], [-Infinity], [1e12 + 1], null, {}, Array(1201).fill(0)]) {
    operations.push({ op: 'analyze', args: [values] }, { op: 'forecast', args: [values] });
  }
  for (const horizon of [0, 121, true, 1.5, null, '3']) operations.push({ op: 'analyze', args: [[1, 2, 3]], options: { horizon } });
  for (const options of [{ scale: -1 }, { scale: 101 }, { similar: [true] }, { lead_days: -1 },
    { review_days: 3651 }, { service_z: 5 }, { receipts: {} }, { unexpected: 1 }]) {
    operations.push({ op: 'analyze', args: [[10, 12, 13]], options });
  }
  for (const receipt of [{}, null, { ordered_date: 5, received_date: '2024-01-01' },
    { ordered_date: '2024-1-01', received_date: '2024-01-02' },
    { ordered_date: '2024-02-30', received_date: '2024-03-01' },
    { ordered_date: '2024-13-01', received_date: '2024-01-01' },
    { ordered_date: '0000-01-01', received_date: '2024-01-01' },
    { ordered_date: '2024-01-02', received_date: '2024-01-01' }]) {
    operations.push({ op: 'safety_stock', args: [[1], 30, 30, 30, [receipt]] });
  }
  const row = { sku: 'A', month: '2024-01', demand: 5 };
  for (const rows of [null, [{}], [{ ...row, month: '2024-13' }], [row, row], [{ ...row, backorder: 1 }],
    [{ ...row, daily_stock: [] }], [{ ...row, project_qty: 6 }], [{ ...row, in_stock_fraction: 2 }]]) {
    operations.push({ op: 'clean_demand', args: [rows] });
  }
  for (const options of [{ supersessions: { A: 'B', B: 'A' } }, { supersessions: { A: '' } },
    { supersessions: [1] }, { manual_pct: { A: -101 } }, { unexpected: true },
    { transfers: [{ from_sku: 'A', to_sku: 'B', month: '2024-01', quantity: 6 }] },
    { transfers: [{ from_sku: 'A', to_sku: 'A', month: '2024-01', quantity: 1 }] }]) {
    operations.push({ op: 'clean_demand', args: [[row]], options });
  }
  operations.push({ op: 'forecast', args: [[1], 1, 'bogus'] }, { op: 'backtest', args: [[1], 'bogus'] },
    { op: 'safety_stock', args: [null, 30] }, { op: 'quantile', args: [[1], 2] });
  verify(lab, operations);
  assert.throws(() => lab.analyze([], null));
  assert.throws(() => lab.clean_demand([], []));
});

test('boundary cleaning/date/quantity behavior matches frozen Python', () => {
  const lab = load(), operations = [];
  const row = { sku: 'A', month: '2024-01', demand: 1e12 };
  for (const empty of [null, false, 0, '', [], {}]) {
    operations.push({ op: 'clean_demand', args: [[row]], options: { supersessions: empty, manual_pct: empty, transfers: empty } });
  }
  for (const suggest_outliers of [[], {}]) operations.push({ op: 'clean_demand',
    args: [Array.from({ length: 7 }, (_, i) => ({ sku: 'A', month: `2024-0${i + 1}`, demand: i === 6 ? 1000 : 10 }))],
    options: { suggest_outliers } });
  operations.push({ op: 'clean_demand', args: [[
    { sku: '\uFEFF', month: '2024-01', demand: 1 },
    { sku: '\u{10000}', month: '2024-01', demand: 2 },
    { sku: '\uE000', month: '2024-01', demand: 3 }
  ]] }, { op: 'clean_demand', args: [[{ ...row, sku: '\u0085' }]] });
  operations.push({ op: 'safety_stock', args: [[1], 1, 30, 30,
    [{ ordered_date: '0000-01-01', received_date: '2024-13-01' }]] });
  const dated = [
    { ordered_date: '0001-01-01', received_date: '0001-01-31' },
    { ordered_date: '0099-12-31', received_date: '0100-01-01' },
    { ordered_date: '1900-02-28', received_date: '1900-03-01' },
    { ordered_date: '2000-02-28', received_date: '2000-03-01' },
    { ordered_date: '2024-02-29', received_date: '2024-03-01' },
    { ordered_date: '9999-12-30', received_date: '9999-12-31' }
  ];
  operations.push({ op: 'safety_stock', args: [[-100, 100, 0], 1e12, 3650, 3650, dated, 4] });
  for (const method of methods) {
    const values = Array.from({ length: 36 }, (_, i) => method === 'croston' || method === 'sba' ? (i % 4 ? 0 : 1e12) : 1e12);
    operations.push({ op: 'forecast', args: [values, 120, method, values, 100] });
  }
  verify(lab, operations);
});

test('per-SKU report preserves identity and matches Python', () => {
  const lab = load();
  assert.equal(typeof lab.analyze_sku, 'function');
  verify(lab, [
    { op: 'analyze_sku', args: ['SKU-001', Array(36).fill(10)], options: { horizon: 2 } },
    { op: 'analyze_sku', args: [' ', [10,10,10]] },
    { op: 'analyze_sku', args: ['__proto__', Array.from({length:48},(_,i)=>i+1)], options:{horizon:4} }
  ]);
});

test('browser global without require/module is standalone and matches oracle', () => {
  load();
  const context = vm.createContext({});
  assert.equal(vm.runInContext('typeof require + ":" + typeof module', context), 'undefined:undefined');
  vm.runInContext(fs.readFileSync(target, 'utf8'), context, { filename: 'forecast_lab.js' });
  const lab = context.StockRunwayForecastLab;
  assert.ok(lab);
  verify(lab, [
    { op: 'analyze', args: [Array.from({ length: 36 }, (_, i) => [1, 3, 5, 7][i % 4])], options: { horizon: 6 } },
    { op: 'clean_demand', args: [[{ sku: '__proto__', month: '2024-01', demand: 10 }]],
      options: { supersessions: { ['__proto__']: 'B' } } },
    { op: 'safety_stock', args: [[-2, 4], 30, 30, 30, receipts(6)] },
    { op: 'forecast', args: [[], 4, 'similar', Array(24).fill(12), 1.5] }
  ]);
});
