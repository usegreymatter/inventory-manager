// Narrow regression: optional row values must not trigger unrelated detectors.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../standalone/design/worklist-gm-b.js',import.meta.url),'utf8')
const declaration=source.slice(source.indexOf('function wlValue('),source.indexOf('\nfunction wlCompare('))
test('all ordinary columns skip stock-out detection and unrelated incoming resolution',()=>{
 let detected=0,incoming=0
 const meta={days:20,due:'2026-02-01',supplier:'S',category:'C',monthly:3,value:6,lasts:2,pattern:'Steady',excess:4,last:'2025-12'}
 const row={item:{name:'N',on_hand:2},guidance:{quantity:2,runout_date:'2026-02-20',lead_days:14},bucket:'order'}
 const c=vm.createContext({wlMeta:()=>meta,wlRank:{order:0},wlStockoutCount:()=>{detected++;return 5},localOrderIncoming:()=>{incoming++;return 7}})
 vm.runInContext(declaration,c)
 const expected={product:'N',status:0,hand:2,days:20,qty:2,due:'2026-02-01',runout:'2026-02-20',supplier:'S',category:'C',lead:14,monthly:3,value:6,lasts:2,pattern:'Steady',excess:4,last:'2025-12'}
 for(const [key,value]of Object.entries(expected))assert.equal(c.wlValue(row,key),value,key)
 assert.equal(detected,0,'optional stock-out detector is lazy')
 assert.equal(incoming,0,'local incoming lookup is lazy')
 assert.equal(c.wlValue(row,'incoming'),7);assert.equal(incoming,1);assert.equal(detected,0)
 assert.equal(c.wlValue(row,'stockouts'),5);assert.equal(detected,1);assert.equal(incoming,1)
 assert.equal(c.wlValue(row,'unknown'),undefined)
})
