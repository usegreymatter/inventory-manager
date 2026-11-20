import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const read=name=>fs.readFileSync(new URL('../standalone/design/'+name,import.meta.url),'utf8')
test('receipt provenance distinguishes a real dated PO from local lead-time intent',()=>{
 const text=read('product-page-gm-b.js'),start=text.indexOf('function productArrivalLabel(')
 assert(start>=0,'receipt provenance helper required')
 const fn=text.slice(start,text.indexOf('\nfunction ',start+1)),ctx=vm.createContext({localOrderFor:()=>({expected_on:'2027-01-01'}),data:{items:[]}})
 vm.runInContext(fn,ctx)
 for(const [date,expected] of [['2027-01-01','Expected (lead-time estimate)'],['2026-12-24','Confirmed arrival']]){
  ctx.row={item:{sku:'A'},guidance:{delivery_date:date}}
  assert.equal(vm.runInContext('productArrivalLabel(row)',ctx),expected)
 }
 ctx.row.guidance.delivery_date='2027-01-01';ctx.data.items=[{sku:'A',planning_facts:{incoming_pos:[{status:'confirmed',due_date:'2027-01-01'}]}}]
 assert.equal(vm.runInContext('productArrivalLabel(row)',ctx),'Confirmed arrival')
 ctx.localOrderFor=()=>null;ctx.row.guidance.delivery_date='2027-01-01'
 assert.equal(vm.runInContext('productArrivalLabel(row)',ctx),'Confirmed arrival')
})
test('positive additional order retains its own deadline while showing the local estimate',()=>{
 const text=read('product-page-gm-b.js')
 assert.match(text,/localOrderFor\(i\.sku\)&&!\(g\.quantity>0\)\?'Expected arrival':'Order by'/)
})
