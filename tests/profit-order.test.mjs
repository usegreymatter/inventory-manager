import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const source=fs.readFileSync(new URL('../desktop/profit-order.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(source,ctx);
const suggest=vm.runInContext('PROFIT_ORDER.suggest',ctx),plain=x=>JSON.parse(JSON.stringify(x));
let state=123456789;
const next=n=>{state^=state<<13;state^=state>>>17;state^=state<<5;state>>>=0;return state%n;};
const cases=[];
for(let i=0;i<1500;i++){
  const s={sku:`${i}-😀-المخزن`,as_of:'2026-10',unit_cost:[0,.125,10,100][i%4],sale_price:[0,1,15,30,180][i%5],
    on_hand:next(100),incoming:next(40),lead_days:[0,7,15,60][i%4],review_days:[0,7,30,60][i%4],
    annual_holding_pct:[0,20,50,100][i%4],ordering_cost:[0,.25,15,100][i%4],
    MOQ:[0,12,55,.125][i%4],pack:[1,3,12,.125][i%4],salvage_pct:[0,20,100][i%3]};
  if(i%2)s.demand_paths=Array.from({length:3+next(240)},()=>({lead:next(200),demand:next(500)/8}));
  else Object.assign(s,{forecast:[next(200),next(300),next(400)],history:Array.from({length:3+next(50)},()=>next(200))});
  if(i%3)s.usable_window_days=[0,3,7,30,60,365][i%6];
  if(i%7===0)s.shelf_cap_qty=next(100);
  if(i%5===0)s.receipts=[{day:next(120),quantity:next(200)},{day:next(120),quantity:next(200)}];
  cases.push(s);
}
for(const [k,v] of [['sale_price','20'],['pack',0],['MOQ',.0000001],['on_hand',true],['salvage_pct',101],['demand_paths',[]]])cases.push({...cases[1],[k]:v});
cases.push({unit_cost:10,demand_paths:[1]},{sale_price:10,demand_paths:[1]});
for(const k of ['on_hand','incoming','lead_days','review_days','annual_holding_pct','ordering_cost','salvage_pct','MOQ','pack','shelf_cap_qty','sku','forecast'])cases.push({...cases[0],forecast_mean:100,[k]:null});
for(const history of [true,false,0,{a:1},'abc'])cases.push({...cases[0],history});
for(let i=0;i<100;i++)cases.push({unit_cost:10,sale_price:20,lead_days:3,review_days:7,pack:.1,demand_paths:Array.from({length:10},()=>Array.from({length:10},()=>next(100)/10))});
cases.push({unit_cost:10,sale_price:10.25,annual_holding_pct:0,usable_window_days:30,salvage_pct:90,demand_paths:[...Array(40).fill(10),...Array(160).fill(100)]});
cases.push({unit_cost:10,sale_price:20,demand_paths:[1e12,9e11],pack:1e-6,usable_window_days:30,annual_holding_pct:0});
const bridge=spawnSync('/usr/bin/python3',['-c',`import json,sys\nfrom profit_order import suggest\nresult=[]\nfor s in json.load(sys.stdin):\n try: result.append(suggest(s))\n except (ValueError,TypeError): result.append({'error':'invalid-input'})\njson.dump(result,sys.stdout,allow_nan=False)`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(cases),encoding:'utf8',maxBuffer:16*1024*1024});
assert.equal(bridge.status,0,bridge.stderr);const expected=JSON.parse(bridge.stdout);
test('exact Python/JS simulation parity including nulls, daily paths and review regressions',()=>{
  assert.equal(cases.length,1627);
  for(const [i,s] of cases.entries()){
    let actual;try{actual=plain(suggest(s));}catch{actual={error:'invalid-input'};}
    assert.deepEqual(actual,expected[i],`case ${i}`);
  }
});
test('embedded source is byte-identical and opt-in engine output additive',()=>{
  const plugin=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8');
  const embedded=plugin.split('/* STOCK_RUNWAY_PROFIT_ORDER_START */\n')[1]?.split('/* STOCK_RUNWAY_PROFIT_ORDER_END */')[0];
  assert.equal(embedded,source);
  const core=vm.createContext({TextEncoder,TextDecoder,atob,btoa});
  vm.runInContext(plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ',''),core);
  const results=vm.runInContext(`(()=>{const raw={...SAMPLE.items[0],on_hand:0,unit_cost:10,sale_price:20};const p=calculate([raw],SAMPLE.months,SAMPLE.as_of,6)[0],item={...raw,...p,on_hand:0,monthly_sales:raw.monthly_sales,as_of:SAMPLE.as_of};const a=orderGuidance(item,'2026-11-01'),b=orderGuidance(item,'2026-11-01',{profit_suggestion:true});return {a,b,why:whyThisAmount(item,'2026-11-01',{profit_suggestion:true})}})()`,core);
  const {a,b,why}=plain(results);assert.ok(b.profit_suggestion);delete b.profit_suggestion;assert.deepEqual(b,a);assert.match(why,/Most profitable:/);
});
test('demo-1000 pure suggestion added time below 300ms',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../data/demo-1000.json',import.meta.url),'utf8'));
  const specs=data.items.map(i=>({sku:i.sku,on_hand:i.on_hand??0,history:i.monthly_sales,forecast:[100,120,80],incoming:i.on_order??0,lead_days:i.supplier_days??14,review_days:30,unit_cost:10,sale_price:20,MOQ:i.minimum_order??0,pack:i.pack_size??1}));
  specs.forEach(s=>suggest(s));const t=performance.now();specs.forEach(s=>suggest(s));const elapsed=performance.now()-t;
  console.log(`profit suggestion demo-1000: ${elapsed.toFixed(2)} ms, 96 generated paths/SKU`);assert.ok(elapsed<300,`${elapsed} ms`);
});
