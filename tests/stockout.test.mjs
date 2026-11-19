import { readBaseline, baselineResult } from './baseline.mjs'
import assert from 'node:assert/strict'
import {forecastOnly,assertGuidanceDates,orderUpTo} from './policy-v2-support.mjs'
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
const physicalKeys=['held','sku','name','unit','stock','monthly_demand','seasonal','forecast_explanation','runout_month','runout_day','order_by','order_overdue','error_percent','grade','projection','receipts','demand_swing','safety_stock','safety_stock_provenance','reorder_point','eoq','why','lead_demand','planning_facts','purchase_hold','late_po_quantity','overdue_order_quantity','committed_quantity','inventory_position','suggested_order','covered_by_on_order','big_order','on_order','reason','demand_history']
function evaluate(c){
 const p=api.calculate([c.item],c.months,c.as_of,6,c.settings||{},c.today)[0],g=api.orderGuidance(p,c.today,c.settings||{},c.as_of)
 return plain({physical:Object.fromEntries(physicalKeys.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])),guidance:g,bucket:api.orderBucket(p,c.today,c.settings||{},c.as_of),health:api.dataHealth({items:[p],as_of:c.as_of,months:c.months},c.today,c.settings||{})})
}

test('actual cleaning lab affects projection, runout, safety and order once',()=>{
 const c=annotated([30,30,30],[31,30,15]);c.settings.include_backup_in_orders=true
 const before=JSON.stringify(c.item),r=evaluate(c)
 assert.deepEqual(r.physical.demand_history.corrected,[30,30,62])
 assert.equal(r.physical.runout_day,'2026-11-19');assert.equal(r.guidance.runout_date,'2026-11-19')
 const sigma=Math.sqrt(((30-122/3)**2+(30-122/3)**2+(62-122/3)**2)/2)
 assert.equal(r.physical.safety_stock,Math.ceil(1.6449*sigma*Math.sqrt(32/30)))
 assert.equal(r.physical.suggested_order,r.guidance.quantity)
 assert.equal(r.guidance.quantity,orderUpTo({...c.item,...r.physical},r.guidance,c.settings))
 assert.equal(JSON.stringify(c.item),before)
})

test('censored month retains raw calendar and uses three eligible observations',()=>{
 const c=annotated([30,30,30,0],[31,31,30,0]),r=evaluate(c)
 assert.equal(r.physical.monthly_demand,30);assert.equal(r.physical.seasonal,false)
 assert.deepEqual(r.physical.demand_history.eligible,[true,true,true,false])
 assert.deepEqual(r.physical.demand_history.months,c.months)
 assert.equal(r.guidance.quantity,59)
 const thin=evaluate(annotated([30,30,0],[31,30,0]))
 assert.equal(thin.guidance.status,'needs-data');assert.equal(thin.guidance.quantity,null)
 assert.equal(thin.physical.demand_history.state,'locked')
})

test('source CSV -> actual bridge import -> adopted Desktop output and health gate',()=>{
 const dir=fs.mkdtempSync(path.join(process.cwd(),'.scratch','f3-import-'))
 fs.writeFileSync(path.join(dir,'stock.csv'),'sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nA,Synthetic,box,25,2,30,30,30\nB,Other,box,25,2,30,30,30\n')
 fs.writeFileSync(path.join(dir,'sales_history.csv'),'sku,month,quantity,in_stock_days,backorder\nA,2026-08,30,31,false\nA,2026-09,30,30,false\nA,2026-10,30,15,false\n')
 const child=spawnSync(process.env.PYTHON||'/usr/bin/python3',['bundle_import.py',dir,'--today',today],{encoding:'utf8',env:{...process.env,TMPDIR:process.cwd()+'/.scratch'}})
 assert.equal(child.status,0,child.stderr)
 const data=api.parseStockImport(child.stdout),p=api.evaluateDataset(data,6)[0]
 assert.equal(p.monthly_demand,122/3);assert.equal(p.runout_day,'2026-11-19')
 const gates=api.dataHealth(data,today).features.stockout_correction.items
 assert.equal(gates.A.state,'on');assert.equal(gates.B.state,'hidden')
})

test('complete 24-month cleaned history uses sample-sigma safety, not removed lead-demand quantiles',()=>{
 const c=annotated(Array.from({length:24},(_,i)=>i%3===0?0:10),Array(24).fill(15))
 c.settings.include_backup_in_orders=true
 const actual=evaluate(c)
 assert.equal(Object.hasOwn(actual.physical,'lead_demand'),false)
 assert.equal(Object.hasOwn(actual.guidance,'lead_demand'),false)
 const tail=actual.physical.demand_history.corrected.slice(-12),mean=tail.reduce((a,b)=>a+b,0)/tail.length
 const sigma=Math.sqrt(tail.reduce((sum,v)=>sum+(v-mean)**2,0)/(tail.length-1))
 assert.equal(actual.physical.safety_stock,Math.ceil(1.6449*sigma*Math.sqrt(32/30)))
 assert.equal(actual.guidance.safety_stock,actual.physical.safety_stock)
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['tests/phase2_bridge.py'],{input:JSON.stringify([c]),encoding:'utf8'})
 assert.equal(py.status,0,py.stderr)
 assert.deepEqual(actual,JSON.parse(py.stdout)[0])
})

test('seeded complete optional physical/guidance/health parity including cleaning trace',()=>{
 let seed=621307;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n}
 const cases=[]
 for(let i=0;i<210;i++){
  const n=[3,4,7,12,13,24][rand(6)],sales=Array.from({length:n},()=>[0,0.1,5.5,30,60,100][rand(6)])
  const c=annotated(sales);c.item.on_hand=rand(500)/2
  c.item.planning_facts.sales_history.forEach(r=>{r.backorder=Boolean(rand(3)===0);r.in_stock_days=r.quantity===0?rand(days(r.month)+1):1+rand(days(r.month))})
  if(i%7===0)c.item.planning_facts.sales_history.at(-1).backorder=null
  if(i%11===0)c.item.planning_facts.sales_history.pop()
  if(i%13===0)c.item.planning_facts.sales_history.at(-1).in_stock_days=0
  if(i%17===0)c.item.planning_facts.sales_history.at(-1).quantity+=1
  if(i%19===0)c.item.planning_facts.sales_history[0].month=['bad']
  if(i%23===0)c.item.planning_facts.errors={stockout_correction:['history_coverage']}
  if(i%5===0){
   Object.assign(c.item.planning_facts,{warehouses:['MAIN'],incoming_pos:[{po_line_id:'P',sku:'A',warehouse:'MAIN',supplier:'S',remaining_qty:rand(100),due_date:['2026-11-01','2026-11-20'][rand(2)],status:'confirmed'}]})
   c.today=['2026-11-01','2026-11-13'][rand(2)]
  }
  if(i%6===0){
   Object.assign(c.item.planning_facts,{warehouses:['MAIN'],customer_orders:[{order_line_id:'O',sku:'A',warehouse:'MAIN',quantity:rand(100),delivery_date:'2026-11-15',forecast_included:Boolean(rand(2)),status:'confirmed'}],stock_states:[{sku:'A',warehouse:'MAIN',damaged:0,reserved:0,quarantine:0,returns:0}]})
  }
  c.settings={big_order_months:6,include_backup_in_orders:Boolean(rand(2)),months_of_cover:rand(5)/2,buffer_days:rand(12),product_overrides:{A:{pack_size:[1,.125,4][rand(3)]}}}
  cases.push(c)
 }
 const cap=annotated([1e12,1e12,1e12],[1,1,1]);cases.push(cap)
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['tests/phase2_bridge.py'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,TMPDIR:process.cwd()+'/.scratch'}})
 assert.equal(py.status,0,py.stderr)
 const expected=JSON.parse(py.stdout)
 cases.forEach((c,i)=>assert.deepEqual(evaluate(c),expected[i],`stockout seed ${i}: ${JSON.stringify(c)}`))
})

test('absent exposure frozen forecast bytes remain aeecfd7; dates follow policy v2',()=>{
 const old=core(readBaseline('aeecfd7:desktop/plugin.js'),false)
 // All 19 cases, including seasonal demand/model/backtest/projection fields.
 const corpus=JSON.parse(fs.readFileSync(new URL('./golden/phase2-inputs.json',import.meta.url),'utf8'))
 assert.equal(corpus.cases.length,19)
 for(const c of corpus.cases){
  for(const noFacts of [false,true]){
  const raw=structuredClone(c.item);delete raw.planning_facts?.sales_history
  if(noFacts)delete raw.planning_facts
  for(const settings of [{},{big_order_months:6,include_backup_in_orders:true}]){
   const p=api.calculate([raw],c.months,as_of,6,settings,today)[0],before=old.calculate([raw],c.months,as_of,6,settings,today)[0]
   assert.equal(JSON.stringify(forecastOnly(p)),JSON.stringify(forecastOnly(before)))
   assertGuidanceDates(api,p,today,settings,as_of)
  }
  }
 }
})
