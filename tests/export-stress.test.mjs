// Defensive export regression: imported strings remain literal spreadsheet data.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../standalone/design/worklist-gm-b.js',import.meta.url),'utf8')
const declaration=source.slice(source.indexOf('function wlCsv('),source.indexOf('function wlExport('))
const c=vm.createContext({wlMeta:()=>({supplier:'',due:''}),wlRank:{order:0}})
const plugin=fs.readFileSync('desktop/plugin.js','utf8'),template=fs.readFileSync('standalone/template.html','utf8')
vm.runInContext(plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')+'\nconst settings={};\n'+template.slice(template.indexOf('function incomingOrderCaveat('),template.indexOf('function purchaseOrderText(')),c)
vm.runInContext(declaration,c)
const line=text=>({item:{sku:text,name:text,unit:text,supplier:text,category:text,on_order:0},guidance:{quantity:1,reason:text},bucket:'order'})
test('CSV neutralizes direct and whitespace-prefixed spreadsheet expressions in every imported text field',()=>{
 for(const prefix of ['', ' ', '\n', '\t', '\r', '\ufeff', '\u00a0', '\r\n '])for(const operator of ['=','+','-','@']){
  const text=prefix+operator+'1+1',csv=c.wlCsv([line(text)])
  const escaped='"\''+text+'"'
  assert.equal(csv.split(escaped).length-1,6,JSON.stringify(text))
 }
})
test('CSV preserves ordinary text and numeric quantities without adding an apostrophe',()=>{
 const csv=c.wlCsv([line('Widget')])
 assert.ok(csv.includes('"Widget"'));assert.ok(csv.includes('"1"'));assert.ok(!csv.includes("'Widget"))
})
