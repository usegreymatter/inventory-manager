import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
const root=new URL('../',import.meta.url),s=fs.readFileSync(new URL('desktop/plugin.js',root),'utf8')
const c=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.qa={inventoryPlanning,validateOrderSettings,normalizeOrderSettings,withEvaluationPass}',c)
const plain=x=>JSON.parse(JSON.stringify(x))
test('forecast-miss buffers exact Python parity, all methods, thin/long/zero/seasonal histories and receipt variance',()=>{
 const rows=[];let seed=123
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32}
 for(let i=0;i<170;i++){
  const n=[3,10,11,12,24,36,60][i%7],method=['current','auto','naive','seasonal_naive','ma3','ma6','ma12','ses','holt_damped','hw_additive','hw_multiplicative','theta','croston','sba','tsb','adida','combination'][i%17]
  const sales=Array.from({length:n},(_,k)=>i%9===0?0:i%3===0?(rand()<.25?100*rand():0):Math.round(100+70*Math.sin(k*Math.PI/6)+20*rand()))
  const item={sku:'S'+i,monthly_sales:sales,on_hand:20,supplier_days:[0,14,90,3650][i%4],receipt_history:i%2?[]:Array.from({length:5},(_,k)=>({ordered_on:'2023-01-01',received_on:'2023-01-'+String(2+k*2).padStart(2,'0'),quantity:1}))}
  rows.push({item,last:'2024-12',settings:{forecast_method:method,safety_stock_basis:'forecast_misses',service_level:[.9,.95,.99][i%3]}})
 }
 const py="import json,sys,engine\nprint(json.dumps([engine.inventory_planning(x['item'],x['last'],x['settings']) for x in json.load(sys.stdin)]))"
 const expected=JSON.parse(execFileSync('/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(rows),encoding:'utf8',maxBuffer:32*1024*1024}))
 rows.forEach((r,i)=>assert.deepEqual(plain(c.qa.inventoryPlanning(r.item,r.last,r.settings)),expected[i],'fixture '+i))
 console.log('Forecast-miss exact planner parity: '+rows.length+' fixtures')
})
test('basis strict validation, default off and cache invalidates edited observations',()=>{
 for(const v of [null,true,{},'__proto__','bad'])assert.throws(()=>c.qa.validateOrderSettings({safety_stock_basis:v}))
 assert.equal(c.qa.normalizeOrderSettings({}).safety_stock_basis,'sales_variation')
 const item={sku:'EDIT',monthly_sales:Array(36).fill(100),supplier_days:14,on_hand:20},settings={forecast_method:'ses',safety_stock_basis:'forecast_misses'}
 c.qa.withEvaluationPass(()=>{
  const a=c.qa.inventoryPlanning(item,'2024-12',settings)
  item.monthly_sales[35]=500
  const b=c.qa.inventoryPlanning(item,'2024-12',settings)
  assert.notDeepEqual(plain(a),plain(b))
 })
})
