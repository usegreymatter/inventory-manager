import { readBaseline, baselineResult } from './baseline.mjs'
import assert from 'node:assert/strict'
import {forecastOnly,assertGuidanceDates} from './policy-v2-support.mjs'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const src=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(src.slice(src.indexOf('const SAMPLE ='),src.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={demandModel,forecastSelection,forecastDetails,calculate,orderGuidance,parseStockImport}',ctx)
const plain=x=>JSON.parse(JSON.stringify(x))
const near=(a,b)=>{if(typeof b==='number')assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((x,i)=>near(a[i],x))}else if(b&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k in b)near(a[k],b[k])}else assert.equal(a,b)}
const month=n=>new Date(Date.UTC(2022,11+n,1)).toISOString().slice(0,7)
function fixture(){
 const sales=Array.from({length:48},(_,i)=>10+i%5*7+i),months=sales.map((_,i)=>month(i))
 const item={sku:'EXT',name:'Synthetic',unit:'box',on_hand:60,supplier_days:14,monthly_sales:sales,receipts:{},external_forecasts:Array.from({length:60},(_,i)=>({month:month(i),p50:i<48?sales[i]:80,p80:1e12,p95:1e12,p95_flag:'heuristic',source:'synthetic-archive'}))}
 // Keep the production snapshot used by the rest of Phase 3.
 const shift=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5))-2,1)).toISOString().slice(0,7)
 item.external_forecasts.forEach(r=>r.month=shift(r.month))
 return {item,months:months.map(shift)}
}
test('external challenger gate, same rolling folds, tail refusal, invalid archive and full planner Python parity',()=>{
 const {item,months}=fixture(),cases=[item]
 for(const kind of ['loser','missing','future','duplicate','source','tab','control','bom','nbsp','newline','long','null-origin','vintaged']){
  const c=structuredClone(item),rows=c.external_forecasts
  if(kind==='loser')rows.forEach(r=>r.p50=1e6)
  if(kind==='missing')rows.splice(25,1)
  if(kind==='future')rows.pop()
  if(kind==='duplicate')rows.push(rows[0])
  if(kind==='source')rows[0].source='other'
  const badSource={tab:'\t',control:'\u001c',bom:'\ufeff',nbsp:'\u00a0',newline:'archive\n',long:'a'.repeat(41)}
  if(Object.hasOwn(badSource,kind))rows.forEach(r=>r.source=badSource[kind])
  if(kind==='null-origin')rows[0].origin=null
  if(kind==='vintaged')c.external_forecasts=Array.from({length:37},(_,i)=>i+12).flatMap(o=>rows.filter(r=>r.month>months[o-1]).map(r=>({...r,origin:months[o-1]})))
  cases.push(c)
 }
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json,sys
cases,months=json.load(sys.stdin)
out=[]
for item in cases:
 p=engine.forecast(item,months,'2026-10-31',6)
 i=dict(item,**p,as_of='2026-10-31')
 g=engine.order_guidance(i,'2026-11-01',{},'2026-10-31')
 out.append(dict(selection=engine.forecast_selection(item,'2026-10'),guidance=g,details=engine.forecast_details(i,g,as_of='2026-10-31')))
print(json.dumps(out))`],{input:JSON.stringify([cases,months]),encoding:'utf8',maxBuffer:32*1024*1024})
 assert.equal(py.status,0,py.stderr)
 const expected=JSON.parse(py.stdout)
 cases.forEach((item,i)=>{
  const selection=ctx.api.forecastSelection(item,'2026-10'),p=ctx.api.calculate([item],months,'2026-10-31',6)[0],g=ctx.api.orderGuidance(p,'2026-11-01',{},'2026-10-31')
  near(plain({selection,guidance:g,details:ctx.api.forecastDetails(p,g,{},'2026-10-31')}),expected[i])
 })
 assert.notEqual(expected[0].selection.method,'external')
 assert.equal(expected.at(-1).selection.method,'external')
 expected.slice(1,-1).forEach(x=>assert.notEqual(x.selection.method,'external'))
 assert.equal(expected[0].details.scenarios,null)
})
test('vintaged external sources share the explicit ASCII-space rule',()=>{
 const {item,months}=fixture(),rows=item.external_forecasts
 item.external_forecasts=Array.from({length:37},(_,i)=>i+12).flatMap(o=>rows.filter(r=>r.month>months[o-1]).map(r=>({...r,origin:months[o-1]})))
 for(const source of [' synthetic-archive ', '\t', '\u001c', '\ufeff', '\u00a0', 'archive\n', 'a'.repeat(41)]){
  item.external_forecasts.forEach(r=>r.source=source)
  assert.equal(ctx.api.forecastSelection(item,'2026-10').method==='external',source===' synthetic-archive ')
 }
})
test('forecasts.csv bridge reaches Desktop and A3 core import; absent archive preserves historical bytes',()=>{
 const {item,months}=fixture(),dir=fs.mkdtempSync(path.join(process.cwd(),'.scratch','external-'))
 fs.writeFileSync(path.join(dir,'stock.csv'),'sku,name,unit,on_hand,supplier_days,'+months.join(',')+'\nEXT,Synthetic,box,60,14,'+item.monthly_sales.join(',')+'\n')
 fs.writeFileSync(path.join(dir,'forecasts.csv'),'sku,month,p50,p80,p95,source,p95_flag\n'+item.external_forecasts.map(r=>`EXT,${r.month},${r.p50},${r.p80},${r.p95},${r.source},heuristic`).join('\n')+'\n')
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['bundle_import.py',dir,'--today','2026-11-01'],{encoding:'utf8'})
 assert.equal(py.status,0,py.stderr)
 const data=ctx.api.parseStockImport(py.stdout)
 assert.notEqual(ctx.api.forecastSelection(data.items[0],'2026-10').method,'external')
 assert.equal(data.items[0].external_forecasts[0].p95,undefined)
 const a3=fs.readFileSync(new URL('../standalone/design/option-a3.html',import.meta.url),'utf8')
 // Excel intake must retain CSV/JSON bundle support alongside workbook types.
 for(const type of ['.csv','.json','.xlsx','text/csv','application/json'])assert.ok(a3.match(/accept="([^"]+)"/)[1].split(',').includes(type))
 const oldsrc=baselineResult('ce72870:desktop/plugin.js').stdout,old=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
 old.phase4Model=ctx.api.demandModel
 vm.runInContext(oldsrc.slice(oldsrc.indexOf('const SAMPLE ='),oldsrc.indexOf('const pageStyle =')).replaceAll('export ','').replace('model.seasonal ? SEASONAL_COPY : SEASONAL_REASON','model.method_name || (model.seasonal ? SEASONAL_COPY : SEASONAL_REASON)')+';demandModel=phase4Model;this.calculate=calculate',old)
 delete item.external_forecasts
 const rows=ctx.api.calculate([item],months,'2026-10-31',6)
 assert.equal(JSON.stringify(rows.map(forecastOnly)),JSON.stringify(old.calculate([item],months,'2026-10-31',6).map(forecastOnly)))
 rows.forEach(row=>assertGuidanceDates(ctx.api,row,'2026-10-31'))
})
