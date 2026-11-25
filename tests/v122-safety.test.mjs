import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createHash} from 'node:crypto'
import beforeV122 from './reviewed-v122-delta.cjs'
import beforeV130 from './reviewed-v130-delta.cjs'
const read=f=>fs.readFileSync(f,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex')
const source=read('desktop/plugin.js'),ctx=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={calculate,orderGuidance,demandSafetyWarnings,parseCsv,understandStockWorkbook}',ctx)
const {api}=ctx,months=Array.from({length:12},(_,i)=>`2025-${String(i+1).padStart(2,'0')}`)
const item=(sales,stock=0)=>({sku:'S',name:'Synthetic',unit:'units',on_hand:stock,supplier_days:14,monthly_sales:sales,receipts:{}})
test('v1.2.2 fractional constants never fabricate a backup unit',()=>{
 for(const value of [.1,.2,.3,.7,1.1,1.15,.35,2.3,4.6,9.95,12.7,33.3,.001,7,100]){
  const [result]=api.calculate([item(Array(12).fill(value))],months,'2025-12-31',6,{},'2026-01-01')
  assert.equal(result.held,false);assert.equal(result.safety_stock,0)
  if(value===.1)assert.equal(api.orderGuidance(result,'2026-01-01',{},'2025-12-31').quantity,1)
 }
})
test('v1.2.2 raw-history warnings use strict 4x nonzero median and trailing-zero rules',()=>{
 assert.equal(api.demandSafetyWarnings(item([100,100,100,400]),months,1).length,0)
 assert.match(api.demandSafetyWarnings(item([100,100,1000,100]),months,1)[0],/2025-03/)
 assert.equal(api.demandSafetyWarnings(item([1,1,100]),months,1).length,0)
 const warnings=api.demandSafetyWarnings(item([...Array(6).fill(100),...Array(6).fill(0)]),months,246)
 assert.match(warnings.join(' '),/No sales for 6 months/);assert.match(warnings.join(' '),/Out of stock with no recent sales/)
 assert.equal(api.demandSafetyWarnings(item([0,0,0],3),months,0).length,0)
})
test('v1.2.2 safe no-code CSV and smart workbook generate unique stable codes visibly',()=>{
 const rows=[['name','on_hand','2025-01','2025-02','2025-03'],['Widget','0','1','1','1'],['اسم','0','1','1','1'],['Total','0','3','3','3']]
 const parsed=api.parseCsv(rows.map(r=>r.join(',')).join('\n'))
 assert.deepEqual(Array.from(parsed.items,i=>i.sku),['widget-c07f0119e3154625','product-1c13a1c124309b97'])
 assert.ok(parsed.import_report.warnings.includes('No product code column found — codes were made from product names.'))
 const report=api.understandStockWorkbook([{name:'CSV',rows}])
 assert.equal(report.missing.length,0);assert.equal(report.canonical_rows.length,3)
 assert.ok(report.warnings.includes('No product code column found — codes were made from product names.'))
})
const delta=JSON.parse(read('tests/fixtures/v122-approved-delta.json'))
for(const [kind,file]of [['plugin','desktop/plugin.js'],['engine','engine.py'],['csv','csv_import.py'],['smartImport','standalone/design/smart-import.js'],['cli','stock_runway.py']])test(`v1.2.2 ${kind} exact delta reconstructs baseline and rejects mutations`,()=>{
 const text=read(file);assert.equal(sha(beforeV122(text,kind)),delta.baseline_sha256[kind])
 const previous=beforeV130(text,kind)
 for(const {after}of delta[kind])assert.throws(()=>beforeV122.previous(previous.replace(after,'UNKNOWN'+after.slice(1)),kind))
 assert.notEqual(sha(beforeV122(text+'\nUNKNOWN',kind)),delta.baseline_sha256[kind])
})

test('reviewed warning guard requires additions and uses real guidance quantity',async()=>{
 const {assertSafetyWarningAdditions,expectedSafetyWarnings,reviewedSafetyProjection}=await import('./policy-v2-support.mjs')
 const raw={...item([100,100,100,100,1000,2000],10),on_order:0}
 const ms=months.slice(0,6),asOf='2025-06-30',today='2025-07-01'
 const row=api.calculate([raw],ms,asOf,6,{},today)[0],quantity=api.orderGuidance(row,today,{},asOf).quantity
 assert.ok(expectedSafetyWarnings(row,quantity).size>0)
 assertSafetyWarningAdditions(row,quantity)
 assert.throws(()=>assertSafetyWarningAdditions({...row,input_warnings:[]},quantity),/expected warning addition/)
 const dead={...item([0,0,0],100),on_order:0},[stopped]=api.calculate([dead],months.slice(0,3),'2025-03-31',6,{},'2025-04-01')
 const zero=api.orderGuidance(stopped,'2025-04-01',{},'2025-03-31').quantity
 assert.equal(zero,0);assert.equal(expectedSafetyWarnings(stopped,zero).size,0)
 const unknown='Unknown warning stays protected'
 assert.ok(reviewedSafetyProjection({...row,input_warnings:[...row.input_warnings,unknown]},quantity).input_warnings.includes(unknown))
})
