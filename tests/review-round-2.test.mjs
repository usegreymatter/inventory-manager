import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={reviewInputMeaning,understandStockWorkbook,attachInputMeaning,parseStockImport,importSerialize}',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x)),header=['sku','name','unit','on_hand','supplier_days','2026-07','2026-08','2026-09','reserved','on_order','Sales unit']
function check(sheets,choices={},today='2026-11-19',acceptedRows=null){
 const report=plain(api.understandStockWorkbook(sheets));if(acceptedRows){delete report.review_sheets;delete report.review_report;report.sheets[0].accepted_rows=acceptedRows}
 const review=plain(api.reviewInputMeaning(sheets,report,choices,today))
 const code=`import importlib,json,sys,types\np=types.ModuleType('sr');p.__path__=['.'];sys.modules['sr']=p\nm=importlib.import_module('sr.input_meaning')\na=json.load(sys.stdin);print(json.dumps(m.review_input_meaning(**a)))`
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{input:JSON.stringify({sheets,report,raw_choices:choices,today}),encoding:'utf8'})
 assert.equal(run.status,0,run.stderr);assert.deepEqual(review,JSON.parse(run.stdout),'review Python/JS parity')
 return review
}
function rowsCheck(rows,choices={},delimiter=',',today='2026-11-19'){const located=rows.map((r,i)=>[...r,i?'Site '+i:'Warehouse']);return check([{name:'Stock',rows:located,delimiter}],choices,today)}
function attached(data,review){
 const input=JSON.stringify({data:plain(data),review:plain(review)}),result=plain(api.attachInputMeaning(data,review))
 const code=`import importlib,json,sys,types\np=types.ModuleType('sr');p.__path__=['.'];sys.modules['sr']=p\nm=importlib.import_module('sr.input_meaning')\na=json.load(sys.stdin);print(json.dumps(m.attach_input_meaning(**a)))`
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{input,encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.deepEqual(result,JSON.parse(run.stdout),'attach Python/JS parity');return result
}
function imported(review){const report=api.understandStockWorkbook(review.sheets);return attached(api.parseStockImport(api.importSerialize(report.canonical_rows)),review)}
test('R2 Astra 1 nets reservations across warehouses before flooring',()=>{
 for(const reverse of [false,true]){
  const rows=[['A','Alpha','pcs','10','14','10','10','10','100','0','pcs'],['A','Alpha','pcs','100','14','10','10','10','0','0','pcs']];if(reverse)rows.reverse()
  const r=rowsCheck([header,...rows],{stock_includes_reserved:true}),data=imported(r)
  assert.equal(data.items[0].on_hand,10);assert.ok(r.warnings.some(w=>w.startsWith('Oversold:')))
 }
 const r=rowsCheck([header,['A','Alpha','pcs','10','14','10','10','10','100','0','pcs']],{stock_includes_reserved:true})
 assert.equal(imported(r).items[0].on_hand,0)
})
test('R2 Astra 2 partial incoming preserves known supply and uncertainty',()=>{
 const r=rowsCheck([header,['A','Alpha','pcs','10','14','3','3','3','0','100','pcs'],['A','Alpha','pcs','100','14','3','3','3','0','','pcs']])
 assert.deepEqual(r.incoming_unknown,['A']);assert.ok(r.warnings.some(w=>w.startsWith('Incoming partly unknown')))
 const data=imported(r);assert.equal(data.items[0].on_order,100);assert.equal(data.items[0].incoming_unknown,true)
})
test('R2 Astra 3 all contributing units checked independently of row order',()=>{
 for(const reverse of [false,true]){
  const rows=[['A','Alpha','pcs','10','14','10','10','10','0','0','boxes'],['A','Alpha','pcs','100','14','10','10','10','0','0','pcs']];if(reverse)rows.reverse()
  const r=rowsCheck([header,...rows]);assert.equal(r.requires_ack,true);assert.ok(r.warnings.some(w=>w.startsWith('Sales and stock units')))
 }
 const r=rowsCheck([header,['A','Alpha','boxes','10','14','3','3','3','0','0',''],['A','Alpha','pcs','10','14','3','3','3','0','0','']]);assert.equal(r.requires_ack,true)
})
test('R2 Astra 4 decimal comma survives exact-integer reserved subtraction and reparse',()=>{
 const r=rowsCheck([header,['A','Alpha','pcs','10,5','14','1.000','1.000','1.000','0,5','0','pcs']],{stock_includes_reserved:true},';')
 // Joined review uses normalized decimal-dot facts; CSV convention proof lives in R3 legacy CSV regression.
 assert.equal(r.sheets[0].rows[1][3],'10');const data=imported(r);assert.equal(data.items[0].on_hand,10);assert.equal(data.items[0].monthly_sales[0],1000)
})
test('R2 wide monthly sales are evidence for joined stock workbook',()=>{
 const r=check([{name:'Stock',rows:[['sku','name','unit','on_hand'],['A','Alpha','pcs','10']]},{name:'Sales',rows:[['sku','2026-07','2026-08','2026-09'],['A','3','3','3']]}]);assert.equal(r.missing_rows,0);assert.equal(r.requires_ack,false)
})
test('R2 Opus F1 prelaunch blanks excluded, internal and all-blank sales still missing',()=>{
 const launched=rowsCheck([header,['A','Alpha','pcs','10','14','','3','3','0','0','pcs']]);assert.equal(launched.requires_ack,false);assert.equal(launched.missing_rows,0);assert.equal(launched.not_yet_launched_cells,1)
 for(const values of [['3','','3'],['','','']]){const r=rowsCheck([header,['A','Alpha','pcs','10','14',...values,'0','0','pcs']]);assert.equal(r.requires_ack,true);assert.equal(r.missing_rows,1)}
 const r=check([{name:'Stock',rows:[['sku','name','on_hand'],['A','Alpha','10']]},{name:'Sales',rows:[['sku','date','quantity'],['A','2026-07-01',''],['A','2026-08-01','3'],['A','2026-09-01','3']]}]);assert.equal(r.missing_sales_rows,0);assert.equal(r.not_yet_launched_cells,1);assert.equal(r.requires_ack,false)
})
test('R2 Opus F3 current month warning only; values unchanged and require ack',()=>{
 const rows=[['sku','name','unit','on_hand','2026-07','2026-08','2026-11'],['A','Alpha','pcs','10','3','3','1']],r=rowsCheck(rows)
 assert.deepEqual(r.sheets[0].rows,[[...rows[0].slice(0,4),'supplier_days',...rows[0].slice(4)],[...rows[1].slice(0,4),'',...rows[1].slice(4)]]);assert.equal(r.requires_ack,true);assert.ok(r.warnings.includes('Latest month (2026-11) is still in progress — partial sales may lower the forecast. Remove it or wait for month end.'))
 const next=rowsCheck(rows,{},',','2026-12-01');assert.equal(next.requires_ack,false)
 const long=check([{name:'Stock',rows:[['sku','name','on_hand'],['A','Alpha','10']]},{name:'Sales',rows:[['sku','date','quantity'],['A','2026-11-01','3']]}]);assert.equal(long.requires_ack,true);assert.ok(long.warnings.some(w=>w.includes('still in progress')))
})
test('R2 accepted CSV row identities preserve blank-location netting without rejected rows',()=>{
 const rows=[[...header,'Warehouse'],['A','Alpha','pcs','-1','14','3','3','3','0','7','pcs','East'],['A','Alpha','pcs','100','14','3','3','3','0','','pcs','East'],['A','Alpha','pcs','10','14','3','3','3','100','5','pcs','']]
 const r=check([{name:'CSV',rows}],{stock_includes_reserved:true},'2026-11-19',[2,3]);assert.equal(+r.sheets[0].rows[2][3]+ +r.sheets[0].rows[3][3],10);assert.deepEqual(r.incoming_unknown,['A']);assert.ok(r.warnings.some(w=>w.startsWith('Incoming partly unknown')))
})
test('R2 prelaunch is per product, not per warehouse, and joined blanks stay missing',()=>{
 const r=rowsCheck([header,['A','Alpha','pcs','10','14','3','3','3','0','0','pcs'],['A','Alpha','pcs','10','14','','3','3','0','0','pcs']]);assert.equal(r.missing_rows,1);assert.equal(r.not_yet_launched_cells,0);assert.equal(r.requires_ack,true)
 const joined=check([{name:'Stock',rows:[['sku','name','on_hand'],['A','Alpha','10']]},{name:'Sales',rows:[['sku','2026-07','2026-08','2026-09'],['A','3','','3']]}]);assert.equal(joined.missing_sales_rows,1);assert.equal(joined.requires_ack,true)
})
test('R2 reserved blank and stock blank have explicit per-row explanations',()=>{
 const blank=rowsCheck([header,['A','Alpha','pcs','10','14','3','3','3','','0','pcs']],{stock_includes_reserved:true});assert.ok(blank.affected[0].warnings.some(w=>w.includes('Reserved cell is blank')))
 const missing=rowsCheck([header,['A','Alpha','pcs','','14','3','3','3','4','0','pcs']],{stock_includes_reserved:true});assert.ok(missing.affected[0].warnings.some(w=>w.includes('Stock is blank but reserved is filled')))
 const data=attached({items:[{sku:'B'}],import_report:{source_headers:['sku'],matched:[{field:'sku',source:'sku'}],rows_set_aside:[{values:['A','Stock is blank but reserved is filled — available stock cannot be calculated.'],reason:'Row 2: on_hand must be a number.'}]}},missing);assert.match(data.import_report.rows_set_aside[0].reason,/Stock is blank but reserved is filled/)
})
