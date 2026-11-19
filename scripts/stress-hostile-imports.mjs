// Lifecycle: living. Offline counterpart to stress_hostile_imports.py; no installs/network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const source=fs.readFileSync('desktop/plugin.js','utf8')
const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,atob,btoa,Blob,DecompressionStream})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.hostile={parseCsv,decodeCsvBytes,ERP_ALIASES,PRODUCT_TYPE_ALIASES}',context,{timeout:5000})
const moduleSource=fs.readFileSync('desktop/smart-import.js','utf8')
const core=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'))
const vocabulary=JSON.parse(fs.readFileSync('smart-import-vocabulary.json','utf8'))
const aliases=Object.fromEntries(Object.entries(context.hostile.ERP_ALIASES).map(([field,names])=>[field,[...names,...(vocabulary[field]||[])]]))
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const results=[]
for(const request of JSON.parse(fs.readFileSync(process.argv[2],'utf8'))){
  const bytes=fs.readFileSync(request.path),start=performance.now(),result={}
  try{
    const sheets=await core.readWorkbook(bytes,request.path.split('/').at(-1))
    result.reader='accept';result.sheets_hash=digest(sheets)
    try{
      const report=core.understandWorkbook(sheets,null,null,aliases,context.hostile.PRODUCT_TYPE_ALIASES)
      result.understand='accept';result.canonical_hash=digest(report.canonical_rows)
    }catch(error){result.understand='reject';result.understand_error=error.message}
  }catch(error){result.reader=error instanceof RangeError||error instanceof TypeError?'crash':'reject';result.reader_error=error.message}
  if(request.path.endsWith('.csv')&&bytes.length<=2*1024*1024){
    try{const data=context.hostile.parseCsv(context.hostile.decodeCsvBytes(bytes));result.preflight='accept';result.items_hash=digest(data.items)}
    catch(error){result.preflight=error.name==='RangeError'||error.name==='TypeError'?'crash':'reject';result.preflight_error=error.message}
  }
  result.ms=Number((performance.now()-start).toFixed(3));results.push(result)
}
// Exercise real XLSX/CSV export functions, not reimplementations. Never evaluate formulas.
const exportContext=vm.createContext({TextEncoder,Uint8Array,DataView,Date})
vm.runInContext(fs.readFileSync('standalone/design/xlsx-gm-b.js','utf8'),exportContext)
const payloads=['=1+1','+SUM(1,2)','-2+3','@SUM(1)','\t=1+1','\r=1+1','\n=1+1',' =1+1','\ufeff=1+1','<img src=x onerror=alert(1)>','_x003D_1+1']
const sheet=exportContext.wlXlsxSheet([payloads])
assert.ok(!sheet.includes('<f>'),'XLSX strings must never become formula elements')
assert.equal((sheet.match(/t="inlineStr"/g)||[]).length,payloads.length)
assert.ok(sheet.includes('&lt;img'),'HTML is XML-escaped in XLSX')
assert.ok(sheet.includes('_x005F_x003D_'),'OOXML escape-like strings stay literal')
const worklist=fs.readFileSync('standalone/design/worklist-gm-b.js','utf8')
const csvFunction=worklist.slice(worklist.indexOf('function wlCsv('),worklist.indexOf('function wlExport('))
const csvContext=vm.createContext({wlMeta:()=>({supplier:'',due:''}),wlRank:{order:0}})
vm.runInContext(csvFunction,csvContext)
const csvExport=csvContext.wlCsv(payloads.map(text=>({item:{sku:text,name:text,unit:text,supplier:text,category:text},guidance:{quantity:1,reason:text},bucket:'order'})))
const unsanitized=payloads.filter(text=>/^[\s\ufeff]*[=+@\-]/u.test(text)&&!csvExport.includes('"\''+text.replaceAll('"','""')+'"'))
console.log(JSON.stringify({results,max_rss_bytes:process.resourceUsage().maxRSS*1024,export_checks:{xlsx_literal_strings:payloads.length,xlsx_no_formulas:true,xlsx_xml_escaped:true,csv_unprefixed_payloads:unsanitized,copy_note:'Plain-text clipboard; not a spreadsheet-safe TSV/CSV export.'}}))
