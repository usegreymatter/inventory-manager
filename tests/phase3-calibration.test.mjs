import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
const lab=createRequire(import.meta.url)('../forecast_lab.js')
const src=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(src.slice(src.indexOf('const SAMPLE ='),src.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={forecastSelection,forecastDetails,inventoryPlanning}',ctx)
const near=(a,b)=>{if(typeof b==='number')assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((x,i)=>near(a[i],x))}else if(b&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k in b)near(a[k],b[k])}else assert.equal(a,b)}
const plain=x=>JSON.parse(JSON.stringify(x))
test('calendar table, optional seasonal challenger and routing classes match Python',()=>{
 let seed=273;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%100)
 const items=Array.from({length:24},(_,i)=>({sku:'C'+i,name:'Synthetic',unit:'box',on_hand:0,monthly_sales:Array.from({length:60+i},(_,j)=>i%3?10+random()/10:10+(j%12===i%12?90:0)),calendar_forecast:i%2===0}))
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import forecast_lab as lab,engine,json,sys
items=json.load(sys.stdin)
print(json.dumps(dict(table=lab.HOLIDAY_STARTS,classes=lab.inventory_classes(items),forecasts=[lab.calendar_seasonal(x['monthly_sales'],'2026-10',12) for x in items],selection=[engine.forecast_selection(x,'2026-10') for x in items])))`],{input:JSON.stringify(items),encoding:'utf8',maxBuffer:10*1024*1024})
 assert.equal(p.status,0,p.stderr);const expected=JSON.parse(p.stdout)
 near(lab.HOLIDAY_STARTS,expected.table);near(lab.inventory_classes(items),expected.classes)
 items.forEach((x,i)=>{near(lab.calendar_seasonal(x.monthly_sales,'2026-10',12),expected.forecasts[i]);near(plain(ctx.api.forecastSelection(x,'2026-10')),expected.selection[i])})
})
test('lead-time quantiles: fixed seed resampling and normal approximation port parity',()=>{
 const samples=Array.from({length:24},(_,i)=>({sales:i%2?[8,12].flatMap(x=>Array(12).fill(x)):Array.from({length:36},(_,j)=>j%5?0:10+i),lead:[0,15,30,60,91.5,3650][i%6],service:[.9,.95,.99][i%3]}))
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import forecast_lab as lab,json,sys
print(json.dumps([lab.lead_demand_quantile(x['sales'],x['lead'],x['service']) for x in json.load(sys.stdin)]))`],{input:JSON.stringify(samples),encoding:'utf8'})
 assert.equal(p.status,0,p.stderr);const expected=JSON.parse(p.stdout)
 samples.forEach((x,i)=>near(lab.lead_demand_quantile(x.sales,x.lead,x.service),expected[i]))
 const items=samples.map((x,i)=>({sku:'L'+i,name:'Synthetic',unit:'box',on_hand:0,supplier_days:x.lead,monthly_sales:x.sales,receipts:{}}))
 const ip=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json,sys
print(json.dumps([engine.inventory_planning(x,'2026-10',dict(include_backup_in_orders=True)) for x in json.load(sys.stdin)]))`],{input:JSON.stringify(items),encoding:'utf8'})
 assert.equal(ip.status,0,ip.stderr);JSON.parse(ip.stdout).forEach((x,i)=>near(plain(ctx.api.inventoryPlanning(items[i],'2026-10',{include_backup_in_orders:true})),x))
 assert.equal(lab.lead_demand_quantile([...Array(18).fill(0),...Array(6).fill(10)],60,.95).quantile,20)
})
test('hand-calculated MASE RMSSE CFE PIS and scaled pinball',()=>{
 const m=lab.score_folds([1,3,5,7,9],[{origin:3,actual:[7,9],prediction:[6,11],errors:[1,-2]}])
 // naive scale=2, squared scale=4; absolute errors total=3; squared=5.
 assert.equal(m.mase,.75);assert.equal(m.rmsse,Math.sqrt(.625));assert.equal(m.cfe,-1);assert.equal(m.pis,-1)
 near(m.scaled_pinball,{'0.5':.375,'0.8':.3,'0.95':.2625})
})
test('hand-derived adoption gate rejects each failed comparator constraint',()=>{
 const baseline={mase:1,rmsse:1,scaled_cfe:2}
 const candidate={mase:.9,rmsse:.9,scaled_cfe:1,coverage:{'0.8':{rate:.8,samples:5}}}
 assert.equal(lab.adoption_gate(candidate,baseline),true)
 for(const change of [{mase:.91},{rmsse:1.01},{scaled_cfe:3},{coverage:{'0.8':{rate:.5,samples:5}}},{coverage:{'0.8':{rate:null,samples:0}}}])assert.equal(lab.adoption_gate({...candidate,...change},baseline),false)
})
test('hand-derived pooling uses independent same-class SKUs, normalized scale, and deduplicates',()=>{
 const item={sku:'A',monthly_sales:Array(36).fill(10),on_hand:0,receipts:{}}
 const peer={...item,sku:'B',monthly_sales:Array(36).fill(100)}
 const other={...item,sku:'C',monthly_sales:Array.from({length:36},(_,i)=>i%2?0:10)}
 const g={quantity:20,endpoint:'2026-11-30',incoming:0}
 assert.equal(ctx.api.forecastDetails(item,g,{},'2026-10-31',[other]).scenarios,null)
 const d=ctx.api.forecastDetails(item,g,{},'2026-10-31',[item,peer,peer,other]).scenarios
 assert.equal(d.samples,24);assert.equal(d.own_samples,12);assert.equal(d.pooled,true)
 assert.equal(d.p50,10);assert.equal(d.p80,10);assert.equal(d.p95,10)
 assert.equal(d.lean,10);assert.equal(d.recommended,20);assert.equal(d.stock_up,20)
})
test('finite-sample order statistics and thin-tail refusal',()=>{
 assert.equal(lab.conformal_quantile(Array.from({length:19},(_,i)=>i+1),.8),16)
 assert.equal(lab.conformal_quantile(Array.from({length:19},(_,i)=>i+1),.95),19)
 assert.equal(lab.conformal_quantile([1,2,3,4],.95),null)
})
test('same-class pooled split-conformal Python/JS parity on 40 seeded histories',()=>{
 let seed=1657;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%100)
 const cases=Array.from({length:40},(_,i)=>({sku:'S'+i,name:'Synthetic',unit:'box',on_hand:0,supplier_days:14,monthly_sales:Array.from({length:36},()=>i%2?rand():rand()<70?0:rand()),receipts:{}}))
 const g={quantity:100,endpoint:'2026-12-15',incoming:0}
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json,sys
items=json.load(sys.stdin)
print(json.dumps([engine.forecast_details(x,dict(quantity=100,endpoint='2026-12-15',incoming=0),as_of='2026-10-31',peers=items) for x in items]))`],{input:JSON.stringify(cases),encoding:'utf8'})
 assert.equal(p.status,0,p.stderr);const expected=JSON.parse(p.stdout)
 cases.forEach((x,i)=>near(plain(ctx.api.forecastDetails(x,g,{},'2026-10-31',cases)),expected[i]))
 assert.ok(expected.some(x=>x.scenarios?.pooled))
})
