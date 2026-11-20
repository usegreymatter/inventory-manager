// Synthetic reviewer regressions; exercise Desktop and standalone adapters.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8'),ui=fs.readFileSync('standalone/design/smart-import.js','utf8')
const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa,structuredClone})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={reviewInputMeaning,understandStockWorkbook,parseStockImport,importSerialize,calculate,whyBreakdown}',ctx)
vm.runInContext(source.slice(source.indexOf('const uploadError ='),source.indexOf('function savedHorizon(')),ctx)
vm.runInContext(source.slice(source.indexOf('function smartPreflight('),source.indexOf('function rememberSmartMapping('))+'\nglobalThis.api.smartPreflight=smartPreflight',ctx)
vm.runInContext(ui.slice(ui.indexOf('  const csv='),ui.indexOf('  function rules('))+ui.slice(ui.indexOf('  function preflight('),ui.indexOf('  function draw('))+'\nglobalThis.api.standalonePreflight=preflight',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x)),today='2026-11-20',M=['2026-07','2026-08','2026-09'],H=['sku','name','unit','on_hand','supplier_days','Warehouse','on_order',...M]
const row=(stock='10',lead='14',incoming='0')=>['A','Alpha','pcs',stock,lead,'',incoming,'30','30','30']
const sheet=(name,rows)=>({name,rows})
const fixtures=[
 ['A1 ledger incoming',[sheet('Stock',[H,row('20','14','')]),sheet('Ledger',[['sku','date','quantity','on_hand','on_order'],...M.map(m=>['A',m+'-05','30','20','50'])])],{},/Incoming orders unknown/,false],
 ['A2 conflicting lead',[sheet('CSV',[H,row(),row('100','180')])],{},/conflicting supplier_days/,true],
 ['O1 total plus warehouses',['Total','East','West'].map((n,i)=>sheet(n,[H,row(['110','10','100'][i])])),{},/Stock from sheets Total, East, West was added together/,true],
 ['O1 old snapshots',['Stock Nov','Stock Oct'].map((n,i)=>sheet(n,[H,row(['100','30'][i])])),{},/Stock from sheets Stock Nov, Stock Oct was added together/,true],
 ['O2 identical blank rows',[sheet('CSV',[H,row(),row()])],{},/Identical rows found for SKU A — possible duplicate export/,true],
 ['numeric SKU warning order',[sheet('CSV',[H,...['200','30'].flatMap(sku=>[row().map((v,i)=>i===0?sku:v),row('100','180').map((v,i)=>i===0?sku:v)])])],{},/conflicting supplier_days/,true],
 ['O3 partial reserved',[sheet('East',[[...H,'reserved'],[...row(),'2']]),sheet('West',[H,row('100')])],{stock_includes_reserved:true},/Reserved stock missing in sheets West/,true],
]
function adapters(sheets,choices,legacy=false){
 const state={sheets,sheet:sheets[0].name,overrides:{},choices:{...choices,units_confirmed:true},edit:false}
 if(legacy)state.legacyParsed=api.parseStockImport(api.importSerialize(sheets[0].rows))
 const desktop=api.smartPreflight(state,6),stand={...state};api.standalonePreflight(stand)
 assert.equal(desktop.error,'');assert.equal(stand.error,null);if(!legacy)assert.deepEqual(plain(desktop.parsed),plain(stand.parsed));return legacy?stand.parsed:desktop.parsed
}
for(const [label,sheets,choices,pattern,ack]of fixtures)test('recheck '+label,()=>{
 const data=adapters(sheets,choices),meaning=data.input_meaning
 assert.equal(meaning.requires_ack,ack)
 assert.equal(meaning.warnings.some(w=>pattern.test(w)),label.startsWith('A1')?false:true)
 if(!label.startsWith('A1'))assert.ok(data.items[0].input_warnings.some(w=>pattern.test(w)))
 else {assert.equal(data.items[0].on_order,50);assert.equal(!!data.items[0].incoming_unknown,false)}
 if(sheets.length===1){const legacy=adapters(sheets,choices,true);assert.equal(legacy.input_meaning.requires_ack,ack);assert.ok(legacy.items[0].input_warnings.some(w=>pattern.test(w)))}
 const code="import importlib,json,sys,types;p=types.ModuleType('probe');p.__path__=['.'];sys.modules['probe']=p;s=importlib.import_module('probe.smart_import');m=importlib.import_module('probe.input_meaning');a=json.load(sys.stdin);r=s.understand_workbook(a['sheets'],sheet=a['sheet']);print(json.dumps(dict(report=r,review=m.review_input_meaning(a['sheets'],r,a['choices'],a['today']))))"
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',code],{input:JSON.stringify({sheets,sheet:sheets[0].name,choices,today}),encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const report=api.understandStockWorkbook(sheets,sheets[0].name);assert.deepEqual(plain({report,review:api.reviewInputMeaning(sheets,report,choices,today)}),JSON.parse(run.stdout))
})
test('all synthetic fixture items keep incoming disclosure consistent with why ledger',()=>{
 const read="import importlib,json,sys,types,pathlib;p=types.ModuleType('kit');p.__path__=['.'];sys.modules['kit']=p;s=importlib.import_module('kit.smart_import');print(json.dumps([dict(label=f.name,sheets=s.read_workbook(f)) for f in sorted(pathlib.Path('tests/fixtures/smart-import').glob('*.xlsx'))]))"
 const run=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',read],{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(run.status,0,run.stderr)
 const corpus=[...fixtures,...JSON.parse(run.stdout).map(f=>[f.label,f.sheets,{}])];let checked=0
 for(const [label,sheets,choices]of corpus){
  const report=api.understandStockWorkbook(sheets,sheets[0].name);if(report.missing.length)continue
  const data=adapters(sheets,choices);for(const item of data.items){checked++
  const calc=api.calculate([item],data.months,data.as_of,6,{},today)[0],why=api.whyBreakdown(calc,today,{})
  const hasIncoming=why.some(r=>/incoming/i.test(r.key||'')&&r.qty<0),unknown=item.input_warnings.some(w=>w.startsWith('Incoming orders unknown'))
  if(item.incoming_unknown&&!item.input_warnings.some(w=>w.startsWith('Incoming partly unknown')))assert.equal(hasIncoming,false,label)
  if(unknown)assert.equal(hasIncoming,false,label)
  if(!item.incoming_unknown&&item.on_order>0&&why.some(r=>r.key==='forecast_demand'))assert.equal(hasIncoming,true,label+JSON.stringify(why))
  if(item.incoming_unknown&&item.on_order>0)assert.ok(item.input_warnings.some(w=>w.startsWith('Incoming partly unknown')),'known partial incoming must never be described as zero')
 }}
 assert.ok(checked>fixtures.length,'exercise every usable item in the fixture kit, not only reviewer examples')
})
