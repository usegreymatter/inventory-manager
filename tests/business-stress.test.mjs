// Synthetic edge-business invariants plus production Python/JS parity. No math changes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const c=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+';globalThis.api={calculate,orderGuidance,orderBucket}',c)
const months=Array.from({length:12},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`),asOf='2026-12-31'
const base={sku:'EDGE',name:'Synthetic',unit:'ea',on_hand:1,supplier_days:7,monthly_sales:Array(12).fill(30),receipts:{}}
const cases=[
 {name:'all no sales',item:{...base,monthly_sales:Array(12).fill(0)},expect:'no-sales'},
 {name:'single product',item:base},
 {name:'all needing data',item:{...base,on_hand:-1},expect:'needs-data'},
 {name:'zero lead',item:{...base,supplier_days:0}},
 {name:'365-day lead',item:{...base,supplier_days:365}},
 {name:'huge MOQ',item:{...base,minimum_order:1000000000}},
 {name:'pack 1000',item:{...base,pack_size:1000}},
 {name:'very short target cover',item:base,settings:{months_of_cover:.01,include_backup_in_orders:false}},
 {name:'seasonal spikes',item:{...base,monthly_sales:[1,1,1,500,1,1,1,1,700,1,1,1]}},
 {name:'intermittent spare parts',item:{...base,monthly_sales:[0,0,0,3,0,0,0,0,1,0,0,0]}},
 {name:'one month new',item:{...base,monthly_sales:[3]},months:months.slice(-1),expect:'needs-data'},
 {name:'two months new',item:{...base,monthly_sales:[3,4]},months:months.slice(-2),expect:'needs-data'},
 {name:'currency absent',item:{...base,unit_cost:2}},
 {name:'max accepted on hand',item:{...base,on_hand:1e12}},
]
function evaluate(x){const settings=x.settings||{},row=c.api.calculate([x.item],x.months||months,asOf,6,settings,asOf)[0];return{row,guidance:c.api.orderGuidance(row,asOf,settings),bucket:c.api.orderBucket(row,asOf,settings)}}
const child=spawnSync('/usr/bin/python3',['-c',`import json,sys,engine
out=[]
for c in json.load(sys.stdin):
 m=c.get('months',[f'2026-{i:02}' for i in range(1,13)])
 item=c['item'];s=c.get('settings',{})
 r=engine.forecast(item,m,'2026-12-31',6,settings=s,today='2026-12-31')
 r={**item,**r,'as_of':'2026-12-31'}
 out.append(dict(guidance=engine.order_guidance(r,'2026-12-31',s),bucket=engine.order_bucket(r,'2026-12-31',s)))
def clean(v):
 if isinstance(v,float) and not __import__('math').isfinite(v): return None
 if isinstance(v,dict): return {k:clean(x) for k,x in v.items()}
 if isinstance(v,list): return [clean(x) for x in v]
 return v
print(json.dumps(clean(out),allow_nan=False))`],{cwd:new URL('../',import.meta.url),input:JSON.stringify(cases),encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
test('all edge fixtures execute the real Python engine',()=>{assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).length,cases.length)})
const py=child.status===0?JSON.parse(child.stdout):[]
for(const [i,x] of cases.entries())test(`business edge: ${x.name}`,()=>{
 const out=evaluate(x),plain=JSON.parse(JSON.stringify({guidance:out.guidance,bucket:out.bucket}))
 if(x.expect==='needs-data'){
  // Known baseline copy divergence, not an accept/reject or arithmetic mismatch.
  assert.match(plain.guidance.reason,/Stock and at least three months/)
  assert.match(py[i].guidance.reason,x.name==='all needing data'?/On hand must/:/At least 3 full months/)
  const expected=JSON.parse(JSON.stringify(py[i]));delete expected.guidance.reason;delete plain.guidance.reason
  assert.deepEqual(plain,expected)
 }else assert.deepEqual(plain,py[i])
 if(x.expect)assert.equal(out.bucket,x.expect)
 if(out.guidance.quantity!==undefined)assert.ok(Number.isFinite(out.guidance.quantity)&&out.guidance.quantity>=0)
 if(x.name==='huge MOQ')assert.ok(out.guidance.quantity>=1e9)
 if(x.name==='pack 1000')assert.equal(out.guidance.quantity%1000,0)
 if(x.name==='zero lead')assert.equal(out.guidance.lead_days,0)
 if(x.name==='365-day lead')assert.equal(out.guidance.lead_days,365)
})
const summarySource=fs.readFileSync(new URL('../standalone/design/weekly-summary-gm-b.js',import.meta.url),'utf8')
vm.runInContext(summarySource,c)
test('100 suppliers remain separate, missing currency honest, mixed units not summed',()=>{
 const rows=Array.from({length:100},(_,i)=>({item:{sku:`S${i}`,name:'Synthetic',unit:i%2?'kg':'ea',supplier:`Supplier ${i}`,on_order:0},guidance:{quantity:1,order_by:'now',runout_date:'2027-01-02'},bucket:'order',meta:{supplier:`Supplier ${i}`,value:2}}))
 const model=c.weeklySummaryModel({rows,asOf,today:asOf,source:'Synthetic'})
 assert.equal(model.total,100);assert.equal(model.suppliers.length,100)
 assert.deepEqual(JSON.parse(JSON.stringify(model.totals.units)).sort((a,b)=>a.unit.localeCompare(b.unit)),[{unit:'ea',quantity:50},{unit:'kg',quantity:50}])
 assert.ok(!c.weeklySummaryValue(model,model.totals).includes('undefined'))
})
