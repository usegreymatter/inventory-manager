import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const src=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(src.slice(src.indexOf('const SAMPLE ='),src.indexOf('const pageStyle =')).replaceAll('export ','')+`
this.api={calculate,orderGuidance,forecastSelection,withEvaluationPass};
this.calls=[];const originalSelect=selectForecast;
selectForecast=(item,...args)=>{calls.push(item.sku);return originalSelect(item,...args)};
`,ctx)
test('ignored optional archive has a compact health warning in the JS port',()=>{
 const health=fs.readFileSync(new URL('../standalone/design/health.js',import.meta.url),'utf8')
 vm.runInContext(health+';this.dataHealth=dataHealth',ctx)
 const result=ctx.dataHealth({external_ignored:true})
 assert.ok(result.warnings.some(w=>w.code==='external_ignored'&&w.short_label==='Import ignored'))
})
test('smart forecast stays locked until four rolling origins exist',()=>{
 for(const n of [18,24,27,28]){
  const r=ctx.api.forecastSelection({monthly_sales:Array(n).fill(10)},'2026-10')
  assert.equal(r.state,n>=28?'on':'locked');assert.equal(r.tested_months,n>=28?n-24:0)
 }
 const why=fs.readFileSync(new URL('../standalone/design/why-a3.js',import.meta.url),'utf8')
 assert.ok(why.includes('if(forecast.tested_months>0)'))
})
test('guidance evaluates selection once per SKU and discards the memo after each pass',()=>{
 const raw={sku:'PERF',name:'Synthetic',unit:'box',on_hand:100,supplier_days:14,monthly_sales:Array.from({length:36},(_,i)=>10+i),receipts:{}}
 const months=raw.monthly_sales.map((_,i)=>new Date(Date.UTC(2023,10+i,1)).toISOString().slice(0,7))
 const item={...ctx.api.calculate([raw],months,'2026-10-31',6)[0],on_order:20}
 ctx.calls.length=0
 ctx.api.orderGuidance(item,'2026-11-01')
 assert.deepEqual([...ctx.calls],['PERF'])
 ctx.api.orderGuidance(item,'2026-11-01')
 assert.deepEqual([...ctx.calls],['PERF','PERF'])
})
test('pass memo invalidates nested diary, approval and correction changes',()=>{
 const item={monthly_sales:Array.from({length:48},(_,i)=>100+i%2*10),_learning_context:{enabled:false,entries:Array.from({length:6},(_,i)=>({month:`2026-${String(i+5).padStart(2,'0')}`,prediction:100,actual:110,error:10,scale:10}))}}
 ctx.api.withEvaluationPass(()=>{
  const checked=()=>{
   const selected=ctx.api.forecastSelection(item,'2026-10'),adopted=ctx.adoptedDemandHistory(item,'2026-10')
   assert.equal(JSON.stringify(selected),JSON.stringify(ctx.selectForecast(item,'2026-10')))
   assert.equal(JSON.stringify(adopted),JSON.stringify(ctx.adoptHistory(item,'2026-10')))
   assert.equal(ctx.api.forecastSelection(item,'2026-10'),selected)
   assert.equal(ctx.adoptedDemandHistory(item,'2026-10'),adopted)
   return selected
  }
  const before=checked();item._learning_context.enabled=true
  const enabled=checked();assert.notEqual(enabled,before);assert.ok(enabled.learning)
  item._learning_context.entries.forEach(r=>{r.error=100;r.actual=200})
  const proposed=checked();assert.notEqual(proposed,enabled);assert.equal(proposed.learning.state,'proposal')
  item._learning_context.approved_bias={...proposed.learning}
  assert.notEqual(checked(),proposed)
  item._learning_context.enabled=false;assert.equal(checked().learning,undefined)
 })
})
