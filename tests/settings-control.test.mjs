import { readBaseline, baselineResult } from './baseline.mjs'
import test from 'node:test'
import {forecastOnly,assertGuidanceDates} from './policy-v2-support.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll(/export /g,'')+'\nthis.api={normalizeOrderSettings,validateOrderSettings,resolveOrderSettings,calculate,orderGuidance,orderBucket}',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x))
const months=['2026-08','2026-09','2026-10'],as_of='2026-10-31',today='2026-11-01'
const item={sku:'SYN-A',name:'Synthetic',unit:'box',supplier:'North',supplier_days:30,on_hand:25,monthly_sales:[20,45,30],receipts:{},unit_cost:2}
const global={include_backup_in_orders:true,review_days:14,service_level:.9,default_delivery_days:14}
const supplier={...global,supplier_overrides:{North:{supplier_days:21,minimum_order:100,pack_size:25,review_days:7,service_level:.99}}}
const product={...supplier,product_overrides:{'SYN-A':{supplier_days:10,minimum_order:150,pack_size:30,service_level:.95,unit_cost:4}}}
const cases=[{},global,supplier,product,{product_overrides:{'SYN-A':{supplier_days:0,review_days:0,unit_cost:0}}}]
const evaluate=(settings,raw=item)=>{const p=api.calculate([raw],months,as_of,6,settings,today)[0];return plain({resolved:api.resolveOrderSettings(raw,settings),guidance:api.orderGuidance(p,today,settings,as_of),bucket:api.orderBucket(p,today,settings,as_of)})}
test('Python/JS input resolution, provenance and output parity under global/supplier/product settings',()=>{
 const script=`import json,sys\nimport stock_runway\ne,_=stock_runway._load_modules()\nc=json.load(sys.stdin)\nout=[]\nfor s in c['cases']:\n raw=c['item'];p=e.forecast(raw,c['months'],c['as_of'],settings=s,today=c['today'])\n item={**raw,**p,'monthly_sales':raw['monthly_sales'],'on_hand':raw['on_hand'],'as_of':c['as_of']}\n out.append(dict(resolved=e.resolve_order_settings(raw,s),guidance=e.order_guidance(item,c['today'],s,c['as_of']),bucket=e.order_bucket(item,c['today'],s,c['as_of'])))\nprint(json.dumps(out))`
 const child=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',script],{cwd:new URL('..',import.meta.url),encoding:'utf8',input:JSON.stringify({item,months,as_of,today,cases})})
 assert.equal(child.status,0,child.stderr)
 assert.deepEqual(cases.map(s=>evaluate(s)),JSON.parse(child.stdout))
 assert.equal(evaluate(product).resolved.sources.supplier_days,'product setting')
 assert.equal(evaluate(supplier).resolved.sources.supplier_days,'supplier setting')
 assert.equal(evaluate({}).resolved.sources.supplier_days,'from file')
 assert.equal(evaluate({}, {...item,supplier_days:null}).resolved.sources.supplier_days,'default')
})
test('supplier settings affect every matching product; product reset reveals supplier; global defaults preserve file',()=>{
 for(const sku of ['SYN-A','SYN-B'])assert.equal(evaluate(supplier,{...item,sku}).guidance.lead_days,21)
 assert.equal(evaluate(product).guidance.lead_days,10)
 assert.equal(evaluate(supplier,{...item,supplier:'South'}).guidance.lead_days,30)
 assert.equal(evaluate({default_delivery_days:50}).guidance.lead_days,30)
 assert.equal(evaluate({default_delivery_days:50},{...item,supplier_days:null}).guidance.lead_days,50)
})
test('strict import round trip and hostile object names are safe',()=>{
 const next=plain(api.validateOrderSettings(product))
 assert.deepEqual(plain(api.validateOrderSettings(JSON.parse(JSON.stringify(next)))),next)
 const special=JSON.parse('{"supplier_overrides":{"__proto__":{"supplier_days":21}},"product_overrides":{"constructor":{"pack_size":25}}}')
 assert.equal(api.resolveOrderSettings({...item,supplier:'__proto__',sku:'constructor'},special).values.supplier_days,21)
 assert.equal({}.supplier_days,undefined)
 for(const bad of [null,[],{unknown:1},{service_level:.96},{buffer_days:366},{supplier_overrides:{North:{unit_cost:1}}},{product_overrides:{A:{pack_size:0}}},{include_backup_in_orders:'true'}])assert.throws(()=>api.validateOrderSettings(bad))
})
test('sample forecast/model/backtest/projections remain unchanged; policy dates use guidance',t=>{
 const before=baselineResult('faa26db:desktop/plugin.js')
 if(before.status!==0){t.skip('development-history baseline unavailable');return}
 const oldctx=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
 vm.runInContext(before.stdout.slice(before.stdout.indexOf('const SAMPLE ='),before.stdout.indexOf('const pageStyle =')).replaceAll(/export /g,'')+'\nthis.api={calculate,orderGuidance,orderBucket}',oldctx)
 const sample=JSON.parse(fs.readFileSync(new URL('../data/sample.json',import.meta.url),'utf8'))
 for(const settings of [{},undefined]){
   const evaluate=core=>core.calculate(sample.items,sample.months,sample.as_of,6,settings,today).map(p=>({physical:p,guidance:core.orderGuidance(p,today,settings,sample.as_of),bucket:core.orderBucket(p,today,settings,sample.as_of)}))
   const current=evaluate(api),baseline=evaluate(oldctx.api)
   assert.deepEqual(plain(current.map(r=>forecastOnly(r.physical))),plain(baseline.map(r=>forecastOnly(r.physical))))
   current.forEach(r=>assertGuidanceDates(api,r.physical,today,settings,sample.as_of))
 }
})

test('every scoped field uses identical bounds and strict numeric types',()=>{
 for(const group of ['supplier_overrides','product_overrides'])for(const [key,value] of [['supplier_days',-1],['supplier_days',3651],['review_days',1.5],['review_days',3651],['service_level',.96],['minimum_order',-.1],['pack_size',.0000001],['pack_size',1e13]])assert.throws(()=>api.validateOrderSettings({[group]:{A:{[key]:value}}}))
 for(const [key,value] of [['supplier_days',0],['supplier_days',3650],['review_days',0],['review_days',3650],['service_level',.9],['minimum_order',.000001],['pack_size',1e12],['unit_cost',0]])assert.equal(api.validateOrderSettings({product_overrides:{A:{[key]:value}}}).product_overrides.A[key],value)
})
