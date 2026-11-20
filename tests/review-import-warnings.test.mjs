// F2/F3/F4: synthetic reviewer probes and exact Python/Desktop import parity.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={understandStockWorkbook,reviewInputMeaning,reviewCsvInputMeaning,parseStockImport,importSerialize}',ctx)
const plain=x=>JSON.parse(JSON.stringify(x)),M=['2026-07','2026-08','2026-09']
const H=['sku','name','unit','on_hand','supplier_days','Warehouse','on_order',...M]
const row=(sku='A',name='Alpha',cost='1',supplier='One',lead='14',stock='10',location='East')=>[sku,name,'pcs',stock,lead,location,'0','30','30','30',cost,supplier]
const sheet=(name,rows)=>({name,rows}),header=[...H,'unit_cost','supplier']
function run(sheets,choices={},csv=false){
 const report=ctx.api.understandStockWorkbook(sheets,sheets[0].name)
 const review=csv?ctx.api.reviewCsvInputMeaning(sheets,ctx.api.parseStockImport(ctx.api.importSerialize(sheets[0].rows)),choices,'2026-11-20'):ctx.api.reviewInputMeaning(sheets,report,choices,'2026-11-20')
 const code=`import json,sys,types,importlib,tempfile,pathlib,csv,io\np=types.ModuleType('warning_pkg');p.__path__=['.'];sys.modules['warning_pkg']=p\ns=importlib.import_module('warning_pkg.smart_import');m=importlib.import_module('warning_pkg.input_meaning');c=importlib.import_module('warning_pkg.csv_import')\na=json.load(sys.stdin);r=s.understand_workbook(a['sheets'],sheet=a['sheets'][0]['name'])\nif a['csv']:\n out=io.StringIO();csv.writer(out).writerows(a['sheets'][0]['rows']);text=out.getvalue()\n with tempfile.TemporaryDirectory(dir='.scratch') as d:\n  f=pathlib.Path(d)/'case.csv';f.write_text(text);v=m.interpret_csv(f,c.preflight_csv(text),a['choices'],'2026-11-20')['input_meaning']\nelse: v=m.review_input_meaning(a['sheets'],r,a['choices'],'2026-11-20')\nprint(json.dumps(dict(report=r,review=v)))`
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{encoding:'utf8',input:JSON.stringify({sheets,choices,csv}),maxBuffer:16*1024*1024})
 assert.equal(py.status,0,py.stderr)
 const result=plain({report,review});if(csv)delete result.review.sheets
 assert.deepEqual(result,JSON.parse(py.stdout),'complete Python/JS parity');return result
}
for(const held of ['60','0'])test('F2 joined no-stock allocations clear false missing provenance: '+held,()=>{
 const stock=row().slice(0,H.length);stock[6]=''
 const {report,review}=run([sheet('Stock',[H,stock]),sheet('Allocations',[['sku','reserved','on_order'],['A',held,'50']])],{stock_includes_reserved:true})
 assert.deepEqual(report.reserved_missing,{})
 assert.ok(!review.warnings.some(w=>/Reserved stock missing|no reserved column/.test(w)))
 const adjusted=ctx.api.understandStockWorkbook(review.sheets),v=Object.fromEntries(adjusted.canonical_rows[0].map((f,i)=>[f,adjusted.canonical_rows[1][i]]))
 assert.equal(v.on_hand,held==='60'?'0':'10');assert.equal(v.on_order,'50')
})
for(const csv of [false,true])test('F3 name/cost/supplier differences are one compact informational warning: csv '+csv,()=>{
 const rows=[header,...Array.from({length:15},(_,i)=>[row('S'+i),row('S'+i,'Other','2','Two','14','20','West')]).flat()]
 const {report,review}=run([sheet('CSV',rows)],{},csv)
 assert.equal(review.requires_ack,false)
 const summaries=review.warnings.filter(w=>w.startsWith('Metadata differences'))
 assert.equal(summaries.length,1);assert.match(summaries[0],/15 SKUs/);assert.match(summaries[0],/S0, S1, S2, S3, S4, S5, S6, S7, S8, S9/);assert.match(summaries[0],/5 more/);assert.ok(!summaries[0].includes('S10'))
 assert.equal(report.canonical_rows[1][report.canonical_rows[0].indexOf('on_hand')],'30')
})
test('F3 cross-sheet metadata remains informational while quantities still sum',()=>{
 const {review}=run([sheet('East',[header,row()]),sheet('West',[header,row('A','Other','2','Two')])])
 assert.ok(review.requires_ack);assert.ok(!review.reasons.some(w=>/conflicting (name|unit_cost|supplier) for/.test(w)))
 assert.equal(review.warnings.filter(w=>w.startsWith('Metadata differences')).length,1)
})
for(const csv of [false,true])test('F3 lead conflicts remain blocking and bounded for long identifiers: csv '+csv,()=>{
 const rows=[header,...Array.from({length:120},(_,i)=>{const sku='SKU'+i+'x'.repeat(700);return [row(sku),row(sku,'Alpha','1','One','180','20','West')]}).flat()]
 const {report,review}=run([sheet('CSV',rows)],{},csv)
 assert.ok(review.requires_ack);assert.ok(review.reasons.some(w=>w.includes('conflicting supplier_days')))
 for(const messages of [report.warnings,review.reasons,review.warnings]){assert.ok(messages.length<=101);assert.ok(messages.every(w=>w.length<=512))}
})
test('F3 warning budgets apply across sheets, not once per sheet',()=>{
 const rows=[header,...Array.from({length:120},(_,i)=>[row('SKU'+i),row('SKU'+i,'Alpha','1','One','180','20','West')]).flat()]
 const {report,review}=run(['East','West'].map(name=>sheet(name,rows)))
 assert.ok(review.requires_ack)
 for(const messages of [report.warnings,review.reasons,review.warnings])assert.ok(messages.length<=101)
})
test('F4 blank base stock is filled, not added together',()=>{
 const {report,review}=run([sheet('Blank',[H,row('A','Alpha','1','One','14','').slice(0,H.length)]),sheet('Stock',[H,row().slice(0,H.length)])])
 assert.equal(report.canonical_rows[1][report.canonical_rows[0].indexOf('on_hand')],'10')
 assert.ok(review.warnings.some(w=>/filled/i.test(w)));assert.ok(!review.warnings.some(w=>/added together/.test(w)))
})
for(const csv of [false,true])test('F4 single-sheet absent reserved column has one disclosure: csv '+csv,()=>{
 const {review}=run([sheet('CSV',[H,row().slice(0,H.length)])],{stock_includes_reserved:true},csv)
 assert.equal(review.warnings.filter(w=>/Reserved stock missing|no reserved column/.test(w)).length,1)
 assert.equal(review.affected[0].warnings.filter(w=>/Reserved stock missing|no reserved column/.test(w)).length,1)
})
test('F4 filling a blank then adding another warehouse still discloses addition',()=>{
 const {review}=run([sheet('Blank',[H,row('A','Alpha','1','One','14','').slice(0,H.length)]),...['East','West'].map(name=>sheet(name,[H,row().slice(0,H.length)]))])
 assert.ok(review.reasons.some(w=>/added together/.test(w)))
})
