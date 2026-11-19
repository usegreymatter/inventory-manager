import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../standalone/design/supplier-minimums-gm-b.js',import.meta.url),'utf8').split('const supplierMinimums=')[0]
const context=vm.createContext({});vm.runInContext(source,context)
const plan=input=>JSON.parse(JSON.stringify(context.supplierMinimumPlan(input)))
const candidate=(sku,qty,cost,extra={})=>({sku,qty,cost,cover:2,bucket:'healthy',runout:'2026-12-01',pack:1,moq:1,...extra})
test('500 minimum less 380 = 120; next 40 units at 3 closes gap, input unchanged',()=>{const input={minimumValue:500,value:380,candidates:[candidate('NEXT',40,3)]};const before=JSON.stringify(input),p=plan(input);assert.equal(p.gapValue,120);assert.equal(p.addedValue,120);assert.equal(p.lines[0].qty,40);assert.equal(p.complete,true);assert.equal(JSON.stringify(input),before)})
test('pull whole next orders in runout order, stop when both limits reached',()=>{const p=plan({minimumValue:100,minimumQty:20,candidates:[candidate('LATER',50,10,{runout:'2027-01-01'}),candidate('FIRST',10,5),candidate('SECOND',10,5,{runout:'2026-12-02'})]});assert.deepEqual(p.lines.map(c=>c.sku),['FIRST','SECOND']);assert.equal(p.addedQty,20)})
test('whole packs round upward and respect MOQ, including decimal packs',()=>{assert.equal(plan({minimumValue:10,candidates:[candidate('MOQ',7,1,{pack:6,moq:20})]}).lines[0].qty,24);assert.equal(plan({minimumQty:1,candidates:[candidate('DEC',.8,1,{pack:.25,moq:.9})]}).lines[0].qty,1)})
test('quantity-only limit can use a genuine zero-cost next order',()=>{const p=plan({minimumQty:10,candidates:[candidate('FREE',10,0)]});assert.equal(p.complete,true);assert.equal(p.lines[0].qty,10)})
test('exact minimum needs no additions',()=>{const p=plan({minimumValue:500,minimumQty:20,value:500,qty:20,candidates:[candidate('N',40,3)]});assert.equal(p.lines.length,0);assert.equal(p.complete,true)})
test('no-cost, no sales, needs data, and >12mo stock excluded; impossible explicit',()=>{const p=plan({minimumValue:500,candidates:[candidate('NONE',10,null),candidate('ZERO',10,0),candidate('NO',10,3,{bucket:'no-sales'}),candidate('DATA',10,3,{bucket:'needs-data'}),candidate('EXCESS',10,3,{cover:12.1}),candidate('OK',5,3)]});assert.deepEqual(p.lines.map(c=>c.sku),['OK']);assert.equal(p.addedValue,15);assert.equal(p.complete,false)})
