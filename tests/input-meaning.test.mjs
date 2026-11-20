import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={reviewInputMeaning,understandStockWorkbook,attachInputMeaning,parseCsv}',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x)),cell=(r,i,field)=>r.sheets[0].rows[i][r.sheets[0].rows[0].indexOf(field)]
const header=['sku','name','unit','on_hand','supplier_days','2026-07','2026-08','2026-09','reserved','on_order','Sales unit']
const rows=[header,['A','Alpha','pcs','10','14','3','3','3','4','50','boxes'],['B','Beta','pcs','20','14','','3','3','2','','pcs']]
function review(rows,choices={},today='2026-11-19'){
 const sheets=[{name:'Stock',rows,delimiter:','}],report=api.understandStockWorkbook(sheets)
 const result=plain(api.reviewInputMeaning(sheets,report,choices,today))
 const code=`import importlib,json,sys,types\np=types.ModuleType('stock_runway');p.__path__=['.'];sys.modules['stock_runway']=p\nm=importlib.import_module('stock_runway.input_meaning')\na=json.load(sys.stdin);print(json.dumps(m.review_input_meaning(**a)))`
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{input:JSON.stringify({sheets,report:plain(report),raw_choices:choices,today}),encoding:'utf8'})
 assert.equal(run.status,0,run.stderr);assert.deepEqual(result,JSON.parse(run.stdout),'Python/JS parity')
 assert.deepEqual(sheets[0].rows,rows,'source rows unchanged')
 return result
}
test('input-meaning parity: reserved subtraction, incoming unknown, units mismatch and missing-row guard',()=>{
 const r=review(rows,{stock_includes_reserved:true,incoming_not_in_file:true,units_confirmed:true})
 assert.equal(+r.sheets[0].rows[1][3],6);assert.equal(+r.sheets[0].rows[2][3],18)
 assert.equal(cell(r,1,'on_order'),'0');assert.deepEqual(r.incoming_unknown,['A','B'])
 assert.ok(r.warnings.some(w=>w.startsWith('Sales and stock units disagree')));assert.equal(r.requires_ack,true)
 const data=api.attachInputMeaning({items:[{sku:'A',on_order:50}]},r)
 assert.equal(data.items[0].on_order,undefined);assert.equal(data.items[0].incoming_unknown,true)
})
test('input-meaning defaults preserve stock and known incoming; missing incoming remains unknown',()=>{
 const r=review(rows)
 assert.equal(r.sheets[0].rows[1][3],'10');assert.equal(cell(r,1,'on_order'),'50');assert.deepEqual(r.incoming_unknown,['B']);const data=api.attachInputMeaning({items:[{sku:'B'}]},r);assert.equal(data.items[0].incoming_unknown,true)
})
test('input-meaning guard is strictly above 20%, future dates always require acknowledgement',()=>{
 const clean=rows[1].slice();clean[10]='pcs'
 const at=[header,...Array.from({length:5},(_,i)=>{const r=clean.slice();r[0]=String(i);if(!i)r[6]='';return r})]
 assert.equal(review(at).requires_ack,false)
 at[2][6]='';assert.equal(review(at).requires_ack,true)
 const shifted=structuredClone(at);shifted[0][7]='2027-09';assert.ok(review(shifted).reasons.some(s=>s.startsWith('Sales dates')))
})
test('reserved absence and invalid reserved values never silently subtract zero',()=>{
 const absent=rows.map(r=>r.filter((_,i)=>i!==8));assert.ok(review(absent,{stock_includes_reserved:true}).warnings.some(s=>s.includes('no reserved column')))
 for(const bad of ['oops','-1']){const v=structuredClone(rows);v[1][8]=bad;assert.equal(review(v,{stock_includes_reserved:true}).sheets[0].rows[1][3],'Invalid reserved stock')}
})
test('input meaning mirror is embedded verbatim',()=>{
 assert.equal(source.split('// INPUT_MEANING_START\n')[1].split('// INPUT_MEANING_END\n')[0],fs.readFileSync('desktop/input-meaning.js','utf8'))
})

test('separate sales sheet missing products and blank quantities trigger the same Python/JS guard',()=>{
 const sheets=[{name:'Stock',rows:[['sku','name','unit','on_hand'],['A','Alpha','pcs','10'],['B','Beta','pcs','10'],['C','Gamma','pcs','10']]},{name:'Sales',rows:[['sku','date','quantity','unit'],['A','2026-07-01','3','pcs'],['A','2026-08-01','','pcs'],['A','2026-09-01','3','pcs']]}]
 const report=plain(api.understandStockWorkbook(sheets)),today='2026-11-19',actual=plain(api.reviewInputMeaning(sheets,report,{},today))
 const code=`import importlib,json,sys,types
p=types.ModuleType('stock_runway');p.__path__=['.'];sys.modules['stock_runway']=p
m=importlib.import_module('stock_runway.input_meaning')
a=json.load(sys.stdin);print(json.dumps(m.review_input_meaning(**a)))`
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{input:JSON.stringify({sheets,report,raw_choices:{},today}),encoding:'utf8'})
 assert.equal(run.status,0,run.stderr);assert.deepEqual(actual,JSON.parse(run.stdout));assert.equal(actual.missing_rows,2);assert.equal(actual.missing_sales_rows,1);assert.equal(actual.requires_ack,true)
})
test('invalid reserved stock remains a persistent warning and explicit override reason',()=>{
 const v=structuredClone(rows);v[1][8]='oops';const result=review(v,{stock_includes_reserved:true})
 assert.ok(result.warnings.some(s=>s.includes('they were set aside')));assert.ok(result.reasons.some(s=>s.includes('they were set aside')))
})
