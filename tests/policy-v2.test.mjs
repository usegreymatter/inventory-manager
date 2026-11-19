import { readBaseline, baselineResult } from './baseline.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync,execFileSync} from 'node:child_process'
import {plain,shiftDay,assertGuidanceDates,orderUpTo,triggerDate,assertFrozenForecast} from './policy-v2-support.mjs'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+';this.api={calculate,orderGuidance,orderBucket}',ctx)
const api=ctx.api,months=['2026-08','2026-09','2026-10'],asOf='2026-10-31'
const base={sku:'T',name:'Synthetic',unit:'ea',on_hand:100,supplier_days:14,monthly_sales:[60,90,120],receipts:{}}
const history=(alias=false)=>[1,2,3,4,19].map(days=>alias?{ordered_date:'2026-01-01',received_date:shiftDay('2026-01-01',days),quantity:1}:{ordered_on:'2026-01-01',received_on:shiftDay('2026-01-01',days),quantity:1})
const cases=[
  {name:'sample sigma/default safety',item:base,settings:{}},
  ...[.9,.95,.99].map(service_level=>({name:`service ${service_level}`,item:base,settings:{service_level}})),
  {name:'safety off',item:base,settings:{include_backup_in_orders:false}},
  {name:'buffer additive',item:base,settings:{buffer_days:7}},
  {name:'zero cover overrides MOQ',item:base,settings:{months_of_cover:0,product_overrides:{T:{minimum_order:1000,pack_size:24}}}},
  {name:'five receipt spans',item:{...base,receipt_history:history()},settings:{}},
  {name:'receipt date aliases',item:{...base,receipt_history:history(true)},settings:{}},
  {name:'four spans no variance',item:{...base,receipt_history:history().slice(0,4)},settings:{}},
  {name:'invalid spans do not reach five',item:{...base,receipt_history:[...history().slice(0,4),{ordered_on:'bad',received_on:'2026-01-20'},{ordered_on:'2026-02-01',received_on:'2026-01-01'}]},settings:{}},
  ...[1,100,500].map(on_order=>({name:`undated incoming ${on_order}`,item:{...base,on_order},settings:{}})),
  ...[0,-1,null,'1',true].map(quantity=>({name:`invalid receipt quantity ${quantity}`,item:{...base,receipt_history:history().map(r=>({...r,quantity}))},settings:{}})),
  {name:'future receipt spans',item:{...base,receipt_history:history().map(r=>({...r,ordered_on:'2026-11-01',received_on:shiftDay('2026-11-01',19)}))},settings:{}},
  {name:'dated monthly receipt',item:{...base,receipts:{'2026-12':100}},settings:{}},
  {name:'long lead no widened bucket',item:{...base,on_hand:1000,supplier_days:90},settings:{include_backup_in_orders:false}},
  {name:'beyond chart horizon',item:{...base,on_hand:10000},settings:{}},
  {name:'fractional lead',item:{...base,supplier_days:14.5},settings:{}},
]
function evaluate(c){
 const row=api.calculate([c.item],months,asOf,1,c.settings,asOf)[0]
 return {row,guidance:api.orderGuidance(row,asOf,c.settings),bucket:api.orderBucket(row,asOf,c.settings)}
}
const child=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import json,sys,engine
out=[]
for c in json.load(sys.stdin):
 r=engine.forecast(c['item'],['2026-08','2026-09','2026-10'],'2026-10-31',horizon=1,settings=c['settings'],today='2026-10-31')
 r={**c['item'],**r,'as_of':'2026-10-31'}
 out.append(dict(guidance=engine.order_guidance(r,'2026-10-31',c['settings']),bucket=engine.order_bucket(r,'2026-10-31',c['settings'])))
print(json.dumps(out))`],{cwd:new URL('../',import.meta.url),input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8*1024*1024})
test('policy v2 Python bridge exits and covers every focused case',()=>{assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).length,cases.length)})
const expected=child.status===0?JSON.parse(child.stdout):[]
for(const [i,c] of cases.entries())test(`policy v2 parity and independent quantity: ${c.name}`,()=>{
 const {row,guidance:g,bucket}=evaluate(c)
 assert.deepEqual(plain({guidance:g,bucket}),expected[i])
 assertGuidanceDates(api,row,asOf,c.settings)
 assert.equal(g.quantity,orderUpTo(row,g,c.settings))
 const crossing=triggerDate(row,asOf,c.settings.include_backup_in_orders===false?0:g.safety_stock)
 const due=shiftDay(crossing,-Math.ceil(c.item.supplier_days))
 assert.equal(g.order_by,g.quantity===0?null:due<=asOf?'now':due)
 assert.equal(g.order_date,due<=asOf?asOf:due)
 assert.equal(g.endpoint,shiftDay(g.order_date,g.lead_days+Math.ceil((c.settings.months_of_cover??2)*30)))
})
test('af2b1c7 sample forecasts stay frozen over 180 horizon/settings cases',()=>{
 const baseline=readBaseline('af2b1c7:desktop/plugin.js')
 const old=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
 vm.runInContext(baseline.slice(baseline.indexOf('const SAMPLE ='),baseline.indexOf('const pageStyle =')).replaceAll('export ','')+';this.api={calculate}',old)
 const sample=JSON.parse(fs.readFileSync(new URL('../data/sample.json',import.meta.url),'utf8'))
 let count=0
 for(let horizon=1;horizon<=12;horizon++)for(const settings of [{},{service_level:.99,months_of_cover:3},{include_backup_in_orders:false,buffer_days:7}]){
  const actual=api.calculate(sample.items,sample.months,asOf,horizon,settings,asOf)
  const before=old.api.calculate(sample.items,sample.months,asOf,horizon,settings,asOf)
  actual.forEach((row,i)=>{assertFrozenForecast(row,before[i]);count++})
 }
 assert.equal(count,180)
})
test('frozen forecast guard rejects changed model and material projection demand',()=>{
 const row={monthly_demand:30,forecast_explanation:'Steady',projection:[{demand:30,stock:10}]}
 assert.throws(()=>assertFrozenForecast({...row,monthly_demand:31},row))
 assert.throws(()=>assertFrozenForecast({...row,forecast_explanation:'Other'},row))
 assert.throws(()=>assertFrozenForecast({...row,projection:[{demand:30.000001,stock:10}]},row))
})
test('sample n-1 sigma, lead/review variance and ROP are independently recomputed',()=>{
 const g=evaluate(cases[0]).guidance
 const sigma=Math.sqrt(((60-90)**2+(90-90)**2+(120-90)**2)/2)
 const ss=Math.ceil(1.6449*sigma*Math.sqrt(44/30))
 assert.equal(g.demand_swing,sigma);assert.equal(g.safety_stock,ss);assert.equal(ss,60)
 assert.equal(g.reorder_point,Math.ceil(90*14/30+ss))
 assert.equal(g.order_by,'now');assert.equal(g.endpoint,'2027-01-13');assert.equal(g.quantity,178)
 assert.equal(evaluate(cases.find(c=>c.name==='safety off')).guidance.reorder_point,42)
})
test('service level changes safety stock and default purchase quantity, not physical demand',()=>{
 const rows=[.9,.95,.99].map(service_level=>evaluate({item:base,settings:{service_level}}))
 for(const [i,z] of [1.2816,1.6449,2.3263].entries()){
  assert.equal(rows[i].guidance.safety_stock,Math.ceil(z*30*Math.sqrt(44/30)))
  assert.deepEqual(plain(rows[i].row.projection),plain(rows[0].row.projection))
  if(i>0) assert.ok(rows[i].guidance.quantity>rows[i-1].guidance.quantity)
 }
})
test('receipt lead variance needs five valid spans and supports both date aliases',()=>{
 const get=name=>evaluate(cases.find(c=>c.name===name)).guidance
 const spans=[1,2,3,4,19],mean=spans.reduce((a,b)=>a+b,0)/spans.length
 const variance=spans.reduce((sum,v)=>sum+(v-mean)**2,0)/(spans.length-1)
 const ss=Math.ceil(1.6449*Math.sqrt(30**2*44/30+3**2*variance))
 for(const name of ['five receipt spans','receipt date aliases']){
  const g=get(name);assert.equal(g.safety_stock,ss);assert.equal(g.safety_stock_provenance.lead_time_variability,'receipt history')
 }
 for(const c of cases.filter(c=>c.name.startsWith('invalid receipt quantity')||c.name==='future receipt spans')){
  const g=evaluate(c).guidance;assert.equal(g.safety_stock,60);assert.equal(g.safety_stock_provenance.receipt_samples,0)
 }
 for(const name of ['four spans no variance','invalid spans do not reach five']){
  const g=get(name);assert.equal(g.safety_stock,60);assert.equal(g.safety_stock_provenance.receipt_samples,4)
 }
})
test('on_order defers the trigger/window rather than suppressing a future purchase',()=>{
 const g=evaluate(cases.find(c=>c.name==='undated incoming 500')).guidance
 assert.equal(g.order_date,g.order_by);assert.ok(g.order_by>asOf)
 assert.equal(g.undated_on_order_assumed_within_lead,true)
 assert.ok(g.quantity>0);assert.equal(g.inventory_position,600)
 assert.equal(g.runout_date,evaluate(cases[0]).guidance.runout_date)
})
test('bucket depends on order-by +7/+30, not a lead-sized urgency window',()=>{
 const c=cases.find(c=>c.name==='long lead no widened bucket'),{row,guidance:g}=evaluate(c)
 assert.equal(api.orderBucket(row,shiftDay(g.order_by,-31),c.settings),'healthy')
 assert.equal(api.orderBucket(row,shiftDay(g.order_by,-30),c.settings),'running-low')
 assert.equal(api.orderBucket(row,shiftDay(g.order_by,-8),c.settings),'running-low')
 assert.equal(api.orderBucket(row,shiftDay(g.order_by,-7),c.settings),'order')
})
