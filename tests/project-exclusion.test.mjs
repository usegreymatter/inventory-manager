import { readBaseline, baselineResult } from './baseline.mjs'
import assert from 'node:assert/strict'
import {forecastOnly,assertGuidanceDates,assertFrozenForecast} from './policy-v2-support.mjs'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync,execFileSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const health=fs.readFileSync(new URL('../standalone/design/health.js',import.meta.url),'utf8')
function core(s,withHealth=true){
 const c=vm.createContext({TextEncoder,TextDecoder,Date,Intl})
 vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replace('model.seasonal ? SEASONAL_COPY : SEASONAL_REASON','model.method_name || (model.seasonal ? SEASONAL_COPY : SEASONAL_REASON)').replaceAll('export ','')+(withHealth?'\n'+health:'')+'\nthis.api={demandModel,calculate,orderGuidance,orderBucket,inventoryHistory,parseStockImport,evaluateDataset'+(withHealth?',stockoutHistory,dataHealth':'')+'}',c)
 // Owner-approved Phase 4 substitutes only the model seam in historical code.
 if(!withHealth){c.phase4Model=api.demandModel;vm.runInContext('demandModel=phase4Model',c)}
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

test('actual lab excludes corrected whole project, preserving raw calendar and eligibility',()=>{
 const c=projects([30,30,30,60],[false,false,false,true],false,[31,31,30,10]),before=JSON.stringify(c.item),r=evaluate(c),h=r.physical.demand_history
 assert.deepEqual(h.corrected,[30,30,30,186]);assert.deepEqual(h.after_projects,[30,30,30,0])
 assert.deepEqual(h.eligible,[true,true,true,false]);assert.deepEqual(h.months,c.months)
 assert.equal(r.physical.monthly_demand,30);assert.equal(r.physical.runout_day,'2026-11-25');assert.equal(r.guidance.quantity,59)
 assert.deepEqual(h.trace.at(-1),{step:'project_exclusion',sku:'A',month:'2026-10',before:186,after:0})
 assert.equal(JSON.stringify(c.item),before)
 const thin=evaluate(projects([30,30,300],[false,false,true]));assert.equal(thin.guidance.quantity,null);assert.equal(thin.guidance.purchase_hold,true)
 const only=evaluate(projects(undefined,undefined,true));assert.equal(only.physical.demand_history.stockout_state,'hidden');assert.equal(only.guidance.quantity,59)
})

test('outlier is suggestion only, excludes project/censored observations from diagnostic sample',()=>{
 const c=projects([...Array(7).fill(30),300,30],Array(9).fill(false)),r=evaluate(c),h=r.physical.demand_history
 assert.deepEqual(h.outlier_suggestions,{state:'on',needs:'',chip:'Check spike',months:['2026-09']})
 assert.equal(h.project_excluded_count,0);assert(h.eligible.every(Boolean));assert.equal(r.physical.monthly_demand,120)
 const baseline=structuredClone(c);baseline.item.planning_facts.sales_history.forEach(row=>delete row.project)
 const before=evaluate(baseline)
 for(const key of ['quantity','order_by','runout_date','endpoint','safety_stock'])assert.equal(r.guidance[key],before.guidance[key])
 assert.deepEqual(r.physical.projection,before.physical.projection)
 c.item.planning_facts.sales_history.at(-2).project=true
 assert.deepEqual(evaluate(c).physical.demand_history.outlier_suggestions.months,[])
})

test('CSV project flags -> real bridge -> Desktop and per-SKU health gates',()=>{
 for(const only of [false,true]){
  const dir=fs.mkdtempSync(path.join(process.cwd(),'.scratch','f4-import-'))
  fs.writeFileSync(path.join(dir,'stock.csv'),'sku,name,unit,on_hand,supplier_days,2026-07,2026-08,2026-09,2026-10\nA,Synthetic,box,25,2,30,30,30,300\nB,Other,box,25,2,30,30,30,30\n')
  fs.writeFileSync(path.join(dir,'sales_history.csv'),only?'sku,month,quantity,project\nA,2026-07,30,false\nA,2026-08,30,false\nA,2026-09,30,false\nA,2026-10,300,true\n':'sku,month,quantity,in_stock_days,backorder,project\nA,2026-07,30,31,false,false\nA,2026-08,30,31,false,false\nA,2026-09,30,30,false,false\nA,2026-10,300,31,false,true\n')
  const py=spawnSync('/usr/bin/python3',['bundle_import.py',dir,'--today',today],{encoding:'utf8',env:{...process.env,TMPDIR:process.cwd()+'/.scratch'}})
  assert.equal(py.status,0,py.stderr)
  const d=api.parseStockImport(py.stdout),p=api.evaluateDataset(d,6)[0],g=api.orderGuidance(p,today),h=api.dataHealth(d,today)
  assert.equal(g.quantity,59);assert.equal(p.monthly_demand,30)
  assert.equal(h.features.project_exclusion.items.A.state,'on');assert.equal(h.features.project_exclusion.items.B.state,'hidden')
  assert.equal(h.features.stockout_correction.items.A.state,only?'hidden':'on')
 }
})

test('seeded full optional output parity across projects, censoring, supply, commitments and holds',()=>{
 let seed=740163;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n}
 const cases=[]
 for(let i=0;i<200;i++){
  const n=[3,4,7,12,13,24][rand(6)],sales=Array.from({length:n},()=>[0,.1,5.5,30,60,300][rand(6)]),flags=Array.from({length:n},()=>rand(5)===0)
  const c=projects(sales,flags,i%9===0);c.item.on_hand=rand(500)/2
  if(i%9!==0)c.item.planning_facts.sales_history.forEach(r=>{r.backorder=rand(3)===0;r.in_stock_days=r.quantity===0?rand(days(r.month)+1):1+rand(days(r.month))})
  if(i%7===0)c.item.planning_facts.sales_history.at(-1).project=null
  if(i%11===0)delete c.item.planning_facts.sales_history[0].project
  if(i%13===0)c.item.planning_facts.sales_history.pop()
  if(i%17===0)c.item.planning_facts.sales_history.at(-1).quantity+=1
  if(i%19===0)c.item.planning_facts.errors={project_exclusion:true}
  if(i%23===0)c.item.planning_facts.sales_history[0].month=['bad']
  if(i%5===0){Object.assign(c.item.planning_facts,{warehouses:['MAIN'],incoming_pos:[{po_line_id:'P',sku:'A',warehouse:'MAIN',supplier:'S',remaining_qty:rand(100),due_date:['2026-11-01','2026-11-20'][rand(2)],status:'confirmed'}]});c.today=['2026-11-01','2026-11-13'][rand(2)]}
  if(i%6===0)Object.assign(c.item.planning_facts,{warehouses:['MAIN'],customer_orders:[{order_line_id:'O',sku:'A',warehouse:'MAIN',quantity:rand(100),delivery_date:'2026-11-15',forecast_included:Boolean(rand(2)),status:'confirmed'}],stock_states:[{sku:'A',warehouse:'MAIN',damaged:0,reserved:0,quarantine:0,returns:0}]})
  c.settings={big_order_months:6,include_backup_in_orders:Boolean(rand(2)),months_of_cover:rand(5)/2,buffer_days:rand(10),product_overrides:{A:{pack_size:[1,.125,4][rand(3)]}}}
  cases.push(c)
 }
 const proto=projects();proto.item.sku='__proto__';proto.item.planning_facts.sales_history.forEach(r=>r.sku='__proto__');cases.push(proto)
 const py=spawnSync('/usr/bin/python3',['tests/phase2_bridge.py'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,TMPDIR:process.cwd()+'/.scratch'}})
 assert.equal(py.status,0,py.stderr)
 const expected=JSON.parse(py.stdout)
 cases.forEach((c,i)=>assert.deepEqual(evaluate(c),expected[i],`project seed ${i}: ${JSON.stringify(c)}`))
})

test('absent project frozen forecast bytes remain fa2da9e; guidance dates follow policy v2',()=>{
 const old=core(readBaseline('fa2da9e:desktop/plugin.js'),false)
 const corpus=JSON.parse(fs.readFileSync(new URL('../tests/golden/phase2-inputs.json',import.meta.url),'utf8'))
 for(const c of corpus.cases){
  const raw=structuredClone(c.item);raw.planning_facts?.sales_history?.forEach(row=>delete row.project)
  for(const settings of [{},{big_order_months:6,include_backup_in_orders:true}]){
   const p=api.calculate([raw],c.months,as_of,6,settings,today)[0],before=old.calculate([raw],c.months,as_of,6,settings,today)[0]
   // Exact calendar sums remove at most four ULP of historical projection drift.
   assertFrozenForecast(p,before)
   assertGuidanceDates(api,p,today,settings,as_of)
   assert.equal(Object.hasOwn(api.dataHealth({items:[raw],months:c.months,as_of},today).features,'project_exclusion'),false)
  }
 }
})

// The forecast contract is frozen; only the approved purchase policy changes.
test('absent sales history frozen forecast corpus remains aeecfd7 byte-identical',()=>{
 const previous=core(readBaseline('aeecfd7:desktop/plugin.js'),false)
 const corpus=JSON.parse(fs.readFileSync(new URL('../tests/golden/phase2-inputs.json',import.meta.url),'utf8'))
 for(const c of corpus.cases){
  const raw=structuredClone(c.item);delete raw.planning_facts?.sales_history
  for(const settings of [{},{big_order_months:6,include_backup_in_orders:true}]){
   const p=api.calculate([raw],c.months,as_of,6,settings,today)[0],before=previous.calculate([raw],c.months,as_of,6,settings,today)[0]
   assert.equal(JSON.stringify(forecastOnly(p)),JSON.stringify(forecastOnly(before)))
   assertGuidanceDates(api,p,today,settings,as_of)

  }
 }
})
