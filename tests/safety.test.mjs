import assert from 'node:assert/strict'
import {orderUpTo} from './policy-v2-support.mjs'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
const root=new URL('../',import.meta.url), source=fs.readFileSync(new URL('desktop/plugin.js',root),'utf8')
const context=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={calculate,parseCsv,normalizeErpRows,orderGuidance,orderBucket,normalizeOrderSettings,salesDataAge:typeof salesDataAge===\'function\'?salesDataAge:null,activeSkip:typeof activeSkip===\'function\'?activeSkip:null,bigOrderWarning:typeof bigOrderWarning===\'function\'?bigOrderWarning:null}',context)
const a=context.api, plain=x=>JSON.parse(JSON.stringify(x))
const months=['2026-08','2026-09','2026-10'],asOf='2026-10-31'
const item=(extra={})=>({sku:'T',name:'Test',unit:'pcs',on_hand:30,supplier_days:14,monthly_sales:[30,30,30],receipts:{},...extra})
const row=extra=>a.calculate([item(extra)],months,asOf,6)[0]
test('incoming stock defers the purchase window without changing physical runout',()=>{
 const normal=a.orderGuidance(row(),'2026-11-01'), incoming=a.orderGuidance(row({on_order:100}),'2026-11-01')
 assert.equal(incoming.quantity,orderUpTo(row({on_order:100}),incoming)); assert.equal(incoming.inventory_position,130)
 assert.ok(incoming.order_by>normal.order_by)
 assert.equal(incoming.runout_date,normal.runout_date); assert.equal(incoming.covered_by_on_order,true)
 assert.equal(a.orderBucket(row({on_order:100}),'2026-11-01'),'healthy')
 const late=a.orderGuidance(row({on_hand:1,on_order:100}),'2026-11-01',{months_of_cover:0})
 assert.equal(late.covered_by_on_order,false)
 assert.equal(late.status,'supply-gap'); assert.equal(a.orderBucket(row({on_hand:1,on_order:100}),'2026-11-01',{months_of_cover:0}),'running-low')
 const empty=a.orderGuidance(row({on_hand:0,on_order:100}),'2026-11-20',{months_of_cover:0})
 assert.equal(empty.out_of_stock,true); assert.equal(empty.status,'supply-gap')
 const one=a.orderGuidance(row({on_order:1}),'2026-11-01')
 assert.equal(one.quantity,orderUpTo(row({on_order:1}),one))
 assert.equal(a.orderGuidance(row({on_order:-1}),'2026-11-01').status,'needs-data')
})
test('CSV accepts canonical incoming column and all ERP aliases; rejects invalid incoming',()=>{
 const canonical='sku,name,unit,on_hand,supplier_days,category,on_order,2026-08,2026-09,2026-10\nT,Test,pcs,30,14,Widgets,100,30,30,30\n'
 assert.equal(a.parseCsv(canonical).items[0].on_order,100)
 assert.equal(Object.hasOwn(a.parseCsv(canonical.replace('Widgets,100','Widgets,')).items[0],'on_order'),false)
 for(const value of ['', '2026-11-30', 'pending']) assert.equal(Object.hasOwn(a.parseCsv(`SKU,Name,On Hand,Expected,Aug 2026,Sep 2026,Oct 2026\nT,Test,30,${value},30,30,30\n`).items[0],'on_order'),false)
 for(const header of ['on order','qty on order','quantity on order','on po','open po qty','incoming','incoming qty','ordered qty','expected','in transit']) assert.equal(a.parseCsv(`SKU,Name,On Hand,${header},Aug 2026,Sep 2026,Oct 2026\nT,Test,30,100,30,30,30\n`).items[0].on_order,100)
 for(const bad of ['-1', 'NaN']) assert.throws(()=>a.parseCsv(canonical.replace('Widgets,100','Widgets,'+bad)))
 assert.equal(Object.hasOwn(a.parseCsv(canonical.replace('category,on_order,','category,').replace('Widgets,100,','Widgets,')).items[0],'on_order'),false)
})
test('incoming ERP normalization agrees with Python for blanks, dates, mixed columns and grouped numbers',()=>{
 const cases=[]
 for(const header of ['on order','incoming','expected','in transit']) for(const value of ['', '2026-11-30','pending','1,200','-1','NaN','١٢']) {
   cases.push([['SKU','Name','On Hand',header,'Aug 2026','Sep 2026','Oct 2026'],['T','Test','30',value,'30','30','30']])
   cases.push([['SKU','Name','On Hand',header,'Aug 2026','Sep 2026','Oct 2026'],['T','Test','30',value,'30','30','30'],['U','Test','30','20','30','30','30']])
 }
 const py=`import json,sys,types\np=types.ModuleType('stock_runway');p.__path__=['.'];sys.modules['stock_runway']=p\nfrom stock_runway.sources import normalize_erp_rows\nprint(json.dumps([normalize_erp_rows(c) for c in json.load(sys.stdin)]))`
 const expected=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8'}))
 assert.deepEqual(plain(cases.map(a.normalizeErpRows)),expected)
})

test('sales age is calendar month-end based with strict 45-day boundary',()=>{
 assert.equal(a.salesDataAge(months,'2026-12-15'),45)
 assert.equal(a.salesDataAge(months,'2026-12-16'),46)
 assert.equal(a.salesDataAge(months,'2026-10-01'),0)
 assert.equal(a.salesDataAge([],asOf),null)
})
test('skip records persist only valid reasons and expire after 14 days or newer data',()=>{
 const entry={reason:'Already ordered',skipped_on:'2026-11-01',as_of:asOf}
 const s=a.normalizeOrderSettings({skipped_items:{T:entry,BAD:{...entry,reason:'arbitrary'},INVALID_DATE:{reason:'Other',skipped_on:'2026-11-01',as_of:'bad'}},on_order_tip_dismissed:true})
 assert.deepEqual(plain(s.skipped_items),{T:entry}); assert.equal(s.on_order_tip_dismissed,true)
 assert.equal(a.activeSkip(s,'T','2026-11-14',asOf).reason,entry.reason)
 assert.equal(a.activeSkip(s,'T','2026-11-15',asOf),null)
 assert.equal(a.activeSkip(s,'T','2026-11-05','2026-11-30'),null)
 assert.equal(a.activeSkip(s,'T','2026-10-31',asOf),null)
})
test('big order uses strict threshold, default six months, zero demand and persisted setting',()=>{
 const settings={product_overrides:{T:{minimum_order:240}}}, g=a.orderGuidance(row({on_order:0}),'2026-11-01',settings)
 assert.equal(g.big_order,true); assert.equal(a.bigOrderWarning(g,settings),'Check this order: about 8 months of stock, much bigger than usual.')
 assert.equal(a.orderGuidance(row({on_order:0}),'2026-11-01',{...settings,big_order_months:8}).big_order,false)
 assert.equal(a.normalizeOrderSettings({big_order_months:9}).big_order_months,9)
 assert.equal(a.bigOrderWarning({quantity:0,monthly_demand:0}),null)
})
test('live-date purchase, incoming coverage and big-order flags match Python across seasonal and fractional cases',()=>{
 const sample=JSON.parse(fs.readFileSync(new URL('data/sample.json',root),'utf8'))
 const cases=[]; let seed=812731
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
 for(let i=0;i<160;i++) {
   const base=sample.items[i%sample.items.length]
   const on_hand=i%2 ? next()%500/10 : next()%5000
   cases.push({item:{...base,on_hand,on_order:next()%500/10,receipts:i%4?{}:{'2026-11':next()%40,'2027-01':next()%500}},
     today:['2026-10-31','2026-11-11','2027-01-19'][i%3],settings:{big_order_months:i%4?6:.5,include_backup_in_orders:i%3===0,months_of_cover:i%4,product_overrides:{[base.sku]:{pack_size:i%2?.25:24,minimum_order:i%5?0:2000}}}})
 }
 const py=`import json,sys\nfrom engine import forecast\nd=json.load(sys.stdin)\nprint(json.dumps([forecast(c['item'],d['months'],d['as_of'],settings=c['settings'],today=c['today']) for c in d['cases']]))`
 const expected=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify({cases,months:sample.months,as_of:sample.as_of}),encoding:'utf8'}))
 cases.forEach((c,i)=>{
   const actual=a.orderGuidance(a.calculate([c.item],sample.months,sample.as_of,6,c.settings)[0],c.today,c.settings)
   for(const [j,p] of [['quantity','suggested_order'],['inventory_position','inventory_position'],['covered_by_on_order','covered_by_on_order'],['big_order','big_order']]) assert.equal(actual[j]??null,expected[i][p]??null,`${i} ${j}`)
 })
})

test('Python and JavaScript snapshot safety calculations match',()=>{
 const cases=[{item:item({monthly_sales:[10.2,11.6,12.4],on_order:.3}),settings:{big_order_months:6}}, {item:item({on_hand:.1,on_order:.2}),settings:{}}, {item:item({on_hand:300,on_order:10}),settings:{}}]
 for(const on_hand of [0,1,30,100]) for(const on_order of [0,.25,30,100]) cases.push({item:item({on_hand,on_order}),settings:{months_of_cover:2,big_order_months:6,product_overrides:{T:{pack_size:.25,minimum_order:10}}}})
 const py=`import json,sys\nfrom engine import forecast\ncases=json.load(sys.stdin)\nprint(json.dumps([forecast(c['item'],['2026-08','2026-09','2026-10'],'2026-10-31',settings=c['settings']) for c in cases]))`
 const expected=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8'}))
 const fields=['inventory_position','suggested_order','covered_by_on_order','big_order','on_order']
 cases.forEach((c,i)=>{const actual=a.calculate([c.item],months,asOf,6,c.settings)[0]; for(const f of fields) assert.equal(actual[f],expected[i][f],`${i} ${f}`)})
})
