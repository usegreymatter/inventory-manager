import { readBaseline, baselineResult } from './baseline.mjs'
import assert from 'node:assert/strict'
import {forecastOnly,assertGuidanceDates} from './policy-v2-support.mjs'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import test from 'node:test'
import {spawnSync,execFileSync} from 'node:child_process'
import pythonStdin from './python-stdin.cjs'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const health=fs.readFileSync(new URL('../standalone/design/health.js',import.meta.url),'utf8')
function core(source,withHealth=false){
  const ctx=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
  const pure=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll(/export /g,'')
  const quickSupport=source.slice(source.indexOf('function savedHorizon('),source.indexOf('function RecoveryPanel('))+source.slice(source.indexOf('function defaultHorizon('),source.indexOf('export function Settings('))
  vm.runInContext(pure+'\n'+quickSupport+(withHealth?'\n'+health:'')+'\nthis.api={calculate,orderGuidance,orderBucket,parseCsv,evaluateDataset,quickData'+(withHealth?',parseStockImport,dataHealth':'')+'}',ctx)
  return ctx.api
}
const api=core(source,true),plain=x=>JSON.parse(JSON.stringify(x))
const months=['2026-08','2026-09','2026-10'],as_of='2026-10-31'
const item=(stock=25,sales=30)=>({sku:'A',name:'Synthetic',unit:'box',on_hand:stock,supplier_days:2,monthly_sales:[sales,sales,sales],receipts:{}})
const order=(quantity=20,delivery_date='2026-11-10',forecast_included=true,order_line_id='O',status='confirmed')=>({order_line_id,sku:'A',warehouse:'MAIN',quantity,delivery_date,status,forecast_included})
const state=(reserved=0)=>({sku:'A',warehouse:'MAIN',damaged:0,reserved,quarantine:0,returns:0})
const committed=(raw=item(),orders=[order()])=>({...raw,planning_facts:{version:'1.0',warehouses:['MAIN'],customer_orders:orders,stock_states:[state()]}})
const caseOf=(raw,today='2026-11-01',settings={})=>({item:raw,months,as_of,today,settings})
const physicalKeys=['held', 'sku', 'name', 'unit', 'stock', 'monthly_demand', 'seasonal', 'forecast_explanation', 'runout_month', 'runout_day', 'order_by', 'order_overdue', 'error_percent', 'grade', 'projection', 'receipts', 'demand_swing', 'safety_stock', 'safety_stock_provenance', 'reorder_point', 'eoq', 'why', 'planning_facts', 'purchase_hold', 'late_po_quantity', 'overdue_order_quantity', 'committed_quantity', 'inventory_position', 'suggested_order', 'covered_by_on_order', 'big_order', 'on_order', 'reason','demand_history','input_warnings']
function evaluate(c,implementation=api){
 const p=implementation.calculate([c.item],c.months,c.as_of,6,c.settings||{},c.today)[0],g=implementation.orderGuidance(p,c.today,c.settings||{},c.as_of)
 return plain({physical:Object.fromEntries(physicalKeys.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])),guidance:g,bucket:implementation.orderBucket(p,c.today,c.settings||{},c.as_of),health:api.dataHealth({items:[p],as_of:c.as_of,months:c.months},c.today,c.settings||{})})
}

test('included and incremental delivery events follow reviewed month and daily policy',()=>{
 const c=evaluate(caseOf(committed()))
 assert.equal(c.physical.projection[0].demand,30)
 assert.equal(c.physical.runout_day,'2026-11-15');assert.equal(c.guidance.runout_date,'2026-11-15');assert.equal(c.guidance.quantity,49)
 const extra=evaluate(caseOf(committed(item(),[order(20,'2026-11-10',false)])))
 assert.equal(extra.physical.projection[0].demand,50);assert.equal(extra.physical.runout_day,'2026-11-10');assert.equal(extra.guidance.quantity,64)
 const above=evaluate(caseOf(committed(item(),[order(80,'2026-11-20')])))
 assert.equal(above.physical.projection[0].demand,80);assert.equal(above.guidance.quantity,104)
})

test('overdue orders adopt today; same-day receipts precede all customer obligations',()=>{
 const c=evaluate(caseOf(committed(item(),[order(40,'2026-10-20')]),'2026-11-13'))
 assert.equal(c.guidance.overdue_order_quantity,40);assert.equal(c.physical.runout_day,'2026-11-13')
 assert.equal(c.guidance.projected_balance_today,-15)
 const raw=committed(item(25,0),[order(15),order(20,'2026-11-10',true,'O2')])
 raw.planning_facts.incoming_pos=[{po_line_id:'P',sku:'A',warehouse:'MAIN',supplier:'S',remaining_qty:15,due_date:'2026-11-10',status:'confirmed'}]
 const same=evaluate(caseOf(raw));assert.equal(same.physical.runout_day,null);assert.equal(same.physical.projection[0].stock,5)
})

test('reservation policy cannot double-debit or grant unsupported approval',()=>{
 const raw=committed();delete raw.planning_facts.stock_states
 const c=evaluate(caseOf(raw));assert.equal(c.guidance.purchase_hold,true);assert.equal(c.guidance.quantity,null);assert.equal(c.guidance.scenario_quantity,49)
 raw.planning_facts.stock_states=[state(5)];raw.planning_facts.reservation_mapping=[{order_line_id:'O',quantity:5}]
 const held=evaluate(caseOf(raw));assert.equal(held.guidance.scenario_quantity,49);assert.equal(held.guidance.purchase_hold,true)
 raw.planning_facts.stock_states=[state()];assert.equal(evaluate(caseOf(raw)).guidance.purchase_hold,false)
})

test('actual CSV bundle conversion -> browser bridge -> projection/guidance with duplicate gate protection',()=>{
 const dir=fs.mkdtempSync(path.join(process.cwd(),'.scratch','f2-browser-import-'))
 fs.writeFileSync(path.join(dir,'stock.csv'),'sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nA,Synthetic,box,25,2,30,30,30\n')
 fs.writeFileSync(path.join(dir,'warehouses.csv'),'warehouse,name\nMAIN,Main\n')
 fs.writeFileSync(path.join(dir,'customer_orders.csv'),'order_line_id,sku,warehouse,quantity,delivery_date,status,forecast_included\nO,A,MAIN,20,2026-11-10,confirmed,true\n')
 fs.writeFileSync(path.join(dir,'warehouse_stock.csv'),'sku,warehouse,on_hand\nA,MAIN,25\n')
 fs.writeFileSync(path.join(dir,'stock_states.csv'),'sku,warehouse,damaged,reserved,quarantine,returns\nA,MAIN,0,0,0,0\n')
 const py=spawnSync('/usr/bin/python3',['bundle_import.py',dir,'--today','2026-11-01'],{encoding:'utf8',env:{...process.env,TMPDIR:process.cwd()+'/.scratch'}})
 assert.equal(py.status,0,py.stderr)
 const d=api.parseStockImport(py.stdout),p=api.evaluateDataset(d,6)[0],g=api.orderGuidance(p,d.decision_date)
 assert.equal(p.runout_day,'2026-11-15');assert.equal(g.quantity,49)
 const duplicate=plain(d);duplicate.items.push({...duplicate.items[0],sku:'B'})
 const dup=api.parseStockImport(JSON.stringify(duplicate))
 assert.equal(api.orderGuidance(api.evaluateDataset(dup,6)[0],d.decision_date).purchase_hold,true)
 assert.deepEqual(plain(api.dataHealth(d,d.decision_date).features.committed_demand.items.A),{state:'on',needs:''})
})

test('seeded combined supply/customer/reservation parity on all calculation outputs',()=>{
 let seed=390160;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n}
 const cases=[]
 for(let i=0;i<280;i++){
   const raw=committed(item(rand(500)/4,[0,0.1,1.5,15.5,30,60][rand(6)]),[])
   for(let j=0;j<1+rand(4);j++)raw.planning_facts.customer_orders.push(order(rand(250)/4,`2026-${['10','11','12'][rand(3)]}-${String(1+rand(28)).padStart(2,'0')}`,Boolean(rand(2)),'O'+j,['confirmed','confirmed','draft','cancelled'][rand(4)]))
   if(i%3===0)raw.planning_facts.incoming_pos=[{po_line_id:'P',sku:'A',warehouse:'MAIN',supplier:'S',remaining_qty:rand(300)/4,due_date:`2026-11-${String(1+rand(28)).padStart(2,'0')}`,status:'confirmed'}]
   if(i%7===0)raw.planning_facts.stock_states=[state(rand(10)/2)]
   if(i%11===0)delete raw.planning_facts.stock_states
   if(i%13===0)raw.planning_facts.customer_orders[0].forecast_included=null
   if(i%17===0)raw.planning_facts.customer_orders[0].delivery_date='2026-02-30'
   if(i%19===0)raw.planning_facts.customer_orders[0].warehouse='OTHER'
   if(i%23===0)raw.reserved=null
   if(i%29===0)raw.planning_facts.errors={committed_demand:true}
   if(i%31===0)raw.on_order=10
   if(i%37===0)raw.receipts={'2026-12':12}
   cases.push(caseOf(raw,['2026-11-01','2026-11-13','2026-12-02'][rand(3)],{months_of_cover:rand(6)/2,buffer_days:rand(10),product_overrides:{A:{pack_size:[1,0.125,4][rand(3)]}}}))
 }
 // Leap day, huge commitments, seasonal baseline, and zero demand are explicit calendar edges.
 const leap=caseOf(committed(item(25),[order(40,'2028-02-29')]),'2028-02-01')
 leap.months=['2027-11','2027-12','2028-01'];leap.as_of='2028-01-31';cases.push(leap)
 const seasonal=caseOf(committed(item(100),[order(50,'2026-12-31',false)]))
 seasonal.months=Array.from({length:12},(_,i)=>`${2025+Math.floor((i+10)/12)}-${String((i+10)%12+1).padStart(2,'0')}`)
 seasonal.item.monthly_sales=[10,20,30,15,40,50,35,20,10,25,60,45];cases.push(seasonal)
 const py=pythonStdin(['tests/phase2_bridge.py'],JSON.stringify(cases))
 assert.equal(py.status,0,py.stderr)
 const expected=JSON.parse(py.stdout)
 cases.forEach((c,i)=>assert.deepEqual(evaluate(c),expected[i],`combined seed ${i}: ${JSON.stringify(c)}`))
})

test('feature 1 frozen forecasts remain equal afea1c3; dates use policy v2',()=>{
 // This corpus is constant smooth demand: numbers stay identical; only the
 // owner-approved method label changes. Retain whole-row/guidance equality.
 const baseline=core(readBaseline('afea1c3:desktop/plugin.js').replaceAll('model.seasonal ? SEASONAL_COPY : SEASONAL_REASON',"'Steady: 12-month average'"))
 for(const stock of [0,3.5,25,200])for(const today of ['2026-11-01','2026-11-13','2026-12-02'])for(const due of ['2026-10-31','2026-11-01','2026-11-20']){
  const raw=item(stock);raw.planning_facts={version:'1.0',warehouses:['MAIN'],incoming_pos:[{po_line_id:'P',sku:'A',warehouse:'MAIN',supplier:'S',remaining_qty:60,due_date:due,status:'confirmed'}]}
  const p=api.calculate([raw],months,as_of,6,{},today)[0],old=baseline.calculate([raw],months,as_of,6,{},today)[0]
  assert.deepEqual(plain(forecastOnly(p)),plain(forecastOnly(old)))
  assertGuidanceDates(api,p,today,{},as_of)
 }
})


test('Desktop quick view uses its planning clock for overdue outstanding orders',()=>{
 const raw=committed(item(25,0),[order(40,'2026-11-20')])
 const data={as_of,months,decision_date:'2026-11-01',items:[raw]}
 const ctx={storage:{get:(key,fallback)=>key==='source'?'csv':key==='csv_data'?data:key==='last_horizon'?6:fallback}}
 const q=api.quickData(ctx,'2026-12-02')
 assert.equal(q.rows[0].runout,'2026-12')
 assert.equal(api.calculate([raw],months,as_of,6,{},'2026-12-02')[0].runout_day,'2026-12-02')
})

test('review F3: all optional physical fields use today for safety and late PO',()=>{
 const raw=item(10);raw.planning_facts={version:'1.0',warehouses:['MAIN'],incoming_pos:[{po_line_id:'P',sku:'A',warehouse:'MAIN',supplier:'S',remaining_qty:60,due_date:'2026-11-01',status:'confirmed'}]}
 const c=caseOf(raw,'2026-11-02',{big_order_months:6}),r=evaluate(c)
 assert.equal(r.physical.suggested_order,null);assert.equal(r.physical.purchase_hold,true)
 const py=pythonStdin(['tests/phase2_bridge.py'],JSON.stringify([c]))
 assert.equal(py.status,0,py.stderr);assert.deepEqual(r,JSON.parse(py.stdout)[0])
})
test('review notes: malformed error shapes and prototype SKU gates stay in parity',()=>{
 for(const errors of [null,{dated_incoming:true},{committed_demand:true}]){
  const c=caseOf(committed());c.item.planning_facts.errors=errors
  const py=pythonStdin(['tests/phase2_bridge.py'],JSON.stringify([c]))
  assert.equal(py.status,0,py.stderr);assert.deepEqual(evaluate(c),JSON.parse(py.stdout)[0])
 }
 const raw=committed();raw.sku='__proto__';raw.planning_facts.customer_orders[0].sku='__proto__';raw.planning_facts.stock_states[0].sku='__proto__'
 const h=api.dataHealth({items:[raw],months,as_of},'2026-11-01')
 assert.equal(Object.hasOwn(h.features.committed_demand.items,'__proto__'),true)
 assert.equal(h.features.committed_demand.items.__proto__.state,'on')
 assert.throws(()=>api.parseStockImport('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\n'+' '.repeat(2*1024*1024)),/2 MiB/)
})
