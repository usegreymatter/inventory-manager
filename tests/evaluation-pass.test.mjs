import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
function core(){
 const ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder,selectionCalls:0})
 const instrumented=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','').replace('function selectForecast(item,lastMonth,history=baseAdoptedDemandHistory(item,lastMonth)){','function selectForecast(item,lastMonth,history=baseAdoptedDemandHistory(item,lastMonth)){globalThis.selectionCalls++;')
 vm.runInContext(instrumented+'\nthis.api={withEvaluationPass,evaluateDataset,orderGuidance,orderBucket,forecastDiary,forecastSelection,learningReport,learningEvents,prepareLearning,learningSettingsFromLog}',ctx)
 return ctx
}
function data(){return {months:Array.from({length:48},(_,i)=>`${2022+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`),as_of:'2025-12-31',items:Array.from({length:3},(_,i)=>({sku:`S${i}`,name:'Synthetic',unit:'ea',on_hand:100,on_order:0,supplier_days:14,monthly_sales:Array.from({length:48},(_,j)=>100+i+j%12)}))}}
for(const learning of [false,true])test(`one actual selection per SKU across evaluation/export/report/diary (learning=${learning})`,()=>{
 const ctx=core(),a=ctx.api,d=data(),diary=learning?d.items.map(item=>({version:1,sku:item.sku,as_of:'2025-11',method:'champion',scale:10,forecast:['2025-12','2026-01','2026-02'].map(month=>({month,p50:100,p80:120,p95:140}))})):[]
 a.withEvaluationPass(()=>{
  const settings={learning_enabled:learning},log=a.learningEvents(d,diary,settings)
  const ready=a.prepareLearning(d,diary,settings)
  const rows=a.evaluateDataset(ready,6,{},'2026-01-01')
  for(const item of rows){a.orderGuidance(item,'2026-01-01',{});a.orderBucket(item,'2026-01-01',{})}
  a.learningEvents(d,diary,settings,log);a.learningReport(d,diary,settings,log);a.forecastDiary(ready)
 })
 assert.equal(ctx.selectionCalls,d.items.length)
})
test('snapshot memo respects learning context, field presence, changed history, and pass cleanup',()=>{
 const ctx=core(),a=ctx.api,item=data().items[0],memo=new Map()
 const first=a.withEvaluationPass(()=>a.forecastSelection(item,'2025-12'),memo)
 assert.equal(a.withEvaluationPass(()=>a.forecastSelection({...item,on_hand:200},'2025-12'),memo),first)
 a.withEvaluationPass(()=>{
  assert.notEqual(a.forecastSelection({...item,demand_change_pct:15},'2025-12'),first)
  assert.notEqual(a.forecastSelection({...item,external_forecasts:null},'2025-12'),first)
  const learned={...item,_learning_context:{enabled:false}},second=a.forecastSelection(learned,'2025-12')
  learned._learning_context.enabled=true
  assert.notEqual(a.forecastSelection(learned,'2025-12'),second)
 },memo)
 assert.throws(()=>a.withEvaluationPass(()=>{throw Error('probe')}),/probe/)
 assert.notEqual(a.withEvaluationPass(()=>a.forecastSelection(item,'2025-12')),first)
})
const learningCases=[
 ['persisted disabled SKU',{kind:'correction_disabled',state:'disabled'},ctx=>ctx.enabled===false],
 ['durable owner decision',{kind:'owner_decision',state:'approved',proposal_kind:'bias_correction',proposal_id:'p',factor:1.15,requested_factor:1.3,before:[100],after:[115]},ctx=>ctx.approved_bias?.requested_factor===1.3],
 ['hysteresis prior factor',{kind:'bias_correction',state:'applied',factor:1.1},ctx=>ctx.prior_correction?.factor===1.1],
]
for(const [name,record,check] of learningCases)test(`memo and A3 snapshot invalidate for ${name} replayed from log`,()=>{
 const ctx=core(),a=ctx.api,d=data(),settings={learning_enabled:true},log=[]
 const diary=[{version:1,sku:'S0',as_of:'2025-11',method:'champion',scale:10,forecast:['2025-12','2026-01','2026-02'].map(month=>({month,p50:100,p80:120,p95:140}))}]
 // Exercise the real snapshot functions, not a copied cache implementation.
 Object.assign(ctx,{data:d,settings:{},learningSettings:settings,learningLog:log,learningDiary:diary,localToday:()=> '2026-01-01'})
 const app=fs.readFileSync(new URL('../standalone/design/app-a3.js',import.meta.url),'utf8')
 vm.runInContext(app.slice(app.indexOf('let evaluationSnapshot=null'),app.indexOf('const bucketNames='))+'\nthis.snapshot={run:withDatasetEvaluation,finish:finishEvaluationSnapshot,current:()=>evaluationSnapshot}',ctx)
 const read=()=>a.prepareLearning(d,diary,a.learningSettingsFromLog(d,settings,log)).items[0]
 let first
 ctx.snapshot.run(()=>{first=a.forecastSelection(read(),'2025-12');ctx.snapshot.finish()})
 const before=ctx.snapshot.current()
 ctx.snapshot.run(()=>assert.equal(a.forecastSelection(read(),'2025-12'),first))
 assert.equal(ctx.snapshot.current(),before)
 // A persisted record is older than the snapshot: decisions must remain durable.
 log.push({sku:'S0',when:'2025-11-30',...record})
 ctx.snapshot.run(()=>{
  const item=read()
  assert.ok(check(item._learning_context))
  assert.notEqual(a.forecastSelection(item,'2025-12'),first)
  assert.notEqual(ctx.snapshot.current(),before)
 })
 // Also protect prepared/selection memo keys within one explicit shared pass.
 const memo=new Map(),prior=a.withEvaluationPass(()=>a.forecastSelection(read(),'2025-12'),memo)
 log[0]={...log[0],...(record.kind==='correction_disabled'?{kind:'correction_enabled'}:record.kind==='owner_decision'?{requested_factor:1.4}:{factor:1.12})}
 a.withEvaluationPass(()=>assert.notEqual(a.forecastSelection(read(),'2025-12'),prior),memo)
})
