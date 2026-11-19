// Lifecycle: living. Storage/reconciliation regressions found in final review.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../standalone/design/local-orders-gm-b.js',import.meta.url),'utf8')
function fixture(raw=null){
 const saved=new Map(),storage={getItem:key=>saved.get(key)??raw,setItem:(key,value)=>saved.set(key,value)}
 const ctx=vm.createContext({localStorage:storage,window:{addEventListener(){}},setInterval(){},console})
 vm.runInContext(`let data={as_of:'2026-10-31',items:[{sku:'A',unit:'pcs',on_order:10},{sku:'B',unit:'pcs',on_order:0}]},evaluationSnapshot=null,currentToday='2026-11-17';function gmSettingsKey(x){return JSON.stringify(x)};function localToday(){return currentToday};function dateOrdinal(s){return typeof s==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))?Date.parse(s)/86400000:null};function standaloneRows(){return []};function render(){};function wlMessage(){};function attentionRows(rows){return rows};function node(){return {children:[],append(...children){this.children.push(...children)}}};function wlBtn(text,click){return {text,click}};let cleared=[];`+source+`;function record(sku,qty){return {sku,qty,unit:'pcs',ordered_on:'2026-11-17',expected_on:'2026-12-01',supplier:'S',note:''}};globalThis.api={key:localOrderKey,save:localOrderSave,records:()=>localOrders.records,setup(){localOrders.records=[record('A',5),record('B',6)];return localOrderActions(data.items.map(item=>({item,guidance:{quantity:0}})))},cleared:()=>cleared,corrupt(){localStorage.setItem(localOrders.key,'not JSON')},reload(){localOrders.dataset=null;localOrderLoad()}};`,ctx)
 return {ctx,api:ctx.api,saved,storage}
}
test('invalid saved JSON blocks later writes, preserving original bytes',()=>{const {api,saved}=fixture('{bad');assert.equal(api.save([]),false);assert.equal(saved.size,0)})
test('invalid record is not silently filtered then overwritten',()=>{const {api,saved}=fixture(JSON.stringify([{sku:'A',qty:-1}]));assert.equal(api.save([]),false);assert.equal(saved.size,0)})
test('intervening storage change blocks stale writer',()=>{const {api,saved}=fixture();api.corrupt();const before=[...saved.values()][0];assert.equal(api.save([]),false);assert.equal([...saved.values()][0],before)})
test('same catalog key is stable for invisible-character SKUs in reversed input',()=>{const {api}=fixture();const items=[{sku:'SKU',unit:'m'},{sku:'S\u200cKU',unit:'m'},{sku:'S\u00adKU',unit:'m'}];assert.equal(api.key({items}),api.key({items:[...items].reverse()}))})
test('reconcile action targets only orders meeting the heuristic',()=>{const {ctx,api}=fixture();vm.runInContext('localOrderClear=function(rows){cleared=rows.map(r=>r.item.sku)}',ctx);const actions=api.setup();actions.children.find(b=>b.text.includes('looks received')).click();assert.deepEqual(Array.from(api.cleared()),['A'])})
