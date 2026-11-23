import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
import reviewedFeatures from './reviewed-v12-delta.cjs'
import beforeV122 from './reviewed-v122-delta.cjs'
const beforeReviewedFeatures=(source,kind)=>reviewedFeatures(beforeV122(source,kind),kind)
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const context=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll(/export /g,'')+'\nthis.api={previewIndustryPreset,normalizeOrderSettings,validateOrderSettings,resolveOrderSettings,orderGuidance,calculate,parseCsv,PROFIT_ORDER}',context)
const api=context.api,plain=v=>JSON.parse(JSON.stringify(v)),asOf='2026-10-31'
const months=Array.from({length:12},(_,i)=>i<2?'2025-'+(i+11):'2026-'+String(i-1).padStart(2,'0'))
const mk=(sku,lead=10)=>({sku,name:sku,unit:'u',monthly_sales:months.map(()=>100),on_hand:100,on_order:0,supplier_days:lead,receipts:{}})
const prepared=(item,settings={})=>({...api.calculate([item],months,asOf,6,settings)[0],as_of:asOf})
const guidance=(item,settings={})=>api.orderGuidance(prepared(item,settings),asOf,settings,asOf)
const conflict='Shelf-life cap conflicts with the minimum order or pack size; using standard amount.'
const shortLife='Shelf life is too short for any order to be sold in time; using standard amount.'
function python(value,code){
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c','import engine,profit_order,json,sys\nx=json.load(sys.stdin)\n'+code],{input:JSON.stringify(value),encoding:'utf8',cwd:new URL('..',import.meta.url)})
 assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout)
}
test('default-off outputs and explanations are byte-identical to the immutable pre-fix checkpoint without Git history',()=>{
 const run=s=>{
  const c=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
  vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replaceAll('export ','')+`\nthis.result=JSON.stringify([{}, {profit_suggestion:false}, {review_days:90,months_of_cover:3}, {product_overrides:{'CAP':{pack_size:12,minimum_order:12}}}].map(settings=>{
   const data=[...SAMPLE.items,{sku:'CAP',name:'Synthetic',unit:'u',monthly_sales:SAMPLE.months.map(()=>300),on_hand:0,on_order:0,supplier_days:10,unit_cost:1,sale_price:100,shelf_life_days:1,receipts:{}}];
   const items=calculate(data,SAMPLE.months,SAMPLE.as_of,6,settings,SAMPLE.as_of);
   return {items,guidance:items.map(i=>orderGuidance({...i,as_of:SAMPLE.as_of},SAMPLE.as_of,settings)),why:items.map(i=>whyThisAmount({...i,as_of:SAMPLE.as_of},SAMPLE.as_of,settings))};
  }));`,c)
  return c.result
 }
 assert.equal(run(source),run(beforeReviewedFeatures(source,'plugin')))
 const originalEngine=beforeReviewedFeatures(fs.readFileSync(new URL('../engine.py',import.meta.url),'utf8'),'engine')
 assert.equal(originalEngine,fs.readFileSync(new URL('./fixtures/baselines/50e8117/engine.py',import.meta.url),'utf8'))
 assert.throws(()=>beforeReviewedFeatures(source.replace('if(floor>old&&floor<=36)','if(floor>=old&&floor<=36)'),'plugin'))
 assert.notEqual(beforeReviewedFeatures(source+'\nUNREVIEWED MUTATION','plugin'),beforeReviewedFeatures(source,'plugin'))
})
test('H1 computed shelf cap constrains suggestions, with explicit MOQ/pack conflict and Python parity',()=>{
 const results=[]
 for(const [minimum_order,pack_size] of [[12,12],[0,12],[12,1],[1,1],[0,.5]]){
  const item={...mk('CAP'),monthly_sales:months.map(()=>300),on_hand:0,unit_cost:1,sale_price:100,shelf_life_days:1,minimum_order,pack_size}
  const settings={profit_suggestion:true,review_days:7},g=plain(guidance(item,settings))
  assert.equal(g.shelf_cap_qty,pack_size===12?0:10)
  if(pack_size===12||minimum_order===12){assert.equal(g.profit_suggestion,undefined);assert.equal(g.profit_suggestion_unavailable,g.shelf_cap_qty===0?shortLife:conflict)}
  else {assert.ok(g.profit_suggestion);assert.ok(g.profit_suggestion.qty<=g.shelf_cap_qty);for(const a of g.profit_suggestion.alt)assert.ok(a.qty<=g.shelf_cap_qty)}
  const standard=plain(guidance(item,{...settings,profit_suggestion:false}))
  const ordinary={...g};delete ordinary.profit_suggestion;delete ordinary.profit_suggestion_unavailable
  assert.deepEqual(ordinary,standard)
  results.push({item,settings,g})
 }
 const py=python({results,months,asOf},"out=[]\nfor c in x['results']:\n i=c['item'];s=c['settings'];p=engine.forecast(i,x['months'],x['asOf'],settings=s)\n g=engine.order_guidance({**i,**p,'as_of':x['asOf']},x['asOf'],s)\n out.append(g)\nprint(json.dumps(out))")
 assert.deepEqual(results.map(r=>r.g),py)
})
test('H1 adapter forwards computed fractional and zero caps, and checks rounded MOQ boundary',()=>{
 const item=prepared({...mk('ADAPTER'),unit_cost:1,sale_price:20}),settings=api.normalizeOrderSettings({profit_suggestion:true}),resolved=api.resolveOrderSettings(item,settings)
 for(const cap of [0,10.25]){
  let spec
  const r=api.PROFIT_ORDER.forGuidance(item,{quantity:0,lead_days:10,shelf_cap_qty:cap},settings,resolved,null,null,s=>{spec=plain(s);return {qty:0,reason:'probe'}})
  if(cap===0){assert.equal(r,null);assert.equal(api.PROFIT_ORDER.unavailableReason(item,settings,{shelf_cap_qty:cap},resolved),shortLife)}
  else assert.equal(spec.shelf_cap_qty,cap)
 }
 const fractional=api.resolveOrderSettings(item,{profit_suggestion:true,product_overrides:{ADAPTER:{pack_size:.6,minimum_order:1}}})
 assert.equal(api.PROFIT_ORDER.unavailableReason(item,settings,{shelf_cap_qty:1.1},fractional),conflict)
})
test('M1 long supplier lead never raises other products or global cover; review floors are product-only',()=>{
 const items=[...Array.from({length:9},(_,i)=>mk('S'+i)),mk('SLOW',300)],current=api.normalizeOrderSettings({})
 const ds={items,months,as_of:asOf},p=api.previewIndustryPreset(current,'grocery',ds,asOf)
 assert.equal(p.next.months_of_cover,2)
 assert.deepEqual(plain(p.next.product_overrides),{})
 assert.equal(p.impact.before_quantity,2830);assert.equal(p.impact.after_quantity,2830);assert.equal(p.impact.affected_products,0)
 const settings=api.normalizeOrderSettings({product_overrides:{SLOW:{review_days:90,pack_size:3}},supplier_overrides:{Shared:{review_days:120}}})
 const mixed={...ds,items:items.map(i=>i.sku==='S0'?{...i,supplier:'Shared'}:i)}
 const q=api.previewIndustryPreset(settings,'grocery',mixed,asOf)
 assert.equal(q.next.months_of_cover,2)
 assert.deepEqual(plain(q.next.product_overrides),{SLOW:{review_days:90,pack_size:3,months_of_cover:3},S0:{months_of_cover:4}})
 assert.deepEqual(plain(api.validateOrderSettings(plain(q.next))),plain(q.next))
 assert.equal(JSON.stringify(settings.product_overrides),JSON.stringify({SLOW:{review_days:90,pack_size:3}}))
 const before=mixed.items.map(i=>guidance(i,settings).quantity),after=mixed.items.map(i=>guidance(i,q.next).quantity)
 assert.equal(q.impact.affected_products,after.filter((v,i)=>v!==before[i]).length)
 assert.equal(q.impact.after_quantity,after.reduce((a,b)=>a+b,0))
 assert.equal(q.changes.filter(c=>c.sku).length,2)
 assert.ok(q.changes.every(c=>!c.why.includes('plus delivery')))
 const py=python({items:mixed.items,months,asOf,settings:plain(q.next)},"s=engine.validate_order_settings(x['settings']);out=[]\nfor i in x['items']:\n p=engine.forecast(i,x['months'],x['asOf'],settings=s)\n out.append(engine.order_guidance({**i,**p,'as_of':x['asOf']},x['asOf'],s)['quantity'])\nprint(json.dumps(out))")
 assert.deepEqual(after,py)
})
test('M1 equal-global product cover is quantity-identical; invalid product and supplier cover rejected in both runtimes',()=>{
 for(const cover of [0,.25,2,3,36]){
  const item=mk('SAME'),base={months_of_cover:cover},override={...base,product_overrides:{SAME:{months_of_cover:cover}}}
  assert.equal(guidance(item,override).quantity,guidance(item,base).quantity)
  assert.equal(api.resolveOrderSettings(item,override).settings.months_of_cover,cover)
  assert.deepEqual(plain(api.validateOrderSettings(override).product_overrides),override.product_overrides)
 }
 const py=python({item:mk('SAME'),months,asOf},"out=[]\nfor cover in [0,.25,2,3,36]:\n s={'months_of_cover':cover};o={**s,'product_overrides':{'SAME':{'months_of_cover':cover}}};engine.validate_order_settings(o)\n p=engine.forecast(x['item'],x['months'],x['asOf'])\n i={**x['item'],**p,'as_of':x['asOf']}\n out.append(engine.order_guidance(i,x['asOf'],s)['quantity']==engine.order_guidance(i,x['asOf'],o)['quantity'])\nprint(json.dumps(out))")
 assert.deepEqual(py,[true,true,true,true,true])
 for(const v of [-1,37,true,null,'3'])assert.throws(()=>api.validateOrderSettings({product_overrides:{SAME:{months_of_cover:v}}}))
 assert.throws(()=>api.validateOrderSettings({supplier_overrides:{Shared:{months_of_cover:3}}}))
})
test('M1 existing product cover keeps its own floor and does not leak to other products',()=>{
 const item=mk('OWN'),settings=api.normalizeOrderSettings({months_of_cover:4,product_overrides:{OWN:{months_of_cover:1,review_days:90}}})
 const p=api.previewIndustryPreset(settings,'grocery',{items:[item],months,as_of:asOf},asOf)
 assert.equal(p.next.months_of_cover,4)
 assert.equal(p.next.product_overrides.OWN.months_of_cover,3)
 assert.equal(p.impact.affected_products,1)
})
test('M1 supplied reviewer CSV no longer gains lead twice in its preset floor',()=>{
 const csv='sku,name,unit,on_hand,on_order,supplier_days,unit_cost,sale_price,'+months.join(',')+'\n'+['A','B'].map(s=>[s,'Syn '+s,'ea',20,0,10,4,10,...months.map(()=>150)].join(',')).join('\n')+'\n'
 const ds=api.parseCsv(csv),current=api.normalizeOrderSettings({review_days:90}),p=api.previewIndustryPreset(current,'grocery',ds,ds.as_of)
 assert.equal(p.next.months_of_cover,2)
 assert.deepEqual(plain(p.next.product_overrides),{A:{months_of_cover:3},B:{months_of_cover:3}})
 assert.equal(p.impact.affected_products,2)
})
