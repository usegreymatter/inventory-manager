// Lifecycle: living. Synthetic fail-closed identity and cross-language probes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
const source=fs.readFileSync('desktop/plugin.js','utf8')
function api(text=source){const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa});vm.runInContext(text.slice(text.indexOf('const SAMPLE ='),text.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={parseCsv,understandStockWorkbook,generatedProductCode,normalizedProductName,demandSafetyWarnings}',ctx);return ctx.api}
const current=api(),headers=['Name','On Hand','Warehouse','2025-01','2025-02','2025-03'],row=(name,location='East')=>[name,'5',location,'1','1','1'],csv=rows=>rows.map(r=>r.join(',')).join('\n'),smart=(rows,engine=current)=>engine.understandStockWorkbook([{name:'CSV',rows}])
for(const header of ['Ref','Article No','Prodcut Code','Code produit','Odd field'])test(`unknown ${header} blocks generated identity before warehouse merge`,()=>{
 const rows=[[header,...headers],['A-1',...row('Widget')],['A-2',...row('Widget','West')]]
 assert.throws(()=>current.parseCsv(csv(rows)),new RegExp(`Is '${header}' your product code`))
 const report=smart(rows)
 assert.ok(report.missing.includes('Product code (SKU)'))
 assert.ok(report.warnings.some(w=>w.includes(`Is '${header}' your product code`)))
})
for(const [a,b]of [['Widget','Widget'],['Widget',' WIDGET '],['Café','Cafe\u0301'],['Straße','STRASSE'],['Σ','ς'],['Ꭰ','ꭰ']])test(`repeated normalized name ${a}/${b} fails globally`,()=>{
 const rows=[headers,row(a),row(b,'West')]
 for(const load of [()=>current.parseCsv(csv(rows)),()=>smart(rows)])assert.throws(load,e=>e.message.includes(`Two rows share the name "${a}"`))
 assert.equal(current.generatedProductCode(a),current.generatedProductCode(b))
})
test('multiple repeated names are listed and separate generated sheets cannot merge',()=>{
 const rows=[headers,row('Widget'),row('WIDGET','West'),row('Other'),row('OTHER','West')]
 assert.throws(()=>current.parseCsv(csv(rows)),e=>e.message.includes('"Widget"')&&e.message.includes('"Other"'))
 assert.throws(()=>current.understandStockWorkbook([{name:'East',rows:[headers,row('Widget')]},{name:'West',rows:[headers,row('Widget','West')]}]),/Two rows share the name/)
})
test('forced 64-bit collision fails in both paths',()=>{
 const forced=api(source.replace("hash.toString(16).padStart(16,'0')","'forced'"))
 const rows=[headers,row('اسم'),row('آخر')]
 assert.throws(()=>forced.parseCsv(csv(rows)),/codes collide/)
 assert.throws(()=>smart(rows,forced),/codes collide/)
 assert.notEqual(current.generatedProductCode('اسم'),current.generatedProductCode('آخر'))
})
test('safe name-only, numeric ignored columns, blank-name wording and combined warning',()=>{
 const rows=[['Unmapped quantity',...headers],['10',...row('Widget')],['20',...row('Other','West')],['30',...row('','North')]]
 assert.equal(current.parseCsv(csv(rows)).import_report.rows_set_aside[0].reason,'product name is blank')
 assert.equal(smart(rows).sheets[0].rows_set_aside[0].reason,'product name is blank')
 const warnings=current.demandSafetyWarnings({monthly_sales:[1,1,1,1,100,200],on_hand:5},['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06'],1)
 assert.deepEqual(Array.from(warnings),["Months (2025-05, 2025-06) are much higher than usual. Check it isn't a one-off before ordering."])
})
test('NFC and full Unicode casefold identities match Python, including every folding character',()=>{
 const names=['Widget',' WIDGET ','Café','Cafe\u0301','Straße','STRASSE','Σ','ς','Ꭰ','ꭰ','اسم','آخر','İ','ı','ﬃ','👩‍🔬']
 const py=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import sys,json,types
p=types.ModuleType('sr');p.__path__=['.'];sys.modules['sr']=p
from sr.csv_import import generated_product_code,normalized_product_name
names=json.load(sys.stdin)
folds=[chr(i) for i in range(0x110000) if chr(i).casefold()!=chr(i)]
print(json.dumps(dict(names=[[normalized_product_name(n),generated_product_code(n)] for n in names],folds=[[c,normalized_product_name(c)] for c in folds])))`],{input:JSON.stringify(names),encoding:'utf8'}))
 assert.deepEqual(names.map(n=>[current.normalizedProductName(n),current.generatedProductCode(n)]),py.names)
 for(const [char,fold]of py.folds)assert.equal(current.normalizedProductName(char),fold)
})
test('safe generated smart-import results match Python, including metadata and blank names',()=>{
 const rows=[['Name','On Hand','Warehouse','2025-01','2025-02','2025-03'],row('Widget'),row('آخر','West'),row('','North')]
 const expected=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import sys,json,types
p=types.ModuleType('sr');p.__path__=['.'];sys.modules['sr']=p
from sr.smart_import import understand_workbook
print(json.dumps(understand_workbook(json.load(sys.stdin))))`],{input:JSON.stringify([{name:'CSV',rows}]),encoding:'utf8'}))
 assert.deepEqual(JSON.parse(JSON.stringify(smart(rows))),expected)
})

for(const count of [1,3,4,500])test(`duplicate-name error is exactly bounded and Unicode-safe for ${count} repeated names in both import paths`,()=>{
 const names=Array.from({length:count},(_,i)=>i===0?'A'.repeat(126)+'😀'+' first product':i===1?'ب'.repeat(127)+' second product':i===2?'𐐀'.repeat(128)+' third product':`Product ${i}`)
 const rows=[headers,...names.flatMap(name=>Array.from({length:12},(_,i)=>row(name,`Warehouse ${i}`)))]
 const label=i=>i===0?'A'.repeat(126)+'😀…':i===1?'ب'.repeat(127)+'…':'𐐀'.repeat(127)+'…'
 const shown=Array.from({length:Math.min(count,3)},(_,i)=>`Two rows share the name "${label(i)}" and there is no product code column — add a code column so they aren't mixed up.`)
 if(count>3)shown.push(`…and ${count-3} more repeated names.`)
 const expected=shown.join(' ')
 for(const load of [()=>current.parseCsv(csv(rows)),()=>smart(rows)])assert.throws(load,e=>{assert.equal(e.message,expected);return true})
 const py=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import sys,json,types
p=types.ModuleType('sr');p.__path__=['.'];sys.modules['sr']=p
from sr.csv_import import preflight_csv
from sr.smart_import import understand_workbook
rows=json.load(sys.stdin);out=[]
for load in [lambda:preflight_csv('\\n'.join(','.join(row) for row in rows)),lambda:understand_workbook([dict(name='CSV',rows=rows)])]:
 try: load();out.append(None)
 except ValueError as error: out.append(str(error))
print(json.dumps(out))`],{input:JSON.stringify(rows),encoding:'utf8'}))
 assert.deepEqual(py,[expected,expected])
 assert.ok(Array.from(expected).length<800)
})
test('one short repeated name retains the original complete error wording',()=>{
 const rows=[headers,row('Widget'),row('WIDGET','West')]
 for(const load of [()=>current.parseCsv(csv(rows)),()=>smart(rows)])assert.throws(load,e=>e.message==='Two rows share the name "Widget" and there is no product code column — add a code column so they aren\'t mixed up.')
})

for(const header of ['Article No','Ref','Unmapped quantity','Mystery No'])test(`numeric ${header}: candidate decision and exact Python/JS CSV/smart parity`,()=>{
 const rows=[[header,'Name','On Hand','2025-01','2025-02','2025-03'],['1001','Widget','5','1','1','1'],['1002','Gadget','5','1','1','1']]
 const blocked=['Article No','Ref'].includes(header)
 const expected=`Could not find a product code column. Is '${header}' your product code? Rename it to 'sku' (or 'Item Code').`
 let csvResult
 if(blocked){assert.throws(()=>current.parseCsv(csv(rows)),e=>e.message===expected);csvResult={error:expected}}
 else {const result=current.parseCsv(csv(rows));assert.equal(result.items.length,2);assert.ok(result.import_report.ignored.includes(header));csvResult=JSON.parse(JSON.stringify(result))}
 const report=smart(rows)
 if(blocked){assert.ok(report.missing.includes('Product code (SKU)'));assert.ok(report.warnings.includes(expected))}
 else assert.equal(report.missing.length,0)
 const py=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import sys,json,types
p=types.ModuleType('sr');p.__path__=['.'];sys.modules['sr']=p
from sr.csv_import import preflight_csv
from sr.smart_import import understand_workbook
rows=json.load(sys.stdin)
try: result=preflight_csv('\\n'.join(','.join(row) for row in rows))
except ValueError as error: result=dict(error=str(error))
print(json.dumps(dict(csv=result,smart=understand_workbook([dict(name='CSV',rows=rows)]))))`],{input:JSON.stringify(rows),encoding:'utf8'}))
 assert.deepEqual(csvResult,py.csv)
 assert.deepEqual(JSON.parse(JSON.stringify(report)),py.smart)
})

test('numeric code-hint tokens are bounded, do not match no alone, and preserve recognized/population/uniqueness gates',()=>{
 const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
 vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.candidates=codeColumnCandidates',ctx)
 const hints=['Ref','Reference','Article No','Item No','Part No','Material No','Product Code','Prodcut Code','Code produit','Code','ID','SKU','ARTICLE-NO','ref.',' '.repeat(200)+'Ref']
 for(const header of hints){
  assert.deepEqual(Array.from(ctx.candidates([header],[['1001'],['1002']],new Set())),[header])
  assert.equal(ctx.candidates([header],[['1001'],['1002']],new Set([0])).length,0)
  assert.equal(ctx.candidates([header],[['1001'],['1001']],new Set()).length,0)
  assert.equal(ctx.candidates([header,'Name'],[['1001','Widget'],['','Gadget']],new Set([1])).length,0)
 }
 for(const header of ['No','Unmapped quantity','November','x'.repeat(129)+' ref'])assert.equal(ctx.candidates([header],[['1001'],['1002']],new Set()).length,0)
})
