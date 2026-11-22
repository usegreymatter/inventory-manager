import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const worklist=fs.readFileSync('standalone/design/worklist-gm-b.js','utf8')
const importer=fs.readFileSync('standalone/design/import-gm-b.js','utf8')
const context=vm.createContext({})
vm.runInContext(worklist.slice(worklist.indexOf('function wlCsv('),worklist.indexOf('function wlExport(')),context)
vm.runInContext(importer.slice(importer.indexOf('function importSetAsideCsv('),importer.indexOf('importDownload.addEventListener')),context)
const quote=text=>'"'+text.replaceAll('"','""')+'"'

for(const prefix of ['', ' ', '\n', '\r', '\t', '\ufeff', ' \n\ufeff\t'])for(const operator of ['=', '+', '-', '@']){
 test(`IMPORT-05 set-aside export neutralizes ${JSON.stringify(prefix+operator)}`,()=>{
  const text=prefix+operator+'SUM(1,1)',expected=quote("'"+text)
  const report={source_headers:[text],rows_set_aside:[{row:3,reason:text,values:[text]}]}
  const aside=context.importSetAsideCsv(report)
  assert.ok(aside.includes(expected),JSON.stringify(aside))
  // Header, reason and original source cell all pass through the same hardening.
  assert.equal(aside.split(expected).length-1,3)
  assert.ok(context.wlCsv([{item:{sku:text,name:text,unit:text},guidance:{quantity:1},bucket:'order'}]).includes(expected))
 })
}
test('IMPORT-05 harmless quoted multiline source cells remain lossless',()=>{
 const text='Widget\rSpecial\n"Large"'
 const aside=context.importSetAsideCsv({source_headers:['Name'],rows_set_aside:[{row:3,reason:'invalid quantity',values:[text]}]})
 assert.ok(aside.includes(quote(text)))
 assert.ok(!aside.includes(quote("'"+text)))
})
test('IMPORT-05 order quantities retain numeric types and CSV output',()=>{
 const csv=context.wlCsv([{item:{sku:'A',name:'Widget',unit:'units',on_hand:100},guidance:{quantity:12},bucket:'order'}])
 assert.ok(csv.includes('"A","Widget","units","order","12"'))
 assert.ok(!csv.includes('"\'12"'))
})
