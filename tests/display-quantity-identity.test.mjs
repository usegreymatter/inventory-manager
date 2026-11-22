import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import beforeDisplay from './reviewed-display-delta.cjs'
import beforeCombinedImports from './reviewed-combined-import-delta.cjs'
import beforeRename from './reviewed-rename-delta.cjs'
import beforeV121 from './reviewed-v121-delta.cjs'
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'),sha=s=>createHash('sha256').update(s).digest('hex')
const bytes=fs.readFileSync(new URL('fixtures/v12-display-quantity-cases.json.gz',import.meta.url))
assert.equal(sha(bytes),'c4aad32e2b16491c4259d847ab255e6d362dc7f2b09a627285bc06c322f0a17a')
const fixture=JSON.parse(gunzipSync(bytes)),source=read('desktop/plugin.js'),delta=JSON.parse(read('tests/fixtures/v12-display-approved-delta.json'))
function runtime(source){const c=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl});vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={calculate,orderGuidance}',c);return c.api}
const old=runtime(beforeDisplay(source,'plugin')),now=runtime(source)
function project(api,data,today,settings){return api.calculate(data.items,data.months,data.as_of,6,settings,today).map(i=>{const g=api.orderGuidance({...i,as_of:data.as_of},today,settings,data.as_of);return [i.sku,g.quantity,g.uncapped_qty??null,g.shelf_cap_qty??null,g.profit_suggestion?.qty??null,g.profit_suggestion?.alt.map(a=>a.qty)??null]})}
test('exact display deltas reconstruct ce20b2d and reject unknown protected mutations',()=>{
 assert.equal(sha(beforeDisplay(beforeCombinedImports(beforeRename(beforeV121(source,'plugin'),'plugin')),'plugin')),delta.plugin_before_sha256)
 assert.equal(sha(beforeDisplay(read('engine.py'),'engine')),delta.engine_before_sha256)
 assert.throws(()=>beforeCombinedImports(beforeV121(source,'plugin').replace('missing lot quantity','UNKNOWN IMPORT MUTATION')))
 assert.throws(()=>beforeDisplay(source.replace('if(capTicks<=0)','if(capTicks<0)'),'plugin'))
 assert.notEqual(sha(beforeDisplay(source+'\nUNKNOWN','plugin')),delta.plugin_before_sha256)
})
test('R3, all golden inputs, eight ERP examples, sample and M1/p.csv retain every quantity before/after display fix in JS and Python',()=>{
 assert.equal(fixture.r3_cases,562);assert.equal(fixture.r3_parsed,fixture.cases.filter(c=>c.id.startsWith('r3/')).length)
 assert.equal(fixture.cases.filter(c=>c.id.startsWith('r3/erp-')).length,8)
 assert.equal(fixture.cases.length,573)
 const results=[]
 for(const c of fixture.cases){
  for(const cover of [null,0,3]){
   const settings=JSON.parse(JSON.stringify(c.settings))
   if(cover!==null){settings.product_overrides??={};for(const i of c.data.items)settings.product_overrides[i.sku]={...settings.product_overrides[i.sku],months_of_cover:cover}}
   const before=project(old,c.data,c.today,settings),after=project(now,c.data,c.today,settings)
   assert.equal(JSON.stringify(after),JSON.stringify(before),c.id+' cover '+cover)
   results.push({id:c.id,data:c.data,today:c.today,settings,quantities:after})
  }
 }
 const economics={items:[{sku:'ECON',name:'Synthetic economics',unit:'u',monthly_sales:Array(12).fill(300),on_hand:0,on_order:0,supplier_days:10,unit_cost:1,sale_price:100,receipts:{}}],months:Array.from({length:12},(_,i)=>i<2?'2025-'+(i+11):'2026-'+String(i-1).padStart(2,'0')),as_of:'2026-10-31'}
 for(const capLife of [null,0,1,90])for(const cover of [0,3]){
  const data=JSON.parse(JSON.stringify(economics));if(capLife!==null)data.items[0].shelf_life_days=capLife
  const settings={profit_suggestion:true,product_overrides:{ECON:{months_of_cover:cover}}},today='2026-11-01'
  const before=project(old,data,today,settings),after=project(now,data,today,settings)
  assert.equal(JSON.stringify(after),JSON.stringify(before),'profit cover '+cover+' life '+capLife)
  results.push({id:'profit/'+capLife+'/'+cover,data,today,settings,quantities:after})
 }
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',[new URL('quantity_identity_bridge.py',import.meta.url).pathname],{input:JSON.stringify(results),encoding:'utf8',cwd:new URL('..',import.meta.url),maxBuffer:20*1024*1024})
 assert.equal(py.status,0,py.stderr);assert.equal(JSON.parse(py.stdout).cases,1727)
})
