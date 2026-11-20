import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={reviewInputMeaning,understandStockWorkbook}',ctx)
const plain=x=>JSON.parse(JSON.stringify(x)),months=['2026-07','2026-08','2026-09']
function run(sheets,choices={},sheet=null){
 const report=ctx.api.understandStockWorkbook(sheets,sheet),review=ctx.api.reviewInputMeaning(sheets,report,choices,'2026-11-20'),adjusted=ctx.api.understandStockWorkbook(review.sheets)
 const result=plain({report,review,adjusted})
 const code=`import json,sys,types,importlib\np=types.ModuleType('final_pkg');p.__path__=['.'];sys.modules['final_pkg']=p\ns=importlib.import_module('final_pkg.smart_import');m=importlib.import_module('final_pkg.input_meaning')\na=json.load(sys.stdin);r=s.understand_workbook(a['sheets'],sheet=a['sheet']);v=m.review_input_meaning(a['sheets'],r,a['choices'],'2026-11-20');print(json.dumps(dict(report=r,review=v,adjusted=s.understand_workbook(v['sheets']))))`
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{encoding:'utf8',input:JSON.stringify({sheets,choices,sheet})})
 assert.equal(py.status,0,py.stderr);assert.deepEqual(result,JSON.parse(py.stdout),'exact complete Python/JS report parity')
 return result
}
const values=report=>Object.fromEntries(report.canonical_rows[0].map((f,i)=>[f,report.canonical_rows[1][i]]))
for(const base of ['Stock','Sales'])for(const wide of [false,true])test(`long ledger snapshots never sum with stock: base ${base}, wide ${wide}`,()=>{
 const stock={name:'Stock',rows:[['sku','name','on_hand',...(wide?months:[])],['A','Alpha','100',...(wide?['30','30','30']:[])]]}
 const sales={name:'Sales',rows:[['sku','name','date','qty','on_hand'],...months.map(m=>['A','Alpha',m+'-05','30','100'])]}
 const {report}=run([stock,sales],{},base),v=values(report)
 assert.equal(v.on_hand,'100');for(const m of months)assert.equal(v[m],'30')
 assert.ok(!report.warnings.some(w=>w.startsWith('Combined stock from sheets')))
})
test('different snapshots keep the selected base and demand acknowledgement',()=>{
 const sheets=[{name:'Stock',rows:[['sku','name','on_hand'],['A','Alpha','100']]},{name:'Sales',rows:[['sku','date','qty','on_hand'],['A','2026-07-05','30','90']]}]
 for(const base of ['Stock','Sales']){const {report,review}=run(sheets,{},base);assert.equal(values(report).on_hand,base==='Stock'?'100':'90');assert.equal(review.requires_ack,true)}
})
test('ambiguous wide stock with incompatible sales columns keeps stock and requires acknowledgement',()=>{
 const sheets=[{name:'Stock',rows:[['sku','name','on_hand'],['A','Alpha','100']]},{name:'Sales',rows:[['sku','on_hand',...months],['A','100','30','30','30']]}]
 for(const base of ['Stock','Sales']){const {report,review}=run(sheets,{},base);assert.equal(values(report).on_hand,'100');for(const m of months)assert.equal(values(report)[m],'30');assert.equal(review.requires_ack,true);assert.match(review.reasons.join(' '),/quantity schema|ambiguous/i)}
})
test('compatible East and West warehouse sheets still sum each quantity',()=>{
 const h=['sku','name','on_hand','reserved','on_order',...months,'rcv:2026-09']
 const {report,review}=run(['East','West'].map(name=>({name,rows:[h,['A','Alpha','100','40','5','30','30','30','7']]})))
 const v=values(report);assert.equal(v.on_hand,'200');assert.equal(v.reserved,'80');assert.equal(v.on_order,'10');assert.equal(v['2026-07'],'60');assert.equal(v['rcv:2026-09'],'14');assert.equal(review.requires_ack,true);assert.ok(review.reasons.some(w=>w.startsWith('Stock from sheets East, West was added together.')));assert.ok(review.affected[0].warnings.some(w=>w.startsWith('Stock from sheets East, West was added together.')))
})
test('cross-sheet conflicting stock units require acknowledgement',()=>{
 const h=['sku','name','on_hand','unit',...months]
 const {report,review}=run([{name:'East',rows:[h,['A','Alpha','100','pcs','30','30','30']]},{name:'West',rows:[h,['A','Alpha','50','boxes','30','30','30']]}])
 assert.equal(values(report).on_hand,'100');assert.equal(review.requires_ack,true);assert.match(review.reasons.join(' '),/conflicting stock units/)
})
test('already-available provenance survives a separate reserved allocation sheet',()=>{
 const sheets=[{name:'Stock',rows:[['sku','name','available qty',...months],['A','Alpha','100','30','30','30']]},{name:'Allocations',rows:[['sku','reserved'],['A','40']]}]
 const {review,adjusted}=run(sheets,{stock_includes_reserved:true})
 assert.equal(values(adjusted).on_hand,'60');assert.ok(review.warnings.some(w=>w.startsWith('Stock header says already available')));assert.ok(review.affected.find(r=>r.sku==='A').warnings.some(w=>w.startsWith('Stock header says already available')))
 const untouched=run(sheets).review;assert.ok(!untouched.warnings.some(w=>w.startsWith('Stock header says already available')))
})
test('source and canonical unit and missing evidence produce unique warnings and reasons',()=>{
 const sheets=[{name:'Stock',rows:[['sku','name','on_hand','Stock unit',...months],['A','Alpha','100','pcs','30','','30']]},{name:'Sales units',rows:[['sku','Sales unit'],['A','boxes']]}]
 const {review}=run(sheets)
 assert.equal(review.warnings.length,new Set(review.warnings).size);assert.equal(review.reasons.length,new Set(review.reasons).size)
 assert.equal(review.warnings.filter(w=>w.startsWith('Sales and stock units')).length,1);assert.equal(review.reasons.filter(w=>w.startsWith('More than 20%')).length,1)
})
