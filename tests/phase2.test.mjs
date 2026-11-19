import { readBaseline, baselineResult } from './baseline.mjs'
import assert from 'node:assert/strict'
import {forecastOnly,assertGuidanceDates} from './policy-v2-support.mjs'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync,execFileSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const health=fs.readFileSync(new URL('../standalone/design/health.js',import.meta.url),'utf8')
function core(source,withHealth=false){
  const ctx=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
  const pure=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll(/export /g,'').replace('model.seasonal ? SEASONAL_COPY : SEASONAL_REASON','model.method_name || (model.seasonal ? SEASONAL_COPY : SEASONAL_REASON)')
  vm.runInContext(pure+(withHealth?'\n'+health:'')+'\nthis.api={demandModel,calculate,orderGuidance,orderBucket,parseCsv,evaluateDataset'+(withHealth?',parseStockImport,dataHealth':'')+'}',ctx)
  // Owner-approved Phase 4 model seam; all supply/guidance fields still match.
  if(!withHealth){ctx.phase4Model=api.demandModel;vm.runInContext('demandModel=phase4Model',ctx)}
  return ctx.api
}
const api=core(source,true),plain=x=>JSON.parse(JSON.stringify(x))
const months=['2026-08','2026-09','2026-10'],as_of='2026-10-31'
const item=(stock=10,sales=30)=>({sku:'A',name:'Synthetic',unit:'box',on_hand:stock,supplier_days:2,monthly_sales:[sales,sales,sales],receipts:{}})
const po=(due='2026-11-20',quantity=60,key='P',status='confirmed')=>({po_line_id:key,sku:'A',warehouse:'MAIN',supplier:'S',remaining_qty:quantity,due_date:due,status})
const supplied=(raw=item(),rows=[po()])=>({...raw,planning_facts:{version:'1.0',warehouses:['MAIN'],incoming_pos:rows}})
function evaluate(c){
 const p=api.calculate([c.item],c.months,c.as_of,6,c.settings||{},c.today)[0],g=api.orderGuidance(p,c.today,c.settings||{},c.as_of)
 return plain({physical:Object.fromEntries(['held', 'sku', 'name', 'unit', 'stock', 'monthly_demand', 'seasonal', 'forecast_explanation', 'runout_month', 'runout_day', 'order_by', 'order_overdue', 'error_percent', 'grade', 'projection', 'receipts', 'demand_swing', 'safety_stock', 'safety_stock_provenance', 'reorder_point', 'eoq', 'why', 'planning_facts', 'purchase_hold', 'late_po_quantity', 'overdue_order_quantity', 'committed_quantity', 'inventory_position', 'suggested_order', 'covered_by_on_order', 'big_order', 'on_order', 'reason', 'demand_history'].filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])),guidance:g,bucket:api.orderBucket(p,c.today,c.settings||{},c.as_of),health:api.dataHealth({items:[p],as_of:c.as_of,months:c.months},c.today,c.settings||{})})
}
const caseOf=(raw,today='2026-11-01',settings={})=>({item:raw,months,as_of,today,settings})

test('dated PO: due-day netting, first shortage and unresolved overdue HOLD',()=>{
 const c=evaluate(caseOf(supplied()))
 assert.equal(c.physical.runout_day,'2026-11-10');assert.equal(c.guidance.runout_date,'2026-11-10')
 assert.equal(c.guidance.delivery_date,'2026-11-20');assert.equal(c.guidance.quantity,10) // Before Nov20: demand20-stock10=10; Jan9 endpoint demand-stock-receipt60 is negative.
 const now=evaluate(caseOf(supplied(item(),[po('2026-11-01')])));assert.equal(now.guidance.projected_balance_today,69)
 const late=evaluate(caseOf(supplied(item(),[po('2026-11-01')]),'2026-11-02'))
 assert.equal(late.guidance.quantity,null);assert.equal(late.guidance.purchase_hold,true);assert.equal(late.guidance.projected_balance_today,8)
 assert.equal(late.physical.projection[0].receipts,0);assert.equal(late.bucket,'needs-data')
})

test('browser bridge import uses same calculator and never treats gates as authority',()=>{
 const bundle={bundle_version:'1.0',decision_date:'2026-11-01',months,as_of,items:[supplied()]}
 const loaded=api.parseStockImport(JSON.stringify(bundle));assert.equal(api.evaluateDataset(loaded,6)[0].runout_day,'2026-11-10')
 const bad=structuredClone(bundle);bad.items[0].planning_facts.incoming_pos[0].supplier='';bad.bundle_health={features:{dated_incoming:{state:'on'}}}
 const p=api.evaluateDataset(api.parseStockImport(JSON.stringify(bad)),6)[0]
 assert.equal(api.orderGuidance(p,bad.decision_date).purchase_hold,true)
 assert.throws(()=>api.parseStockImport(JSON.stringify({...bundle,bundle_version:'2.0'})))
 const duplicate=structuredClone(bundle);duplicate.items.push({...supplied(item(),[po()]),sku:'B'})
 const dup=api.parseStockImport(JSON.stringify(duplicate));assert.equal(api.orderGuidance(api.evaluateDataset(dup,6)[0],'2026-11-01').purchase_hold,true)
})

test('seeded dated event parity: physical, guidance, bucket and health together',()=>{
 let seed=204651;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n}
 const cases=[]
 for(let i=0;i<180;i++){
   const raw=item(rand(200)/4,[0,0.1,1,15.5,30,60][rand(6)]),rows=[]
   for(let j=0;j<1+rand(4);j++)rows.push(po(`2026-${['10','11','12'][rand(3)]}-${String(1+rand(28)).padStart(2,'0')}`,rand(100)/4,'P'+j,['confirmed','confirmed','draft','cancelled','received'][rand(5)]))
   const optional=supplied(raw,rows)
   if(i%13===0)optional.on_order=10
   if(i%17===0)optional.planning_facts.incoming_pos[0].warehouse='UNKNOWN'
   if(i%19===0)optional.planning_facts.incoming_pos[0].due_date='2026-02-30'
   cases.push(caseOf(optional,['2026-11-01','2026-11-13','2026-12-02'][rand(3)],{months_of_cover:rand(4),buffer_days:rand(14)}))
 }
 const py=spawnSync('/usr/bin/python3',['tests/phase2_bridge.py'],{input:JSON.stringify(cases),encoding:'utf8',env:{...process.env,TMPDIR:process.cwd()+'/.scratch'},maxBuffer:16*1024*1024})
 assert.equal(py.status,0,py.stderr)
 const expected=JSON.parse(py.stdout)
 cases.forEach((c,i)=>assert.deepEqual(evaluate(c),expected[i],`seed case ${i}: ${JSON.stringify(c)}`))
})

test('no optional data: frozen forecast fields equal Phase 1; dates follow policy v2',()=>{
 const baseline=core(readBaseline('a0b3264:desktop/plugin.js'))
 const sample=JSON.parse(fs.readFileSync(new URL('../data/sample.json',import.meta.url),'utf8'))
 const datasets=[sample,...fs.readdirSync(new URL('../docs/erp-examples',import.meta.url)).filter(n=>n.endsWith('.csv')).map(n=>api.parseCsv(fs.readFileSync(new URL('../docs/erp-examples/'+n,import.meta.url),'utf8')))]
 for(const d of datasets)for(const settings of [{},{months_of_cover:1.5,buffer_days:0},{include_backup_in_orders:true}]){
   const actual=api.calculate(d.items,d.months,d.as_of,6,settings),old=baseline.calculate(d.items,d.months,d.as_of,6,settings)
   assert.deepEqual(plain(actual.map(forecastOnly)),plain(old.map(forecastOnly)))
   for(let i=0;i<actual.length;i++){
    assertGuidanceDates(api,actual[i],d.as_of,settings,d.as_of)
   }
 }
})
