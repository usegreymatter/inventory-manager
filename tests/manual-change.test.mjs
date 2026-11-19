import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync,execFileSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const health=fs.readFileSync(new URL('../standalone/design/health.js',import.meta.url),'utf8')
function core(s,withHealth=true){
 const c=vm.createContext({TextEncoder,TextDecoder,Date,Intl})
 vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replaceAll('export ','')+(withHealth?'\n'+health:'')+'\nthis.api={calculate,orderGuidance,orderBucket,inventoryHistory,parseStockImport,evaluateDataset'+(withHealth?',stockoutHistory,dataHealth':'')+'}',c)
 return c.api
}
const api=core(source),plain=x=>JSON.parse(JSON.stringify(x)),as_of='2026-10-31',today='2026-11-01'
const monthAfter=(m,n)=>{const [y,k]=m.split('-').map(Number);return new Date(Date.UTC(y,k-1+n,1)).toISOString().slice(0,7)}
const days=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).getUTCDate()
function annotated(sales=[30,30,30],exposure=null,policies=null){
 const months=sales.map((_,i)=>monthAfter('2026-10',i-sales.length+1))
 const item={sku:'A',name:'Synthetic',unit:'box',on_hand:25,supplier_days:2,monthly_sales:sales,receipts:{},planning_facts:{version:'1.0',sales_history:months.map((month,i)=>({sku:'A',month,quantity:sales[i],in_stock_days:exposure?.[i]??days(month),backorder:policies?.[i]??false}))}}
 return {item,months,as_of,today,settings:{big_order_months:6}}
}
const physicalKeys=['held','sku','name','unit','stock','monthly_demand','seasonal','forecast_explanation','runout_month','runout_day','order_by','order_overdue','error_percent','grade','projection','receipts','demand_swing','safety_stock','safety_stock_provenance','reorder_point','eoq','why','planning_facts','purchase_hold','late_po_quantity','overdue_order_quantity','committed_quantity','inventory_position','suggested_order','covered_by_on_order','big_order','on_order','reason','demand_history']
function evaluate(c){
 const p=api.calculate([c.item],c.months,c.as_of,6,c.settings||{},c.today)[0],g=api.orderGuidance(p,c.today,c.settings||{},c.as_of)
 return plain({physical:Object.fromEntries(physicalKeys.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])),guidance:g,bucket:api.orderBucket(p,c.today,c.settings||{},c.as_of),health:api.dataHealth({items:[p],as_of:c.as_of,months:c.months},c.today,c.settings||{})})
}

function projects(sales=[30,30,30,300],flags=[false,false,false,true],only=false,exposure=null){
 const c=annotated(sales,exposure)
 c.item.planning_facts.sales_history.forEach((r,i)=>{r.project=flags[i];if(only){delete r.in_stock_days;delete r.backorder}})
 return c
}

test('manual adjustment follows cleaning once and imports optional per SKU column',()=>{
 const c=projects([30,30,30,60],[false,false,false,true],false,[31,31,15,10]);c.item.demand_change_pct=50
 const r=evaluate(c);assert.deepEqual(r.physical.demand_history.adjusted,[45,45,90,0]);assert.equal(r.physical.monthly_demand,60)
 for(const first of ['sku,name,unit,on_hand,supplier_days','Item Code,Item Name,UoM,Qty On Hand,Lead Time']){
  const csv=first+',demand_change_pct,2026-08,2026-09,2026-10\nA,Synthetic,box,25,2,-90,30,30,30\nB,Other,box,25,2,,30,30,30'
  const d=api.parseStockImport(csv)
  assert.equal(d.items[0].demand_change_pct,-90);assert.ok(!Object.hasOwn(d.items[1],'demand_change_pct'))
  for(const bad of ['301','NaN','5%']){
   const mixed=csv.replace(',-90,',','+bad+',')
   assert.throws(()=>api.parseStockImport(mixed,{strict:true}),/demand_change_pct/)
   const tolerant=api.parseStockImport(mixed)
   assert.deepEqual(plain(tolerant.items.map(i=>i.sku)),['B'])
   assert.equal(tolerant.import_report.rows_set_aside[0].row,2)
   assert.match(tolerant.import_report.rows_set_aside[0].reason,/demand_change_pct/)
  }
 }
})
test('explicit zero percent is exactly identity for fractional observations',()=>{
 const c=annotated([88.84031387546717,88.84031387546717,88.84031387546717]);delete c.item.planning_facts
 const before=evaluate(c);c.item.demand_change_pct=0;const after=evaluate(c)
 assert.deepEqual(after.physical.demand_history.adjusted,c.item.monthly_sales)
 for(const key of ['monthly_demand','projection','runout_day','safety_stock','safety_stock_provenance','reorder_point'])assert.deepEqual(after.physical[key],before.physical[key])
 assert.equal(after.guidance.quantity,before.guidance.quantity)
})
test('stock-count column preserves local dates, omits blanks and rejects malformed dates',()=>{
 const text='sku,name,unit,on_hand,supplier_days,last_count_date,2026-08,2026-09,2026-10\nA,Synthetic,box,25,2,2026-01-01,30,30,30\nB,Other,box,25,2,,30,30,30'
 const d=api.parseStockImport(text)
 assert.equal(d.items[0].last_count_date,'2026-01-01');assert.ok(!Object.hasOwn(d.items[1],'last_count_date'))
 assert.ok(api.dataHealth(d,today).warnings.some(w=>w.code==='stale_stock_count'&&w.sku==='A'))
 for(const value of ['2026-02-30','0000-01-01','bad']){
  const mixed=text.replace('2026-01-01',value)
  assert.throws(()=>api.parseStockImport(mixed,{strict:true}),/last_count_date/)
  const tolerant=api.parseStockImport(mixed)
  assert.deepEqual(plain(tolerant.items.map(i=>i.sku)),['B'])
  assert.equal(tolerant.import_report.rows_set_aside[0].row,2)
  assert.match(tolerant.import_report.rows_set_aside[0].reason,/last_count_date/)
 }
})
test('manual full Python JS parity: seeded fractions, bounds, invalid holds',()=>{
 const cases=[];let seed=61031;const rand=n=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n)
 for(let i=0;i<120;i++){
  const n=3+rand(16),sales=Array.from({length:n},()=>rand(4000)/8)
  const c=projects(sales,sales.map(()=>Boolean(rand(5)===0)),Boolean(rand(2)))
  if(i%3===0)delete c.item.planning_facts
  c.item.demand_change_pct=[-90,300,0,12.5,-25,rand(39001)/100-90,null,true,'50',301,-91][rand(11)]
  c.settings={big_order_months:6,include_backup_in_orders:Boolean(rand(2)),product_overrides:{A:{pack_size:[1,.125,4][rand(3)]}}};cases.push(c)
 }
 const py=spawnSync('/usr/bin/python3',['tests/phase2_bridge.py'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,TMPDIR:process.cwd()+'/.scratch'}})
 assert.equal(py.status,0,py.stderr);const expected=JSON.parse(py.stdout)
 cases.forEach((c,i)=>assert.deepEqual(evaluate(c),expected[i],`manual seed ${i}: ${JSON.stringify(c)}`))
 for(const pct of [null,true,'50',301,-91]){
  const c=annotated();delete c.item.planning_facts;c.item.demand_change_pct=pct
  const r=evaluate(c);assert.equal(r.guidance.quantity,null);assert.equal(r.guidance.purchase_hold,true);assert.equal(r.health.features.manual_change.state,'locked')
 }
})
