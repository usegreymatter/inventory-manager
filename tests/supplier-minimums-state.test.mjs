import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../standalone/design/supplier-minimums-gm-b.js',import.meta.url),'utf8')
function setup(){const ctx=vm.createContext({});vm.runInContext(`
const data={items:[],suppliers:[{name:'Supplier',min_order_value:500}]},settings={},localOrders={records:[]};
const gmSettingsKey=()=> 'fixture',gmMeta=s=>s||'',localStorage={getItem:()=>null};let gmOpenSettings=()=>{};
const attentionRows=rows=>rows.filter(r=>r.bucket==='order'||r.bucket==='running-low');
const resolveOrderSettings=item=>({values:item});
const row=(sku,quantity,cost,bucket)=>({bucket,item:{sku,supplier:'Supplier',unit_cost:cost,pack_size:1,minimum_order:1},guidance:{quantity,overstock_months:2,runout_date:'2026-12-01'}});
let currentRows=[row('NOW',38,10,'order'),row('NEXT',40,3,'healthy')];
`,ctx);vm.runInContext(source,ctx);return ctx}
test('supplier context and acceptance remain independent of visible filters',()=>{const c=setup();vm.runInContext(`const p=supplierMinimumContext('Supplier',[currentRows[0]]);supplierMinimums.accepted.set('Supplier',p.lines)`,c);assert.equal(vm.runInContext("supplierMinimumContext('Supplier',[]).gapValue",c),120);assert.equal(vm.runInContext("supplierMinimumRows('Supplier',[currentRows[0]])[1].minimumAdded",c),true);assert.equal(vm.runInContext("supplierMinimumContext('Supplier',currentRows).lines[0].sku",c),'NEXT');assert.equal(vm.runInContext('currentRows[1].guidance.quantity',c),40)})
test('export path itself clears stale acceptance even without a supplier header',()=>{const c=setup();vm.runInContext("supplierMinimums.accepted.set('Supplier',supplierMinimumContext('Supplier',currentRows).lines);currentRows=currentRows.map(r=>({...r}))",c);assert.equal(vm.runInContext("supplierMinimumRows('Supplier',[currentRows[0]]).length",c),1);assert.equal(vm.runInContext('supplierMinimums.accepted.size',c),0)})
test('accepted export rows are clones and never duplicate a now-visible SKU',()=>{const c=setup();vm.runInContext("supplierMinimums.accepted.set('Supplier',supplierMinimumContext('Supplier',currentRows).lines)",c);assert.equal(vm.runInContext("supplierMinimumRows('Supplier',currentRows).length",c),2);assert.equal(vm.runInContext("supplierMinimumRows('Supplier',currentRows)[1].minimumAdded",c),true);assert.equal(vm.runInContext('currentRows[1].minimumAdded',c),undefined)})
