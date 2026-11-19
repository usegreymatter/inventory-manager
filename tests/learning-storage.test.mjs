import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const loader=fs.readFileSync(new URL('../standalone/design/learning-a3.js',import.meta.url),'utf8')
for(const bad of ['settings','diary','log'])test(`real A3 loader preserves archives when ${bad} is corrupt`,()=>{
 const keys={settings:'stock-runway.learning.settings.v1',diary:'stock-runway.forecast-diary.v1',log:'stock-runway.learning-log.v1'}
 const values=new Map([[keys.settings,JSON.stringify({archive_enabled:true,learning_enabled:true})],[keys.diary,'[{"sku":"KEEP"}]'],[keys.log,'[{"id":"KEEP"}]']]);values.set(keys[bad],'{torn')
 const before=new Map(values),writes=[],status={textContent:''},body={dataset:{},replaceChildren(){},append(){}}
 const ctx=vm.createContext({localStorage:{getItem:k=>values.get(k),setItem(k,v){writes.push(k);values.set(k,v)}},normalizeLearningSettings:v=>v||{},$:id=>id==='accuracy-report'?body:status,render(){},data:{},appendLearningRows:(a,b)=>[...a,...b],learningEvents:()=>[{id:'NEW'}],forecastDiary:()=>[{sku:'NEW'}],learningReport:()=>({state:'hidden'}),node:(_tag,text)=>text,STRINGS:{learningOptIn:'Opt in'}})
 vm.runInContext(loader+'\nrecordLearning({});decideLearning("x","approve");updateLearningPanel();this.snapshot={learningDiary,learningLog}',ctx)
 assert.deepEqual(writes.filter(k=>k===keys.diary||k===keys.log),[])
 assert.equal(values.get(keys.diary),before.get(keys.diary));assert.equal(values.get(keys.log),before.get(keys.log))
 assert.equal(status.textContent,'Learning paused')
 if(bad!=='diary')assert.equal(ctx.snapshot.learningDiary[0].sku,'KEEP')
 if(bad!=='log')assert.equal(ctx.snapshot.learningLog[0].id,'KEEP')
})
test('real loader defers settings validation until core constants initialize',()=>{
 const core=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
 const stored={learning_enabled:true,learning_approved_methods:{KEEP:{when:'2026-10-31',method_after:'baseline'}}}
 const ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder,localStorage:{getItem:key=>key.includes('settings')?JSON.stringify(stored):null},$:()=>({addEventListener(){}})})
 vm.runInContext(loader+'\n'+core.slice(core.indexOf('const SAMPLE ='),core.indexOf('const pageStyle =')).replaceAll('export ','')+'\ninitializeLearning();this.saved=learningSettings',ctx)
 assert.equal(ctx.saved.learning_approved_methods.KEEP.method_after,'baseline')
})
