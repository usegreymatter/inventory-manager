import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../standalone/design/decision-simple-gm-b.js',import.meta.url),'utf8')
test('detail toggle follows active view, device preference only supplies fresh-dataset default',()=>{
 const store=new Map(),ctx=vm.createContext({wl:{mode:'simple'},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}})
 vm.runInContext(source.slice(source.indexOf('function decisionDetail'),source.indexOf('function riskLevel'))+';this.api={decisionDetail,decisionInitialMode,decisionExpandedMode,setDecisionDetail}',ctx)
 assert.equal(ctx.api.decisionInitialMode(),'simple');assert.equal(ctx.api.decisionDetail(),false)
 ctx.api.setDecisionDetail(true,'custom');assert.equal(ctx.api.decisionInitialMode(),'detailed');assert.equal(ctx.api.decisionExpandedMode(),'custom')
 // Import/hash/saved views may override the starting device preference.
 assert.equal(ctx.api.decisionDetail(),false);ctx.wl.mode='custom';assert.equal(ctx.api.decisionDetail(),true);ctx.wl.mode='detailed';assert.equal(ctx.api.decisionDetail(),true)
 ctx.api.setDecisionDetail(false);assert.equal(ctx.api.decisionInitialMode(),'simple');assert.equal(ctx.api.decisionExpandedMode(),'custom')
})
test('compact explanation retains engine context and every assumption; full ledger remains separate',()=>{
 const full='Suggested order: 195 units = 197.78571428571428 [forecast demand] -90 [stock on hand] +83 [safety stock] +4.214285714285714 [pack rounding]. Sells ~53.25/mo · 35-day delivery · 2 months cover · pack 5 · MOQ 20. Unknown incoming is assumed zero; check existing orders before buying.',ctx=vm.createContext({decisionWhy:()=>full,orderAmount:String})
 vm.runInContext(source.slice(source.indexOf('function decisionWhyLine'),source.indexOf('const decisionDrawBase'))+';this.line=decisionWhyLine',ctx)
 assert.equal(ctx.line({guidance:{quantity:195},item:{unit:'bag'}}),'Sells ~53.25/mo · 35-day delivery · 2 months cover · pack 5 · MOQ 20 → order 195 bag. Unknown incoming is assumed zero; check existing orders before buying.')
 ctx.decisionWhy=()=> 'Purchase advice held: Check missing or invalid stock, sales, dates or settings.'
 assert.equal(ctx.line({}),ctx.decisionWhy())
})
