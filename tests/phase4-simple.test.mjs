import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({TextEncoder,TextDecoder})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={calculate,withEvaluationPass,demandModel,legacyDemandModel,forecastDetails,forecastMethodValues,forecastSelection,STOCKOUT_LAB}',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x))
test('simple hybrid: classifier cache is snapshot-local and edit-sensitive',()=>{
 const probe=vm.createContext({TextEncoder,TextDecoder,classifierCalls:0})
 const core=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','').replaceAll('STOCKOUT_LAB.demand_class(sales,true)','(++globalThis.classifierCalls,STOCKOUT_LAB.demand_class(sales,true))')
 vm.runInContext(core+'\nthis.api={withEvaluationPass,demandModel,legacyDemandModel}',probe)
 const sales=Array(12).fill(10)
 for(let pass=0;pass<2;pass++)probe.api.withEvaluationPass(()=>{
  const before=probe.classifierCalls
  for(let i=0;i<10;i++)assert.equal(probe.api.demandModel([...sales],'2026-12').level,10)
  assert.equal(probe.classifierCalls,before+1)
  sales[0]=900
  assert.deepEqual(plain(probe.api.demandModel(sales,'2026-12')),plain(probe.api.legacyDemandModel(sales,'2026-12')))
  assert.equal(probe.classifierCalls,before+2)
  sales[0]=10
 })
 assert.equal(probe.classifierCalls,4)
})
const histories=[[10,20,30],[10,10,20,20],[200,...Array(12).fill(100)],[900,...Array(12).fill(10)],[0,1000,...Array(10).fill(10)],Array(12).fill(0),[10,20],Array(65000).fill(1),Array(12).fill(4e12)]
for(let n=3;n<=48;n++)histories.push(Array.from({length:n},(_,i)=>i%4===0?0:10+(i%7)))
test('simple hybrid: full-history class, tail mean, minimum three and exact legacy fallback',()=>{
 for(const sales of histories){
  const smooth=sales.length>=3&&api.STOCKOUT_LAB.demand_class(sales,true).class==='smooth'
  const model=plain(api.demandModel(sales,'2026-12'))
  if(smooth){const tail=sales.slice(-12);assert.deepEqual(model,{seasonal:false,factors:Array(12).fill(1),level:tail.reduce((a,b)=>a+b,0)/tail.length,method_name:'Steady: 12-month average'})}
  else assert.deepEqual(model,plain(api.legacyDemandModel(sales,'2026-12')))
 }
 assert.equal(api.forecastDetails({sku:'S',monthly_sales:[10,10,20,20],as_of:'2026-12-31'},{quantity:0}).method_name,'Steady: 12-month average')
})
test('simple hybrid: Python parity includes extended cleaned range and long supported histories',()=>{
 // Two-month input is deliberately outside the shared production contract.
 // Both entry points must HOLD it; legacy helpers differ below that boundary.
 const short={sku:'S',name:'Short',unit:'ea',on_hand:1,monthly_sales:[10,20]}
 assert.equal(api.calculate([short],['2026-11','2026-12'],'2026-12-31',6)[0].held,true)
 const supported=histories.filter(s=>s.length>=3)
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import json,sys,engine
assert engine.validate_item(dict(sku='S',name='Short',unit='ea',on_hand=1,monthly_sales=[10,20])) == 'At least 3 full months of sales are needed to forecast.'
print(json.dumps([engine.demand_model(s,'2026-12') for s in json.load(sys.stdin)]))`],{input:JSON.stringify(supported),encoding:'utf8',maxBuffer:8*1024*1024})
 assert.equal(py.status,0,py.stderr)
 assert.deepEqual(supported.map(s=>plain(api.demandModel(s,'2026-12'))),JSON.parse(py.stdout))
})
test('simple hybrid: ADI/CV2 exact thresholds and prefix-only fold champion remain fixed',()=>{
 assert.equal(api.STOCKOUT_LAB.demand_class([3,17]).cv2,.49)
 assert.equal(api.STOCKOUT_LAB.demand_class([3,17]).class,'erratic')
 assert.equal(api.STOCKOUT_LAB.demand_class([...Array(25).fill(10),...Array(8).fill(0)]).adi,1.32)
 assert.equal(api.STOCKOUT_LAB.demand_class([...Array(25).fill(10),...Array(8).fill(0)]).class,'intermittent')
 const sales=Array.from({length:48},(_,i)=>10+i%11),item={monthly_sales:sales}
 const selection=api.forecastSelection(item,'2026-12')
 for(const row of selection.folds){
  const prefix=sales.slice(0,row.origin)
  const expected=prefix.slice(-12).reduce((a,b)=>a+b,0)/12
  if(selection.method==='champion')assert.deepEqual(plain(row.prediction),Array(row.prediction.length).fill(expected))
 }
})
