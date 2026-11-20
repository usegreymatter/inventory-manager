// Lifecycle: living. Display-only Safari regressions; runtime hit-tests in capture-safari-qa.cjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=name=>fs.readFileSync(new URL('../standalone/design/'+name,import.meta.url),'utf8')
function declaration(text,name,next){return text.slice(text.indexOf('function '+name+'('),text.indexOf(next,text.indexOf('function '+name+'(')))}
test('product navigation keeps stable IDs and fresh rows after status changes',()=>{
 const text=source('product-page-gm-b.js'),rows=new Map([['A',{item:{sku:'A'},version:2}],['B',{item:{sku:'B'}}]])
 const ctx=vm.createContext({productPage:{queue:['A','B','removed']},rowMap:rows})
 vm.runInContext(declaration(text,'productNavigationRows','function productHash'),ctx)
 const result=vm.runInContext('productNavigationRows()',ctx)
 assert.equal(result.length,2);assert.equal(result[0],rows.get('A'));assert.equal(result[0].version,2)
 assert.match(text,/navigation\.findIndex\(r=>r\.item\.sku===i\.sku\)/)
 assert.match(text,/const rows=productNavigationRows\(\),row=rows\[/)
})
test('local purchase intent is explicitly a device-local lead-time estimate',()=>{
 const text=source('local-orders-gm-b.js'),ctx=vm.createContext({shortDate:x=>x})
 vm.runInContext(declaration(text,'localOrderDisplay','function localOrderPill'),ctx)
 assert.equal(vm.runInContext("localOrderDisplay({expected_on:'2026-12-24'})",ctx),'Ordered on this device · expected ~2026-12-24 (lead-time estimate)')
 const chart=source('chart-focus-gm-b.js'),base={item:{sku:'A',unit:'box'},guidance:{quantity:0,delivery_date:'2026-12-24'}}
 Object.assign(ctx,{localOrderFor:()=>({expected_on:'2026-12-24'}),gmDate:x=>x,dateOrdinal:()=>null,row:base})
 vm.runInContext(declaration(chart,'chartKeyline','const largePanelBase'),ctx)
 const local=vm.runInContext('chartKeyline(row)',ctx);assert.match(local,/Ordered on this device/);assert.doesNotMatch(local,/Confirmed|No order needed/)
 ctx.localOrderFor=()=>null
 assert.match(vm.runInContext('chartKeyline(row)',ctx),/Confirmed arrival 2026-12-24/)
})
test('sticky group top includes the fixed column header offset and mobile Settings target is >=40px',()=>{
 assert.match(source('worklist-gm-b.js'),/const y=Math\.max\(0,wlScroll\.scrollTop\)/)
 assert.match(source('worklist-gm-b.js'),/e\.style\.top=Math\.min\(y,/)
 const rule=source('worklist-gm-b.css').match(/\.work-lead-note button \{([^}]+)\}/)[1]
 assert(Number(rule.match(/min-height:(\d+)px/)[1])>=40)
})
