import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
const source=fs.readFileSync('standalone/design/decision-simple-gm-b.js','utf8')
function api(local=null){
 const ctx=vm.createContext({localOrderFor:()=>local,localOrderDisplay:()=> 'Marked as ordered on this device',whyThisAmount:()=> 'Suggested order: 8 kg = 8 [forecast demand]. Sells ~3/mo · 14-day delivery · 2 months cover.',settings:{},currentToday:'2026-11-01',data:{as_of:'2026-10-31'},orderAmount:String,monthAfter:()=> '2027-04',monthEndOrdinal:()=> Date.parse('2027-04-30'),dateOrdinal:Date.parse})
 const functions=source.slice(source.indexOf('function decisionWhy('),source.indexOf('wlRow=function'))
 vm.runInContext('const decisionWhyCache=new WeakMap();'+functions+'\nthis.api={decisionWhy}',ctx)
 return ctx.api
}
test('F: remaining recommendation is still explained after marking local order',()=>{
 const text=api({qty:10}).decisionWhy({item:{sku:'A',unit:'kg'},guidance:{quantity:8,order_by:'now'}})
 assert.match(text,/Suggested order: 8 kg/);assert.match(text,/Marked as ordered on this device/)
})
test('G: distant replenishment is not displayed as an actionable order quantity',()=>{
 const text=api().decisionWhy({item:{sku:'A',unit:'kg'},guidance:{quantity:6,order_by:'2054-01-01'}})
 assert.match(text,/beyond|6-month view/);assert.doesNotMatch(text,/Suggested order: 8/)
})
test('D: review visibly reports rows kept and flagged',()=>{
 assert.match(fs.readFileSync('standalone/design/smart-import.js','utf8'),/rows kept.*rows flagged/)
})
