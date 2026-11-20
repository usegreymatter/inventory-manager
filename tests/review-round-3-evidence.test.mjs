import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={reviewInputMeaning,understandStockWorkbook}',ctx)
const plain=x=>JSON.parse(JSON.stringify(x))
test('warehouse sheet aggregation always names the contributing sheets',()=>{
 const headers=['sku','name','on_hand','reserved','on_order','2026-07','2026-08','2026-09']
 const sheets=['East','West'].map(name=>({name,rows:[headers,['A','Alpha','10','2','3','1','1','1']]}))
 const report=ctx.api.understandStockWorkbook(sheets)
 assert.ok(report.warnings.some(w=>w.includes('Combined stock from sheets East, West')))
})
test('canonical review preserves source evidence and per-product launch explanation with Python parity',()=>{
 const months=Array.from({length:12},(_,i)=>`2025-${String(i+1).padStart(2,'0')}`)
 const sheets=[{name:'Stock',rows:[['sku','name','on_hand',...months],['NEW1','New item','0',...Array(10).fill(''),'3','4']]}]
 const report=plain(ctx.api.understandStockWorkbook(sheets)),result=plain(ctx.api.reviewInputMeaning(sheets,report,{},'2026-11-20'))
 const code=`import json,sys,types,importlib\np=types.ModuleType('sr');p.__path__=['.'];sys.modules['sr']=p\nm=importlib.import_module('sr.input_meaning');a=json.load(sys.stdin);print(json.dumps(m.review_input_meaning(**a)))`
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{encoding:'utf8',input:JSON.stringify({sheets,report,today:'2026-11-20'})})
 assert.equal(run.status,0,run.stderr);assert.deepEqual(result,JSON.parse(run.stdout))
 assert.ok(result.affected.find(r=>r.sku==='NEW1').warnings.includes('New product: 10 months before first sale ignored'))
 assert.equal(result.requires_ack,false)
})
