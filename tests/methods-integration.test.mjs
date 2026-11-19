import { readBaseline, baselineResult } from './baseline.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
const root=new URL('../',import.meta.url),source=fs.readFileSync(new URL('desktop/plugin.js',root),'utf8')
const core=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle ='))
const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(core.replaceAll('export ','')+'\nglobalThis.qa={SAMPLE,calculate,orderGuidance,forecastDetails,normalizeOrderSettings,validateOrderSettings,StockRunwayForecastMethods}',ctx)
const api=ctx.qa,plain=x=>JSON.parse(JSON.stringify(x))

test('embedded library is verbatim and 600 catalog adapter forecasts/orders match Python exactly',()=>{
 const lib=fs.readFileSync(new URL('forecast_methods.js',root),'utf8');assert.ok(core.includes(lib))
 const cases=[];let seed=19433
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
 for(let i=0;i<600;i++){
  const n=3+next()%46,months=Array.from({length:n},(_,k)=>{const x=2020*12+k;return Math.floor(x/12)+'-'+String(x%12+1).padStart(2,'0')})
  const last=months.at(-1),[y,m]=last.split('-').map(Number),asof=last+'-'+new Date(Date.UTC(y,m,0)).getUTCDate()
  const item={sku:'S'+i,name:'Synthetic '+i,unit:'units',on_hand:next()%500,supplier_days:14,monthly_sales:Array.from({length:n},()=>next()%5?next()%800/(i%2?7:1):0),receipts:{}}
  cases.push({item,months,asof,settings:{forecast_method:api.StockRunwayForecastMethods.METHODS[i%16]}})
 }
 const py=`import json,sys\nimport engine\nrows=[]\nfor c in json.load(sys.stdin):\n f=engine.forecast(c['item'],c['months'],c['asof'],12,c['settings'])\n i=dict(c['item'],**f,as_of=c['asof'])\n g=engine.order_guidance(i,c['asof'],c['settings'])\n rows.append(dict(demand=f.get('monthly_demand'),projection=f.get('projection'),method=f.get('forecast_method'),guidance={k:g.get(k) for k in ('quantity','order_by','runout_date','monthly_demand','forecast_method','safety_stock','reorder_point')}))\nprint(json.dumps(rows))`
 const expected=JSON.parse(execFileSync('/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8',maxBuffer:32*1024*1024}))
 cases.forEach((c,k)=>{
  const f=api.calculate([c.item],c.months,c.asof,12,c.settings,c.asof)[0];assert.equal(f.held,false,JSON.stringify(f))
  const g=api.orderGuidance(f,c.asof,c.settings)
  const fields=['quantity','order_by','runout_date','monthly_demand','forecast_method','safety_stock','reorder_point']
  const actual=plain({demand:f.monthly_demand,projection:f.projection,method:f.forecast_method,guidance:Object.fromEntries(fields.map(k=>[k,g[k]??null]))})
  assert.deepEqual(actual,expected[k],'fixture '+k+' '+c.settings.forecast_method)
 })
 console.log(JSON.stringify({adapter_series:cases.length,methods:16,equality:'exact'}))
})

test('Current is whole-output identical to pre-method core, presets alone have no effect',()=>{
 const before=readBaseline('fa027ad:desktop/plugin.js')
 const old=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
 vm.runInContext(before.slice(before.indexOf('const SAMPLE ='),before.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.qa={calculate,SAMPLE}',old)
 const a=plain(old.qa.calculate(old.qa.SAMPLE.items,old.qa.SAMPLE.months,old.qa.SAMPLE.as_of,12))
 for(const preset of ['none',...Object.keys(api.StockRunwayForecastMethods.PRESETS)])assert.deepEqual(plain(api.calculate(api.SAMPLE.items,api.SAMPLE.months,api.SAMPLE.as_of,12,{forecast_method:'current',industry_preset:preset})),a)
})

test('strict method/preset settings reject prototype names and nonstrings',()=>{
 for(const field of ['forecast_method','industry_preset'])for(const v of ['__proto__','constructor','bad',null,{},[],true,3])assert.throws(()=>api.validateOrderSettings({[field]:v}))
 assert.equal(api.normalizeOrderSettings({forecast_method:'bad'}).forecast_method,'current')
})

test('metadata exact Python parity, internal fallback and unchanged numerical API',()=>{
 const fixtures=[[],Array(24).fill(0),[1e-15,...Array(23).fill(1)],[...Array(12).fill(1),...Array(12).fill(1e-15)],Array(36).fill(5)]
 let seed=42;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32}
 for(let i=0;i<120;i++)fixtures.push(Array.from({length:24+i%49},()=>10**(-5*next())))
 const cases=fixtures.flatMap(values=>api.StockRunwayForecastMethods.METHODS.map(method=>({values,method})))
 const py="import json,sys,forecast_methods as m\nprint(json.dumps([m.forecast_with_metadata(c['values'],12,c['method']) for c in json.load(sys.stdin)]))"
 const expected=JSON.parse(execFileSync('/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8',maxBuffer:32*1024*1024}))
 cases.forEach((c,i)=>{const fit=api.StockRunwayForecastMethods.forecast_with_metadata(c.values,12,c.method);assert.deepEqual(plain(fit),expected[i]);assert.deepEqual(plain(fit.forecast),plain(api.StockRunwayForecastMethods.forecast(c.values,12,c.method)))})
 assert.equal(api.StockRunwayForecastMethods.forecast_with_metadata(fixtures[2],12,'hw_multiplicative').method,'ses')
 for(const values of fixtures.slice(2,4)){
  const months=Array.from({length:24},(_,i)=>`${2022+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`)
  const item={sku:'EDGE',name:'Edge',unit:'units',on_hand:1,supplier_days:14,monthly_sales:values}
  const got=api.calculate([item],months,'2023-12-31',12,{forecast_method:'hw_multiplicative'},'2023-12-31')[0]
  assert.equal(got.held,false);assert.equal(got.forecast_method.method,'ses');assert.equal(got.forecast_method.fallback,true)
  assert.deepEqual(plain(got.projection.map(r=>r.demand)),plain(api.StockRunwayForecastMethods.forecast(values,12,'ses')))
 }
 console.log(JSON.stringify({metadata_cases:cases.length,equality:'exact'}))
})

test('excluded and locked history disclose Current without numeric changes',()=>{
 const data=plain(api.SAMPLE)
 for(const locked of [false,true]){
  const item=structuredClone(data.items[0]),rows=data.months.map((month,i)=>({sku:item.sku,month,quantity:item.monthly_sales[i],project:i===0}))
  if(locked)delete rows[0].project
  item.planning_facts={version:'1.0',sales_history:rows,errors:{}}
  const current=plain(api.calculate([item],data.months,data.as_of,12,{},data.as_of)[0])
  const got=plain(api.calculate([item],data.months,data.as_of,12,{forecast_method:'auto'},data.as_of)[0]),info=got.forecast_method
  assert.equal(info.method,'current');assert.equal(info.fallback,true);assert.match(info.note,/Using Current:/)
  delete got.forecast_method;assert.deepEqual(got,current)
 }
})
