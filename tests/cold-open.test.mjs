import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const health=fs.readFileSync(new URL('../standalone/design/health.js',import.meta.url),'utf8')
function fixture(){const c=vm.createContext({console});vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\n'+health+'\nglobalThis.api={calculate,orderGuidance,withEvaluationPass,dataHealth,SAMPLE}',c);return c.api}
test('exact-input guidance memo reuses unchanged calls, not changed stock/settings',()=>{
 const a=fixture(),raw={...a.SAMPLE.items[0],on_order:0},item=a.calculate([raw],a.SAMPLE.months,a.SAMPLE.as_of,6)[0],options={months_of_cover:2}
 a.withEvaluationPass(()=>{
  const first=a.orderGuidance(item,a.SAMPLE.as_of,options,a.SAMPLE.as_of)
  assert.equal(a.orderGuidance(item,a.SAMPLE.as_of,options,a.SAMPLE.as_of),first)
  item.on_hand+=7;assert.notEqual(a.orderGuidance(item,a.SAMPLE.as_of,options,a.SAMPLE.as_of),first)
  const second=a.orderGuidance(item,a.SAMPLE.as_of,options,a.SAMPLE.as_of);options.months_of_cover=1
  assert.notEqual(a.orderGuidance(item,a.SAMPLE.as_of,options,a.SAMPLE.as_of),second)
 })
 assert.deepEqual(JSON.parse(JSON.stringify(a.orderGuidance(item,a.SAMPLE.as_of,options,a.SAMPLE.as_of))),JSON.parse(JSON.stringify(a.orderGuidance(item,a.SAMPLE.as_of,options,a.SAMPLE.as_of))))
})
test('lazy health has identical warnings and serialized feature values',()=>{
 const a=fixture(),data=JSON.parse(JSON.stringify(a.SAMPLE));data.items[0].calendar_forecast=true
 const eager=a.dataHealth(data,data.as_of,{}),lazy=a.dataHealth(data,data.as_of,{}, {lazy:true})
 assert.equal(typeof Object.getOwnPropertyDescriptor(lazy.features,'smart_forecast').get,'function')
 assert.deepEqual(JSON.parse(JSON.stringify(lazy.warnings)),JSON.parse(JSON.stringify(eager.warnings)))
 assert.equal(JSON.stringify(lazy),JSON.stringify(eager))
 assert.equal(Object.getOwnPropertyDescriptor(lazy.features,'smart_forecast').get,undefined)
})
