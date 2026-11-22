import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
import test from 'node:test'
const plugin=fs.readFileSync('desktop/plugin.js','utf8')
const core=plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')
const adapter=plugin.slice(plugin.indexOf('function displayCostMetrics('),plugin.indexOf('function CostFigures('))
const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa})
for(const source of [core,fs.readFileSync('desktop/cost-view.js','utf8'),fs.readFileSync('standalone/design/risk.js','utf8'),adapter])vm.runInContext(source,context)
const plain=value=>JSON.parse(JSON.stringify(value))
test('Desktop module has only SDK/React imports supported by the single-blob host',()=>{
 for(const match of plugin.slice(0,plugin.indexOf('const SAMPLE =')).matchAll(/(?:from\s+|^import\s+)['"]([^'"\n]+)['"]/gm))assert.ok(['@hermes/plugin-sdk','react','react/jsx-runtime'].includes(match[1]),match[1]);
 assert.ok(plugin.includes('// COST_DISPLAY_START'));
});
test('concatenated offline core terminates before the cost IIFE and keeps healthy advice callable',()=>{
 const scope=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa});
 vm.runInContext(core+'\n'+fs.readFileSync('desktop/cost-view.js','utf8'),scope);
 assert.equal(typeof scope.StockRunwayCosts?.costMetrics,'function');
 assert.match(vm.runInContext("noOrderSentence({on_order:0},{quantity:0,monthly_demand:30,runout_date:'2027-01-01'})",scope),/enough stock until/);
});
const python=process.env.PYTHON||'python3'
const specs=Array.from({length:30},(_,n)=>({sku:'COST-'+n,as_of:'2026-10',today:'2026-11-01',history:Array.from({length:12},(_,m)=>(n*17+m*23)%91),forecast:[30+n,35+n,20+n],on_hand:n,quantity:50,lead_days:2+n,cover_months:2,order_by:'2026-11-01',receipts:n%2?[{date:'2026-11-03',quantity:15}]:[],include_shortfall:true}))
const py=spawnSync(python,['-c',"import sys,json,risk; print(json.dumps([risk.simulate_risk(s) for s in json.load(sys.stdin)]))"],{input:JSON.stringify(specs),encoding:'utf8'})
assert.equal(py.status,0,py.stderr)
const expected=JSON.parse(py.stdout)
test('shortfall collector reads same seeded paths in Python and JS; default probabilities unchanged',()=>{
 for(let n=0;n<specs.length;n++){
  const actual=plain(context.StockRunwayRisk.simulateRisk(specs[n]))
  assert.deepEqual(actual,expected[n]);const {expected_shortfall_before,...base}=actual
  assert.ok(expected_shortfall_before>=0)
  assert.deepEqual(plain(context.StockRunwayRisk.simulateRisk({...specs[n],include_shortfall:false})),base)
 }
})
test('explicit null overrides do not silently revive item demand or expiry facts',()=>{
 const value=plain(context.StockRunwayCosts.costMetrics({unit_cost:4,monthly_demand:30,expiry_at_risk_qty:8},{monthly_demand:null,expiry_at_risk_qty:null}))
 assert.deepEqual(value,{})
})
test('desktop read-only adapter matches Python CLI on synthetic fractional stock and settings costs',()=>{
 const data={as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:Array.from({length:25},(_,n)=>({sku:'C'+n,name:'Synthetic '+n,unit:'ea',on_hand:n+.5,...(n%4===0?{lots:[{lot:'Expired',expiry:'2026-10-30',qty:n+.5}]}:{}),on_order:n%3,unit_cost:4,sale_price:8+n,supplier_days:10,monthly_sales:[30+n,40+n,30+n],receipts:n%2?{'2026-11':5}:{}}))}
 const settings={show_costs:true,months_of_cover:2,product_overrides:{C2:{unit_cost:9}}},today='2026-11-01'
 const input=JSON.stringify({data,settings,today})
 const run=spawnSync(python,['-c',"import json,sys,stock_runway as c; p=json.load(sys.stdin); e,_=c._load_modules(); print(json.dumps(c._export_rows(p['data'],e,p['today'],p['settings'],True,True)))"],{input,encoding:'utf8'})
 assert.equal(run.status,0,run.stderr);const expected=JSON.parse(run.stdout)
 context.fixture=data;context.options=settings
 const actual=vm.runInContext("evaluateDataset(fixture,6,options,'2026-11-01').map(item=>displayCostMetrics(item,orderGuidance(item,'2026-11-01',options,fixture.as_of),options,fixture.as_of,'2026-11-01'))",context)
 for(let n=0;n<actual.length;n++)for(const [key,value]of Object.entries(actual[n]))assert.ok(Math.abs(value-expected[n][key])<=Math.max(1,Math.abs(value))*1e-12,`${n} ${key}: ${value} != ${expected[n][key]}`)
})
