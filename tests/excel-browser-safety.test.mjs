import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const plugin=fs.readFileSync('desktop/plugin.js','utf8'),ui=fs.readFileSync('standalone/design/smart-import.js','utf8')
const c=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.parse=parseStockImport;',c)
const end=ui.indexOf('const smartImportUI')
vm.runInContext(ui.slice(0,end)+`\nthis.isExcel=typeof isExcelWorkbook==='function'?isExcelWorkbook:()=>false;this.aside=typeof excelSetAsideText==='function'?excelSetAsideText:()=>'';this.review=typeof excelWorkbookSelection==='function'?excelWorkbookSelection:(sheets,sheet,overrides)=>({sources:sheets,report:understandStockWorkbook(sheets,sheet,overrides)});`,c)
const header=['sku','name','unit','on_hand','supplier_days','on_order','2026-06','2026-07','2026-08']
const sheet=(name,stock='40',sales='10')=>({name,rows:[header,['A','Apple','units',stock,'14','0',sales,'20','30']]})
test('Excel defaults to first recognizable visible sheet; picker really selects only one',()=>{
 const sheets=[{...sheet('Old','9999'),hidden:true},sheet('Current'),sheet('Copy')]
 const r=c.review(sheets,null,{},false)
 assert.equal(r.report.sheet_used,'Current');assert.equal(r.report.canonical_rows[1][3],'40')
 assert.deepEqual(Array.from(r.sources,s=>s.name),['Current']);assert.ok(r.report.warnings.includes('Ignored hidden sheet: Old'))
 const pick=c.review(sheets,'Copy',{},false);assert.deepEqual(Array.from(pick.sources,s=>s.name),['Copy'])
 assert.equal(c.review(sheets,'Old',{},false).report.sheet_used,'Current')
})
test('Workbook safety policy follows parsed format, never its filename extension',()=>{
 assert.equal(c.isExcel([sheet('Stock')]),true)
 assert.equal(c.isExcel([{...sheet('CSV'),delimiter:','}]),false)
 assert.match(ui,/const excel=isExcelWorkbook\(sheets\)/)
})
test('Picking one Excel sheet never analyses malformed unrelated visible tabs',()=>{
 const broken={name:'Unrelated',rows:[['Product name','On hand'],['Same','1'],['Same','2']]}
 const good=sheet('Stock')
 assert.doesNotThrow(()=>c.review([broken,good],'Stock',{},false))
 assert.equal(c.review([broken,good],null,{},false).report.sheet_used,'Stock')
})
test('Excel combine is explicit; duplicate sheets flagged even with consent',()=>{
 const sheets=[sheet('Stock'),sheet('Backup')]
 assert.equal(c.review(sheets,null,{},false).report.canonical_rows[1][3],'40')
 const combined=c.review(sheets,null,{},true)
 assert.equal(combined.report.canonical_rows[1][3],'80')
 assert.ok(combined.report.review_report.reasons.some(s=>/Identical duplicate sheets: Stock and Backup/.test(s)))
})
test('Excel text thousands use the CSV numeric convention; ambiguity names SKU and reason',()=>{
 const r=c.review([sheet('Stock','1,200','3,420.28')],null,{},false).report
 const text=r.canonical_rows.map(row=>row.map(v=>'"'+v+'"').join(',')).join('\n')
 const parsed=c.parse(text);assert.equal(parsed.items[0].on_hand,1200);assert.equal(parsed.items[0].monthly_sales[0],3420.28)
 assert.equal(c.aside({row:2,reason:'ambiguous number format',values:['A']},[]),'A — Row 2: ambiguous number format')
})
test('Renamed and encrypted workbook errors give a recovery action',async()=>{
 const source=fs.readFileSync('desktop/smart-import.js','utf8'),core=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
 await assert.rejects(core.readWorkbook(new Uint8Array([80,75,3,4]),'renamed.csv'),/This looks like an Excel file — rename it to \.xlsx/)
 const cfb=Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0]),Buffer.from('EncryptionInfo\0EncryptedPackage','utf16le')])
 await assert.rejects(core.readWorkbook(cfb,'locked.xlsx'),/Password-protected workbook — remove the password in Excel and save again/)
})
test('Workbook XML budget permits 10k by 24m while byte/row protections stay bounded',()=>{
 const source=fs.readFileSync('desktop/smart-import.js','utf8')
 assert.match(source,/budget.elements>1000000/)
 assert.match(source,/MAX_INPUT=20\*1024\*1024, MAX_EXPANDED=80\*1024\*1024/)
 assert.match(source,/MAX_ROWS=200000/)
})
test('Excel browser offers non-persisted explicit combine and keeps selected contributors for meaning',()=>{
 assert.match(ui,/Add these sheets together \(one sheet per warehouse\)/)
 assert.match(ui,/reviewInputMeaning\(state\.sources,original/)
 assert.match(ui,/combine:false/)
})
