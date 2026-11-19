import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';

// Execute the actual browser sources with no shim forecast implementation.
vm.runInThisContext(fs.readFileSync(new URL('../forecast_lab.js', import.meta.url), 'utf8'));
vm.runInThisContext(fs.readFileSync(new URL('../standalone/design/risk.js', import.meta.url), 'utf8'));
const {predictionBands, simulateRisk} = globalThis.StockRunwayRisk;
const lab = globalThis.StockRunwayForecastLab;
const core = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8');
const embedded = vm.createContext({TextEncoder,TextDecoder,atob,btoa});
vm.runInContext(core.slice(core.indexOf('const SAMPLE ='),core.indexOf('const pageStyle =')).replaceAll('export ',''),embedded);
vm.runInContext(fs.readFileSync(new URL('../standalone/design/risk.js', import.meta.url),'utf8'),embedded);
assert.equal(embedded.StockRunwayForecastLab, undefined, 'Exercise lexical STOCKOUT_LAB, not global fallback');
const plain = value => JSON.parse(JSON.stringify(value));
const base = {sku:'PARITY', as_of:'2026-10', today:'2026-11-01', order_by:'2026-11-01',
  history:Array(24).fill(30), forecast:[30,31,31,28,31,30], on_hand:0, on_order:0,
  lead_days:10, cover_months:1, quantity:31, lead_multipliers:[1]};
const cases = [];
let state = 0x5eed1234;
function next(n) {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state%n;}
const methods = ['flat','baseline','holt_damped','seasonal','seasonal_naive','croston','sba','calendar_seasonal'];
for (let i = 0; i < 360; i++) {
  const length = [0,1,3,7,8,10,11,12,24,36,63,120][i%12],
    method = methods[i%methods.length], scale = [1e-6,1,100,1e9][i%4];
  const history = Array.from({length}, (_, j) => i%5 === 0 ? 0 : i%5 === 1 ? 10*scale :
    i%5 === 2 ? (j%4 === 0 ? next(400)*scale : 0) : (next(400)+.125)*scale);
  const predictions = Array.from({length:i%13}, () => (next(100)+.123456789)*scale);
  cases.push({name:`bands-${i}-${method}`, api:'bands', args:[history,predictions,method,i%3 === 0 ? '2028-01' : '2026-10']});
  const s = {...base, sku:`SKU-${i}-المخزن-😀\u200c`, history,
    forecast:Array.from({length:1+i%12}, () => next(800)/8),
    on_hand:[0,-1,.125,20,100,1e12][i%6], on_order:next(1000)/8,
    lead_days:[0,.5,7,29,60,365][i%6], cover_months:[0,.125,1,2,6,12][i%6],
    quantity:next(4000)/8, order_by:i%3 ? '2026-11-20' : '2026-10-01',
    lead_multipliers:i%2 ? [.9,1,1,1.1,1.25,1.5] : [0, .5, 2]};
  if (i%5 === 0) delete s.lead_multipliers;
  if (i%13 === 0) s.receipt_history = Array.from({length:7},()=>({ordered_on:null,received_on:null,ordered_date:'2026-09-01',received_date:'2026-09-05'}));
  else if (i%5 === 0) s.receipt_history = Array.from({length:i%11},(_,k)=>({ordered_date:'2026-09-01',received_date:`2026-09-${String(2+k*2).padStart(2,'0')}`}));
  if (i%3 === 0) s.receipts = [];
  if (i%3 === 1) s.receipts = [{date:'2026-10-31',quantity:100000},
    {date:'2026-11-01',quantity:next(100)/8},{date:'2026-12-15',quantity:next(1000)/8},
    {date:'2026-12-15',quantity:next(1000)/8},{date:'2027-03-01',quantity:next(1000)/8}];
  if (i%7 === 0) Object.assign(s, {as_of:'2028-01', today:'2028-02-17', order_by:'2028-02-20'});
  cases.push({name:`simulation-${i}`, api:'risk', args:[s,[0,.5,1,1.5,2][i%5]]});
}
for(let i=0;i<40;i++) cases.push({name:`adopted-errors-${i}`,api:'bands',args:[[1,2,3],[20,40,60],'external','2026-10',Array.from({length:i},()=>next(40))]});
for (let i=0; i<60; i++) {
  const history = Array.from({length:3+i*2},(_,j) => i%3 === 0 ? (j%12+1)*10 : i%3 === 1 ? next(200)/8 : j+1);
  cases.push({name:`champion-${i}`,api:'bands',args:[history,[20.125,40,60],'champion','2026-10']});
}
for (const [field, value] of [['forecast',[]],['today','2026-02-30'],['today','2026-10-31'],
  ['order_by','2026-11-31'],['as_of','2026-13'],['quantity',true],['cover_months',-1],
  ['receipts',null],['lead_multipliers',[]],['lead_multipliers',[11]],['history',[null]],
  ['sku',''],['on_hand','3'],['forecast',Array(121).fill(1)]]) {
  cases.push({name:`invalid-${field}-${JSON.stringify(value).slice(0,20)}`,api:'risk',args:[{...base,[field]:value}]});
}
for (const args of [[[1],[1],'unknown'],[[1],[1],'similar'],[[true],[1]],[[1],[-1]],
  [[1],[1],'flat','2026-13'],[[1],null]]) cases.push({name:`invalid-bands-${cases.length}`,api:'bands',args});
const oracle = spawnSync('/usr/bin/python3', [new URL('./risk_bridge.py',import.meta.url).pathname],
  {input:JSON.stringify(cases),encoding:'utf8',maxBuffer:16*1024*1024});
assert.equal(oracle.status, 0, oracle.stderr);
const expected = JSON.parse(oracle.stdout);
assert.equal(expected.length, cases.length);
assert.equal(cases.filter(c => c.name.startsWith('bands-')).length,360);
assert.equal(cases.filter(c => c.name.startsWith('simulation-')).length,360);
for (const [i,c] of cases.entries()) test(`exact risk parity: ${c.name}`, () => {
  let actual;
  try {
    actual = c.name.startsWith('champion-') ? plain(embedded.StockRunwayRisk.predictionBands(...c.args))
      : c.api === 'bands' ? predictionBands(...c.args) : simulateRisk(...c.args);
  } catch {actual = {error:'invalid-input'};}
  assert.deepEqual(actual,expected[i]);
  let fromCore;
  try {fromCore = plain(c.api === 'bands' ? embedded.StockRunwayRisk.predictionBands(...c.args) : embedded.StockRunwayRisk.simulateRisk(...c.args));}
  catch {fromCore = {error:'invalid-input'};}
  assert.deepEqual(fromCore,expected[i], 'Embedded-core dependency path');
});

test('browser API is only additive and deterministic, forecasts preserved', () => {
  const ps = [1.234567890123,40,100], ys = Array(24).fill(30), snapshot = JSON.stringify({ys,ps,base});
  assert.deepEqual(Object.keys(globalThis.StockRunwayRisk).sort(), ['predictionBands','simulateRisk']);
  assert.deepEqual(predictionBands(ys,ps).bands.map(b => b.p50), ps);
  assert.deepEqual(simulateRisk(base),simulateRisk(base));
  assert.equal(JSON.stringify({ys,ps,base}),snapshot);
  assert.deepEqual(lab.forecast(ys,3),[30,30,30]);
});
test('order multipliers use paired paths, no prior shortage debt after arrival', () => {
  assert.equal(simulateRisk(base).before,1);
  assert.equal(simulateRisk(base).after,0);
  assert.equal(simulateRisk(base,0).after,1);
  const s = {...base, history:[0,20,80,0,5,60,0,90,0],quantity:40};
  const runs = [0,.5,1,2,10].map(mult => simulateRisk(s,mult));
  assert.equal(new Set(runs.map(r => r.seed)).size,1);
  assert.equal(new Set(runs.map(r => r.before)).size,1);
  assert.deepEqual(runs.map(r => r.after),runs.map(r => r.after).sort((a,b) => b-a));
});
test('documented PRNG and Unicode seed vectors match the Python vectors', () => {
  // Instrument only a private test VM; do not expand the production API.
  const source = fs.readFileSync(new URL('../standalone/design/risk.js', import.meta.url), 'utf8');
  const probe = vm.createContext({});
  vm.runInContext(source.replace('root.StockRunwayRisk = Object.freeze({predictionBands, simulateRisk});',
    'root.probe = {seedFor, next};'), probe);
  let s = 1;
  const sequence = Array.from({length:5}, () => {s = probe.probe.next(s); return s;});
  assert.deepEqual(sequence,[270369,67634689,2647435461,307599695,2398689233]);
  assert.equal(probe.probe.seedFor('PARITY','2026-10'),35072368);
  assert.equal(probe.probe.seedFor('المخزن-😀','2026-10'),1280585968);
});
test('length-three blocks preserve their total and scale to current mean', () => {
  for (const mean of [30,60]) {
    const s = {...base,as_of:'2028-01',today:'2028-02-01',order_by:'2028-02-01',history:[0,0,90],forecast:[mean,mean,mean],lead_days:0,cover_months:3,quantity:3*mean};
    assert.equal(simulateRisk(s).after,0);
    assert.equal(simulateRisk({...s,quantity:s.quantity-.01}).after,1);
  }
});
test('nonfinite and malformed numeric inputs rejected without coercion', () => {
  for (const value of [NaN,Infinity,-Infinity,'3',true,null]) {
    assert.throws(() => simulateRisk({...base,quantity:value}));
    assert.throws(() => predictionBands([value],[30]));
  }
});
test('1000-SKU / 1000-path browser-source scenario benchmark below 1.5s', () => {
  // Warm compiled source, then 1000 distinct SKUs; no result cache or random().
  const s = {...base,history:[0,20,80,0,5,60,0,90,0,10,40,30],forecast:Array(12).fill(30),
    lead_multipliers:[.9,1,1,1.1,1.25,1.5],cover_months:2,quantity:70};
  for (let i=0; i<20; i++) simulateRisk({...s,sku:`warm-${i}`});
  const start = performance.now();
  let count = 0;
  for (let i=0; i<1000; i++) count += simulateRisk({...s,sku:`bench-${i}`}).paths;
  const elapsed = performance.now()-start;
  console.log(`1000 SKUs, ${count} paths: ${elapsed.toFixed(1)}ms (Node browser-source proxy, not real browser)`);
  assert.equal(count,1000000);
  assert.ok(elapsed < 1500, `${elapsed.toFixed(1)}ms exceeds 1500ms`);
});
