import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
const src=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(src.slice(src.indexOf('const SAMPLE ='),src.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={forecastSelection,forecastDetails,calculate,orderGuidance,whyBreakdown}',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x))
const cases=[];let seed=98765
const rand=n=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n)
for(let i=0;i<120;i++){
 const n=[3,17,18,24,36,48][rand(6)],sales=Array.from({length:n},(_,j)=>i%4===0?j+10:i%4===1?30:i%4===2?rand(5)===0?rand(100):0:rand(1000)/8)
 cases.push({sku:'F',name:'Synthetic forecast',unit:'box',on_hand:120,supplier_days:14,monthly_sales:sales,receipts:{}})
}
test('production selection plus adopted projection/guidance parity: 120 seeded histories',()=>{
 const child=spawnSync('/usr/bin/python3',['-c',`import json,sys,engine
out=[]
for item in json.load(sys.stdin):
 n=len(item['monthly_sales']);months=[engine.month_after('2026-10',i-n+1) for i in range(n)]
 p=engine.forecast(item,months,'2026-10-31',settings={'big_order_months':6})
 g=engine.order_guidance({**item,**p,'as_of':'2026-10-31'},'2026-10-31',{'big_order_months':6})
 out.append(dict(selection=engine.forecast_selection(item,'2026-10'),projection=p.get('projection'),suggested_order=p.get('suggested_order') if engine.forecast_selection(item,'2026-10')['adopted'] else None,guidance=g,details=engine.forecast_details({**item,**p,'as_of':'2026-10-31'},g,{'big_order_months':6})))
print(json.dumps(out).replace('Infinity','null'))`],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:64*1024*1024})
 assert.equal(child.status,0,child.stderr)
 const expected=JSON.parse(child.stdout)
 const near=(a,b,where='')=>{if(typeof b==='number'){assert.ok(Math.abs(a-b)<=1e-9,`${where}: ${a} != ${b}`);return}if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>near(a[i],v,where+'.'+i));return}if(b&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),where);for(const k in b)near(a[k],b[k],where+'.'+k);return}assert.equal(a,b,where)}
 cases.forEach((item,i)=>{
  const n=item.monthly_sales.length,months=Array.from({length:n},(_,j)=>new Date(Date.UTC(2026,9+j-n+1,1)).toISOString().slice(0,7))
  const p=api.calculate([item],months,'2026-10-31',6,{big_order_months:6})[0],g=api.orderGuidance(p,'2026-10-31',{big_order_months:6})
  near(plain({selection:api.forecastSelection(item,'2026-10'),projection:p.projection,suggested_order:api.forecastSelection(item,'2026-10').adopted?p.suggested_order:null,guidance:g,details:api.forecastDetails(p,g,{big_order_months:6})}),expected[i],`seed ${i}`)
 })
})
