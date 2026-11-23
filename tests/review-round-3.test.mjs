// Round-three synthetic regression/parity contracts. No HTML builds or live data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8'),standalone=fs.readFileSync('standalone/design/smart-import.js','utf8')
const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={reviewInputMeaning,understandStockWorkbook,attachInputMeaning,parseStockImport,importSerialize,importRows,importDelimiter}',ctx)
vm.runInContext(source.slice(source.indexOf('const uploadError ='),source.indexOf('function savedHorizon(')),ctx)
vm.runInContext(source.slice(source.indexOf('function smartPreflight('),source.indexOf('function rememberSmartMapping('))+'\nglobalThis.api.smartPreflight=smartPreflight',ctx)
vm.runInContext(standalone.slice(standalone.indexOf('  const csv='),standalone.indexOf('  function rules('))+standalone.slice(standalone.indexOf('  function preflight('),standalone.indexOf('  function draw('))+'\nglobalThis.api.standalonePreflight=preflight',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x)),today='2026-11-20'
const python=String.raw`import importlib,json,sys,types
p=types.ModuleType('r3');p.__path__=['.'];sys.modules['r3']=p
s=importlib.import_module('r3.smart_import');m=importlib.import_module('r3.input_meaning');c=importlib.import_module('r3.csv_import')
a=json.load(sys.stdin)
if a.get('interpret'):
 import pathlib,tempfile
 with tempfile.TemporaryDirectory(dir='.scratch') as directory:
  path=pathlib.Path(directory)/'synthetic.csv';path.write_text(a['text']);result=m.interpret_csv(path,c.preflight_csv(a['text']),a['choices'],a['today'])
elif 'text' in a: result=c.preflight_csv(a['text'])
else:
 report=s.understand_workbook(a['sheets']);review=m.review_input_meaning(a['sheets'],report,a['choices'],a['today']);result=dict(report=report,review=review)
print(json.dumps(result))`
function reference(input){const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',python],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout)}
const months=['2026-07','2026-08','2026-09'],stock=['sku','name','on_hand',...months]
const fixtures=[
 ['joined incoming',[{name:'Stock',rows:[stock,['A','Alpha','100','30','30','30']]},{name:'Incoming',rows:[['sku','on_order'],['A','50']]}],{}],
 ['joined reserved and distinct units',[{name:'Stock',rows:[['sku','name','on_hand','Stock unit',...months],['A','Alpha','100','pcs','30','30','30']]},{name:'Allocations',rows:[['sku','reserved'],['A','60']]},{name:'Sales units',rows:[['sku','Sales unit'],['A','boxes']]}],{stock_includes_reserved:true}],
 ['warehouse sheets metadata conflict',[{name:'East',rows:[['sku','name','unit','on_hand','reserved','on_order','supplier_days',...months],['A','Alpha','pcs','10','100','5','14','30','30','30']]},{name:'West',rows:[['sku','name','unit','on_hand','reserved','on_order','supplier_days',...months],['A','Alpha','pcs','100','0','7','21','30','30','30']]}],{stock_includes_reserved:true}],
 ['partial joined incoming',[{name:'East',rows:[stock,['A','Alpha','10','1','1','1']]},{name:'West',rows:[[...stock,'on_order'],['A','Alpha','20','1','1','1','50']]}],{}],
 ['repeated blank locations',[{name:'Stock',rows:[['sku','name','on_hand','Warehouse',...months],['A','Alpha','10','','1','1','1'],['A','Alpha','20','','1','1','1'],['A','Alpha','30','West','1','1','1']]}],{}],
 ['missing location column',[{name:'Stock',rows:[stock,['A','Alpha','10','1','1','1'],['A','Alpha','20','1','1','1']]}],{}],
 ['invalid reserved aggregation',[{name:'Stock',rows:[['sku','name','on_hand','reserved','Warehouse',...months],['A','Alpha','10','-1','East','1','1','1'],['A','Alpha','20','2','West','1','1','1']]}],{stock_includes_reserved:true}],
 ['ledger reserved snapshot',[{name:'Ledger',rows:[['sku','name','date','quantity','on_hand','reserved'],['A','Alpha','2026-07-01','30','100','20'],['A','Alpha','2026-08-01','30','100','20'],['A','Alpha','2026-09-01','30','100','20']]}],{stock_includes_reserved:true}],
 ['same sheet metadata conflict',[{name:'Stock',rows:[['sku','name','on_hand','supplier_days','Warehouse',...months],['A','Alpha','10','14','East','1','1','1'],['A','Alpha','20','21','West','1','1','1']]}],{}],
 ['warehouse oversold provenance',[{name:'Stock',rows:[['sku','name','on_hand','reserved','Warehouse',...months],['A','Alpha','10','100','East','1','1','1'],['A','Alpha','100','0','West','1','1','1']]}],{stock_includes_reserved:true}],
]
for(const [label,sheets,choices] of fixtures)test('R3 exact workbook + review parity: '+label,()=>{
 const expected=reference({sheets,choices,today}),report=plain(api.understandStockWorkbook(sheets)),review=plain(api.reviewInputMeaning(sheets,report,choices,today))
 assert.deepEqual(report,expected.report,'full canonical report parity');assert.deepEqual(review,expected.review,'joined meaning parity')
})
test('warning priority contract is embedded from the shared JSON in both runtimes',()=>{
 const expected=JSON.parse(fs.readFileSync('input-meaning-warning-order.json','utf8'))
 assert.deepEqual(plain(vm.runInContext('INPUT_WARNING_PREFIXES',ctx)),expected)
 const code="import importlib,types,sys,json;p=types.ModuleType('priority');p.__path__=['.'];sys.modules['priority']=p;print(json.dumps(importlib.import_module('priority.input_meaning').INPUT_WARNING_PREFIXES))"
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),expected)
})
test('R3 warning tie-break order is identical for supplementary and fullwidth Unicode names',()=>{
 const messages=['Conflict: Ａ','Conflict: 😀','New product: Ａ months before first sale ignored','New product: 😀 months before first sale ignored','Conflict: 😀']
 const expected=plain(vm.runInContext('orderedInputWarnings',ctx)(messages))
 const code="import importlib,types,sys,json;p=types.ModuleType('priority');p.__path__=['.'];sys.modules['priority']=p;print(json.dumps(importlib.import_module('priority.input_meaning').ordered_input_warnings(json.load(sys.stdin))))"
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{input:JSON.stringify(messages),encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 assert.deepEqual(JSON.parse(run.stdout),expected);assert.equal(expected.length,4)
})
const csvHeader=['sku','name','unit','on_hand','supplier_days','Warehouse','reserved','on_order',...months]
test('R3 CLI CSV and joined Desktop warning arrays use one canonical priority order',()=>{
 const rows=[csvHeader.concat('Sales unit'),['A','Alpha','pcs','10','14','East','100','50','30','30','30','boxes'],['A','Alpha','pcs','100','14','West','0','','30','30','30','pcs']],text=api.importSerialize(rows),choices={stock_includes_reserved:true}
 const sheets=[{name:'CSV',rows,delimiter:','}],report=api.understandStockWorkbook(sheets),review=api.reviewInputMeaning(sheets,report,choices,today),desktop=api.attachInputMeaning(api.parseStockImport(api.importSerialize(api.understandStockWorkbook(review.sheets).canonical_rows)),review)
 const cli=reference({interpret:true,text,choices,today})
 assert.deepEqual(plain(desktop.items[0].input_warnings),cli.items[0].input_warnings)
 assert.match(cli.items[0].input_warnings[0],/^Oversold:/);assert.match(cli.items[0].input_warnings[1],/^Incoming partly/);assert.match(cli.items[0].input_warnings[2],/^Sales and stock units/)
})
test('R3 canonical rebuild cannot erase missing source mappings or unmatched history',()=>{
 for(const sheets of [[{name:'Stock',rows:[['sku','on_hand',...months],['A','10','1','1','1']]}],[{name:'Stock',rows:[['sku','name','on_hand'],['A','Alpha','10'],['B','Beta','10']]},{name:'Sales',rows:[['sku',...months],['A','1','1','1']]}]]){
  const original=api.understandStockWorkbook(sheets),state={sheets,sheet:'Stock',overrides:{},choices:{},edit:false},desktop=api.smartPreflight(state,6),stand={...state};api.standalonePreflight(stand)
  assert.ok(original.missing.length);assert.deepEqual(plain(desktop.report.missing),plain(original.missing));assert.deepEqual(plain(stand.report.missing),plain(original.missing));assert.equal(desktop.parsed,null);assert.equal(stand.parsed,null)
 }
})
const csvRows=[csvHeader,['','','','','','','','','','',''],['A','Alpha\nlabel','pcs','10','14','','100','50','30','30','30'],['A','Alpha','pcs','100','14','West','0','','30','30','30'],['A','Alpha','pcs','20','14','','0','0','30','30','30'],['A','Alpha','pcs','10','14','Bad','100','-1','30','30','30']]
test('R3 CSV accepted logical record identities + repeated blank locations',()=>{
 const text=api.importSerialize(csvRows),parsed=plain(api.parseStockImport(text)),expected=reference({text})
 assert.deepEqual(parsed.import_report.accepted_rows,[2,3,4]);assert.deepEqual(parsed,expected)
})
for(const [label,sheets,choices] of fixtures.filter(([label])=>!label.includes('invalid')))test('R3 Desktop/standalone adjusted canonical integration: '+label,()=>{
 const state={sheets,sheet:sheets[0].name,overrides:{},choices:{...choices,units_confirmed:true},edit:false}
 const desktop=plain(api.smartPreflight(state,6)),stand={...state};api.standalonePreflight(stand)
 assert.equal(desktop.error,'');assert.equal(stand.error,null);assert.ok(desktop.parsed?.items.length)
 assert.deepEqual(plain(stand.parsed),desktop.parsed,'identical facts and warnings');assert.equal(desktop.report.sheet_used,sheets[0].name,'retain source mappings for review')
 const expected=reference({sheets,choices,today}),adjusted=api.understandStockWorkbook(expected.review.sheets),parsed=api.attachInputMeaning(api.parseStockImport(api.importSerialize(adjusted.canonical_rows)),expected.review)
 assert.deepEqual(desktop.parsed.items,plain(parsed.items),'parse adjusted canonical joined facts')
})
test('R3 standalone legacy CSV keeps real accepted contributors when netting reservations',()=>{
 const text=api.importSerialize(csvRows),legacyParsed=api.parseStockImport(text),sheets=[{name:'CSV',rows:api.importRows(text,','),delimiter:','}],state={sheets,sheet:'CSV',overrides:{},choices:{stock_includes_reserved:true,units_confirmed:true},legacyParsed,edit:false}
 api.standalonePreflight(state);assert.equal(state.error,null);assert.equal(state.parsed.items[0].on_hand,30);assert.equal(state.parsed.items[0].on_order,50);assert.equal(state.parsed.items[0].incoming_unknown,true)
 assert.deepEqual(plain(state.parsed.import_report.accepted_rows),[2,3,4]);assert.ok(state.parsed.input_meaning.warnings.some(w=>w.startsWith('Incoming partly unknown')))
 assert.deepEqual(plain(state.parsed),reference({interpret:true,text,choices:state.choices,today}),'complete CSV adapter parity')
})
test('R3 legacy semicolon CSV retains decimal convention after integer reserved subtraction',()=>{
 const rows=[csvHeader,['A','Alpha','pcs','10,5','14','East','0,5','0','1.000','1.000','1.000']],text=rows.map(row=>row.map(v=>'"'+v+'"').join(';')).join('\n'),choices={stock_includes_reserved:true,units_confirmed:true}
 const state={sheets:[{name:'CSV',rows,delimiter:';'}],sheet:'CSV',overrides:{},choices,legacyParsed:api.parseStockImport(text),edit:false};api.standalonePreflight(state)
 assert.equal(state.error,null);assert.equal(state.parsed.items[0].on_hand,10);assert.equal(state.parsed.items[0].monthly_sales[0],1000);assert.deepEqual(plain(state.parsed),reference({interpret:true,text,choices,today}))
})
