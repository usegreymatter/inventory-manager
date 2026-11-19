import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {calendarTotal,shiftDay,plain} from './policy-v2-support.mjs'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const context=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+';this.api={orderGuidance,whyBreakdown}',context)
const asOf='2026-10-31',base={sku:'MRP',name:'Synthetic',unit:'ea',as_of:asOf,on_hand:150,supplier_days:30,monthly_sales:[100,100,100],monthly_demand:100,seasonal:false,receipts:{}}
const guide=(item,settings={})=>context.api.orderGuidance(item,asOf,settings)
const po=(date,qty,id)=>({po_line_id:id,sku:'MRP',warehouse:'MAIN',supplier:'S',remaining_qty:qty,due_date:date,status:'confirmed'})
const facts=rows=>({version:'1.0',warehouses:['MAIN'],incoming_pos:rows})
test('MRP example retains trigger, nets within window, ignores receipt after endpoint',()=>{
 const before=guide(base),inside=guide({...base,receipts:{'2027-01':300}}),after=guide({...base,receipts:{'2027-03':300}})
 assert.equal(before.order_by,'2026-11-16');assert.equal(inside.order_by,before.order_by);assert.equal(after.order_by,before.order_by)
 assert.equal(before.quantity,200);assert.equal(after.quantity,200);assert.equal(inside.quantity,54)
 assert.equal(inside.endpoint,'2027-02-14')
})
test('same-day receipts excluded together; arrival receipt already included',()=>{
 assert.equal(guide({...base,planning_facts:facts([po('2027-01-01',150,'1'),po('2027-01-01',150,'2')])}).quantity,54)
 assert.equal(guide({...base,planning_facts:facts([po('2026-12-16',10,'A'),po('2027-02-14',300,'E')])}).quantity,190)
})
test('exact fractional annual skip s11/32 regression orders by 2033-01-23',()=>{
 const g=guide({...base,sku:'s11/32',on_hand:22,on_order:22.42258064516129-22,supplier_days:0,monthly_sales:[.3,.3,.3],monthly_demand:.3},{include_backup_in_orders:false})
 assert.equal(g.order_by,'2033-01-23')
})
test('Why ledger explains netting separately from pack rounding',()=>{
 const rows=context.api.whyBreakdown({...base,receipts:{'2027-01':300}},asOf,{})
 assert.equal(rows.reduce((s,r)=>s+r.qty,0),54)
 assert.ok(rows.find(r=>r.key==='dated_receipt_netting').qty<0)
 assert.ok(rows.find(r=>r.key==='pack_rounding').qty>=0)
})
// Deterministic synthetic random items: both canonical dated POs and monthly
// receipt maps, with fractional sales, buffer, MOQ, packs and safety opt-out.
let state=932017
const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n}
const cases=Array.from({length:50},(_,i)=>{
 const sales=Array.from({length:3},()=>random(1000)/10),receipts={}
 const rows=Array.from({length:4},(_,j)=>po(shiftDay(asOf,1+random(180)),random(2000)/10,String(j)))
 if(i%2)for(const r of rows)receipts[r.due_date.slice(0,7)]=(receipts[r.due_date.slice(0,7)]||0)+r.remaining_qty
 const item={...base,on_hand:random(200),on_order:i%2?random(100)/10:0,supplier_days:random(61),monthly_sales:sales,monthly_demand:sales.reduce((a,b)=>a+b,0)/3,receipts,...(i%2?{}:{planning_facts:facts(rows)})}
 const settings={months_of_cover:(1+random(6))/2,buffer_days:random(15),include_backup_in_orders:random(2)===1,product_overrides:{MRP:{pack_size:[.1,1,12][random(3)],minimum_order:random(40)}}}
 return {item,settings}
})
const child=spawnSync('/usr/bin/python3',['-c',`import engine,json,sys
print(json.dumps([engine.order_guidance(c['item'],'2026-10-31',c['settings']) for c in json.load(sys.stdin)]))`],{cwd:new URL('../',import.meta.url),input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8*1024*1024})
test('50 random dated-receipt items agree exactly in Python and JS and with daily-prefix oracle',()=>{
 assert.equal(child.status,0,child.stderr)
 const expected=JSON.parse(child.stdout);assert.equal(expected.length,50)
 for(const [i,c] of cases.entries()){
  const g=guide(c.item,c.settings);assert.deepEqual(plain(g),expected[i],`case ${i}`)
  assert.notEqual(g.status,'needs-data',`case ${i}: ${g.reason}`)
  const supply=c.item.planning_facts?.incoming_pos.map(r=>({date:r.due_date,quantity:r.remaining_qty}))??Object.entries(c.item.receipts).map(([m,q])=>({date:m+'-01',quantity:q}))
  const buffer=calendarTotal(c.item,asOf,shiftDay(g.endpoint,c.settings.buffer_days))-calendarTotal(c.item,asOf,g.endpoint)
  let maxNeed=0
  const arrival=shiftDay(g.order_date,g.lead_days)
  for(let day=arrival;day<=g.endpoint;day=shiftDay(day,1)){
   const pre=day>arrival&&supply.some(r=>r.date===day)
   const incoming=supply.filter(r=>pre?r.date<day:r.date<=day).reduce((s,r)=>s+r.quantity,0)
   maxNeed=Math.max(maxNeed,(c.settings.include_backup_in_orders?g.safety_stock:0)+calendarTotal(c.item,asOf,day)+buffer-c.item.on_hand-c.item.on_order-incoming)
  }
  const o=c.settings.product_overrides.MRP
  const quantity=maxNeed<=0?0:Math.ceil((Math.max(maxNeed,o.minimum_order)-1e-9)/o.pack_size)*o.pack_size
  assert.ok(Math.abs(g.quantity-quantity)<1e-8,`independent quantity case ${i}: ${g.quantity} vs ${quantity}`)
 }
})
