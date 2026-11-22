import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const source=read('desktop/plugin.js'),plain=v=>JSON.parse(JSON.stringify(v))
const c=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+source.slice(source.indexOf('// COST_DISPLAY_START'),source.indexOf('function CostFigures('))+'\nthis.api={calculate,orderGuidance,whyThisAmount,whyBreakdown,resolveOrderSettings,normalizeOrderSettings,displayCostMetrics,PROFIT_ORDER}',c)
const api=c.api,months=['2026-08','2026-09','2026-10'],asOf='2026-10-31',today='2026-11-01'
const item={sku:'COVER',name:'Synthetic',unit:'u',monthly_sales:[100,100,100],on_hand:0,on_order:0,supplier_days:0,pack_size:100,unit_cost:1,sale_price:10,receipts:{}}
function setup(global,cover){const settings={months_of_cover:global,product_overrides:{COVER:{months_of_cover:cover}}},i={...api.calculate([item],months,asOf,6,settings)[0],as_of:asOf};return {settings,i}}
function python(payload,code){const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c','import engine,profit_order,stock_runway,risk,json,sys\nx=json.load(sys.stdin)\n'+code],{cwd:new URL('..',import.meta.url),input:JSON.stringify(payload),encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout)}
test('resolved product cover explains the actual 300-unit three-month purchase with Python parity',()=>{
 const {settings,i}=setup(2,3),g=api.orderGuidance(i,today,settings,asOf),why=api.whyThisAmount(i,today,settings,asOf)
 assert.equal(g.quantity,300);assert.match(why,/3 months cover/);assert.doesNotMatch(why,/2 months cover/)
 const py=python({item:plain(i),settings,today,asOf},"print(json.dumps(engine.why_this_amount(x['item'],x['today'],x['settings'],x['asOf'])))")
 assert.equal(why,py)
})
test('zero-cover attribution uses product policy in both directions and ledgers still reconcile',()=>{
 const results=[]
 for(const [global,cover] of [[2,0],[0,3]]){
  const {settings,i}=setup(global,cover),g=api.orderGuidance(i,today,settings,asOf),rows=plain(api.whyBreakdown(i,today,settings,asOf))
  assert.equal(rows.some(r=>r.key==='replenishment_disabled'),cover===0)
  assert.equal(rows.reduce((n,r)=>n+r.qty,0),g.quantity)
  results.push({settings,item:plain(i),rows})
 }
 const py=python({results,today,asOf},"print(json.dumps([engine.why_breakdown(c['item'],x['today'],c['settings'],x['asOf']) for c in x['results']]))")
 assert.deepEqual(results.map(r=>r.rows),py)
})
test('profit explanation uses resolved cover without changing suggestion quantities',()=>{
 const {settings,i}=setup(2,3);settings.profit_suggestion=true
 const g=api.orderGuidance(i,today,settings,asOf)
 const direct=api.PROFIT_ORDER.forGuidance(i,g,settings,api.resolveOrderSettings(i,settings))
 assert.match(direct.reason,/90-day cover/)
 assert.ok(g.profit_suggestion);assert.match(g.profit_suggestion.reason,/90-day cover/)
 const py=python({item:plain(i),settings,today,asOf},"print(json.dumps(engine.order_guidance(x['item'],x['today'],x['settings'],x['asOf'])['profit_suggestion']))")
 assert.deepEqual(plain(g.profit_suggestion),py)
})
test('zero shelf caps use too-short reason, positive MOQ or pack conflicts retain conflict reason',()=>{
 const {settings,i}=setup(2,3);settings.profit_suggestion=true
 const short='Shelf life is too short for any order to be sold in time; using standard amount.',conflict='Shelf-life cap conflicts with the minimum order or pack size; using standard amount.'
 const results=[]
 for(const [cap,pack,moq] of [[0,1,0],[0,12,12],[0,0.5,0],[0.0000001,1,0],[10,12,0],[10,1,12],[10,1,0]]){
  settings.product_overrides.COVER={months_of_cover:3,pack_size:pack,minimum_order:moq}
  const resolved=api.resolveOrderSettings(i,settings),guidance={shelf_cap_qty:cap},reason=api.PROFIT_ORDER.unavailableReason(i,settings,guidance,resolved)
  assert.equal(reason,cap<0.000001?short:pack>cap||moq>cap?conflict:null)
  results.push({settings:plain(settings),guidance,reason})
 }
 const py=python({item:plain(i),results},"print(json.dumps([profit_order.unavailable_reason(x['item'],c['settings'],c['guidance'],engine.resolve_order_settings(x['item'],c['settings'])) for c in x['results']]))")
 assert.deepEqual(results.map(r=>r.reason),py)
})
test('Desktop and CLI risk adapters pass product-resolved cover, including explicit zero',()=>{
 for(const cover of [0,3]){
  const {settings,i}=setup(2,cover),g=api.orderGuidance(i,today,settings,asOf)
  c.inputs={i,g,settings,asOf,today};vm.runInContext('globalThis.StockRunwayRisk={simulateRisk(spec){globalThis.captured=spec;return {before:0,after:0,expected_shortfall:0}}};api.displayCostMetrics(inputs.i,inputs.g,inputs.settings,inputs.asOf,inputs.today)',c)
  assert.equal(c.captured.cover_months,cover)
  const py=python({item:plain(i),guidance:plain(g),settings,asOf,today},"out=[]\nrisk.simulate_risk=lambda spec: out.append(spec) or {'before':0,'after':0,'expected_shortfall':0}\nstock_runway._cost_display(x['item'],x['guidance'],engine,{'as_of':x['asOf']},x['today'],x['settings'])\nprint(json.dumps(out[0]['cover_months']))")
  assert.equal(py,cover)
 }
})
test('offline risk and product input report use resolved cover and correct source attribution',()=>{
 const riskSource=read('standalone/design/risk-gm-b.js'),reportSource=read('standalone/design/product-page-gm-b.js')
 for(const cover of [0,3]){
  const {settings,i}=setup(2,cover),g=api.orderGuidance(i,today,settings,asOf)
  const ctx=vm.createContext({window:{},performance:{now:()=>0},i:plain(i),g:plain(g),settings,Date,Intl})
  vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ',''),ctx)
  vm.runInContext(`const data={as_of:'${asOf}',months:${JSON.stringify(months)}},currentToday='${today}';const localOrderFor=()=>null;`,ctx)
  vm.runInContext(riskSource.slice(0,riskSource.indexOf('function productRisk(')),ctx)
  assert.equal(vm.runInContext('riskSpec({item:i,guidance:g}).cover_months',ctx),cover)
  vm.runInContext(`const output=[];function node(){return {append(){}}};function wlBtn(){return node()};function localOrderIncoming(){return 0};`,ctx)
  // Capture actual rendered input rows, not an implementation-string assertion.
  vm.runInContext(reportSource.slice(reportSource.indexOf('function productSource('),reportSource.indexOf('function productInputs('))+reportSource.slice(reportSource.indexOf('function productInputs('),reportSource.indexOf('function productLedger(')).replace("grid.append(r)","output.push([label,value,source]);grid.append(r)"),ctx)
  vm.runInContext('productInputs({item:i,guidance:g})',ctx)
  assert.deepEqual(plain(vm.runInContext("output.find(r=>r[0]==='Cover')",ctx)),['Cover',cover+' months','Product'])
 }
})
