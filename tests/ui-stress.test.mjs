// Lifecycle: living. Source-level regressions; browser focus/layout live in capture-stress-ui.cjs.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../standalone/design/worklist-gm-b.js',import.meta.url),'utf8')
const reader=source.slice(source.indexOf('function wlReadStorage(){'),source.indexOf('\nfunction wlStore(){'))
assert.ok(reader.startsWith('function wlReadStorage(){'),'exact production storage reader boundary')
function read(raw,{denied=false}={}){
 let writes=0
 const context=vm.createContext({wl:{key:'test-key'},localStorage:{getItem(){if(denied)throw Error('disabled');return raw},setItem(){writes++}}})
 vm.runInContext(reader,context)
 const result=JSON.parse(JSON.stringify(vm.runInContext('wlReadStorage()',context)))
 assert.equal(writes,0,'reading corrupt preferences never silently overwrites storage')
 return result
}
test('denied, empty, malformed and non-object worklist preferences recover without writes',()=>{
 for(const raw of [null,'','{bad','null','true','42','"text"','[]'])assert.deepEqual(read(raw),{},String(raw))
 assert.deepEqual(read('{}',{denied:true}),{})
})
test('wrong-shaped array preferences cannot reach spread/iteration render paths',()=>{
 const safe=read(JSON.stringify({columns:1,customColumns:'abc',detailColumns:{},customOrder:17,collapsed:false,views:[null,17,{}, {name:'bad',state:[]},{name:'null',state:null}]}))
 assert.deepEqual(safe,{simple:false,views:[]})
})
test('valid worklist preferences and saved views survive allow-listed reading',()=>{
 const input={group:'supplier',simple:true,mode:'custom',columns:['product','qty'],customColumns:['product','supplier'],customOrder:['supplier','product'],detailColumns:['product'],collapsed:['supplier:Fictional'],views:[{name:'Buying list',state:{status:'order'}}]}
 assert.deepEqual(read(JSON.stringify(input)),input)
})
test('malformed saved views are discarded without losing a legitimate view',()=>{
 const safe=read(JSON.stringify({views:[null,{name:'Purchasing',state:{status:'order'}},{name:'Broken',state:[]},{name:12,state:{}}]}))
 assert.deepEqual(safe.views,[{name:'Purchasing',state:{status:'order'}}])
})
test('unknown and prototype-like preference fields never propagate into state',()=>{
 const safe=read('{"__proto__":{"polluted":true},"constructor":{"polluted":true},"unused":"data","columns":["product"]}')
 assert.equal(Object.hasOwn(safe,'__proto__'),false)
 assert.equal(Object.hasOwn(safe,'constructor'),false)
 assert.equal(Object.hasOwn(safe,'unused'),false)
 assert.deepEqual(safe.columns,['product'])
 assert.equal({}.polluted,undefined)
})
