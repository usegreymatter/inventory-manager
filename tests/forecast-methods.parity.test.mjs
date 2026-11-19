import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const fm = require('../forecast_methods.js');
const cwd = fileURLToPath(new URL('..', import.meta.url));

// Seeded synthetic fixtures only; no holdout inputs or benchmark tuning.
function fixtures() {
  let seed = 0x51a7c0de;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const cases = [[], [0], [10], Array(12).fill(0), Array(1200).fill(1e12),
    Array.from({length: 1200}, (_, i) => i % 2 ? 1e12 : 0),
    Array(12).fill(1e-300).concat(Array(12).fill(1e12)),
    [Number.MIN_VALUE, 1e12], [Number.MIN_VALUE],
    Array.from({length: 36}, (_, i) => [10, 20, 5, 10, 50, 10, 30, 5, 20, 10, 60, 5][i % 12]),
    Array.from({length: 24}, (_, i) => i % 2 ? 17 : 3)];
  const lengths = [0, 1, 2, 3, 6, 11, 12, 13, 23, 24, 25, 35, 36, 48, 60, 120];
  for (let c = 0; c < 800; c++) {
    const n = lengths[c % lengths.length], kind = Math.floor(c / lengths.length) % 12;
    const scale = [1, .001, 1000, 1e9][c % 4];
    const pattern = Array.from({length: 12}, () => 1 + Math.floor(random() * 20));
    const ys = Array.from({length: n}, (_, i) => {
      const r = random();
      const v = [
        0, 10, 1 + r * 20, i + 1, Math.max(0, n - i),
        r < .75 ? 0 : 10, r < .65 ? 0 : 1 + r * 100,
        pattern[i % 12], pattern[i % 12] * (1 + i / 100),
        i >= n - 3 ? 0 : 10, i === Math.floor(n / 2) ? 100 : 1,
        i < n / 2 ? 10 : 30,
      ][kind];
      return v * scale * (1 + c / 10000);
    });
    cases.push(ys);
  }
  return cases.map((values, i) => ({values, horizon: [1, 3, 12, 24, 120][i % 5]}));
}

const CASES = fixtures();
const bridge = `import json,sys
import forecast_methods as fm
rows=json.load(sys.stdin)
print(json.dumps(dict(methods=fm.METHODS, labels=fm.METHOD_LABELS, presets=fm.PRESETS,
    rows=[dict(classification=fm.classify(r['values']), forecasts={m:fm.forecast(r['values'],r['horizon'],m) for m in fm.METHODS}) for r in rows]), allow_nan=False))
`;

test('exact Python/JavaScript parity: >=500 distinct histories, all 16 methods and classifier', () => {
  assert.ok(CASES.length >= 500);
  const distinct = new Set(CASES.map(row => JSON.stringify(row.values))).size;
  assert.ok(distinct >= 500, `Only ${distinct} distinct histories`);
  const result = spawnSync('/usr/bin/python3', ['-c', bridge], {
    cwd, input: JSON.stringify(CASES), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    timeout: 120000, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
  });
  assert.equal(result.status, 0, result.stderr);
  const reference = JSON.parse(result.stdout);
  assert.deepEqual(fm.METHODS, reference.methods);
  assert.deepEqual(fm.METHOD_LABELS, reference.labels);
  assert.deepEqual(fm.PRESETS, reference.presets);
  assert.equal(reference.rows.length, CASES.length);
  let forecasts = 0, points = 0;
  CASES.forEach(({values, horizon}, i) => {
    assert.deepEqual(fm.classify(values), reference.rows[i].classification, `classification case ${i}`);
    for (const method of fm.METHODS) {
      const actual = fm.forecast(values, horizon, method);
      assert.deepEqual(actual, reference.rows[i].forecasts[method], `${method} case ${i}`);
      assert.equal(actual.length, horizon);
      assert.ok(actual.every(v => Number.isFinite(v) && v >= 0 && v <= 1e12));
      forecasts++; points += actual.length;
    }
  });
  console.log(JSON.stringify({synthetic_series: CASES.length, distinct_series: distinct, classifier_checks: CASES.length,
    methods: fm.METHODS.length, forecast_vectors: forecasts, forecast_points: points, equality: 'exact (9-decimal public outputs)'}));
});

test('validation rejects bad values, sparse arrays, methods and horizons', () => {
  for (const values of [null, {}, '123', [true], [false], [null], ['2'], [-1], [NaN], [Infinity], [1e12 + 1], Array(1201).fill(0), Array(2)]) {
    assert.throws(() => fm.forecast(values), RangeError);
    assert.throws(() => fm.classify(values), RangeError);
  }
  for (const horizon of [0, -1, 121, true, 1.5, '12', null, NaN]) assert.throws(() => fm.forecast([], horizon));
  for (const method of ['current', 'SES', '__proto__', '', null, [], {}]) assert.throws(() => fm.forecast([], 12, method));
});

test('deterministic, immutable inputs and browser global exports', () => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(new URL('../forecast_methods.js', import.meta.url), 'utf8'), sandbox);
  const browser = sandbox.StockRunwayForecastMethods;
  assert.equal(typeof browser.forecast, 'function');
  for (const values of CASES.slice(0, 60).map(row => Object.freeze(row.values.slice()))) {
    for (const method of fm.METHODS) {
      assert.deepEqual(fm.forecast(values, 12, method), fm.forecast(values, 12, method));
      assert.equal(JSON.stringify(browser.forecast(values, 12, method)), JSON.stringify(fm.forecast(values, 12, method)));
    }
    assert.equal(JSON.stringify(browser.classify(values)), JSON.stringify(fm.classify(values)));
  }
  assert.ok(Object.isFrozen(fm.METHODS));
  assert.ok(Object.isFrozen(fm.PRESETS.pharmacy));
});

test('auto delegates exactly to the disclosed fixed classifier selection', () => {
  for (const {values} of CASES) {
    const selected = fm.classify(values).method;
    assert.ok(fm.METHODS.includes(selected) && selected !== 'auto');
    assert.deepEqual(fm.forecast(values, 12, 'auto'), fm.forecast(values, 12, selected));
  }
});
