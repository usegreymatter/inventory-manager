import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import {orderUpTo} from './policy-v2-support.mjs'
const root = new URL('../', import.meta.url)
const source = fs.readFileSync(new URL('desktop/plugin.js', root), 'utf8')
const pure = source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle ='))
const context = vm.createContext({TextEncoder, TextDecoder, atob, btoa})
vm.runInContext(pure.replaceAll('export ', '') + '\nglobalThis.p = {SAMPLE,calculate,orderGuidance,inventoryPlanning,salesPattern,normalizeOrderSettings,DEFAULT_ORDER_SETTINGS}', context)
const {SAMPLE, calculate, orderGuidance, normalizeOrderSettings} = context.p
const plain = value => JSON.parse(JSON.stringify(value))
const fields = ['demand_swing','safety_stock','reorder_point','eoq','why']
const pick = row => Object.fromEntries(fields.map(k => [k,row[k]]))

test('planning JS and Python match exactly for every sample item under two settings combinations', () => {
  const combos = [{order_cost:15,product_overrides:Object.fromEntries(SAMPLE.items.map(i=>[i.sku,{unit_cost:1.2}]))},
    {service_level:.99,review_days:7,default_delivery_days:30,order_cost:22,holding_pct:28,include_backup_in_orders:true,
      product_overrides:Object.fromEntries(SAMPLE.items.map(i=>[i.sku,{unit_cost:3.5,minimum_order:1000,pack_size:24}]))}]
  const py = `import json,sys,types\nfrom pathlib import Path\nr=Path.cwd();p=types.ModuleType('stock_runway');p.__path__=[str(r)];sys.modules['stock_runway']=p\nfrom stock_runway.engine import forecast\nd=json.loads((r/'data/sample.json').read_text());ss=json.loads(sys.stdin.read())\nprint(json.dumps([[forecast(i,d['months'],d['as_of'],settings=s) for i in d['items']] for s in ss]))`
  const python = JSON.parse(execFileSync(process.env.PYTHON || '/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(combos),encoding:'utf8'}))
  combos.forEach((settings,n) => {
    const rows = calculate(SAMPLE.items,SAMPLE.months,SAMPLE.as_of,6,settings)
    rows.forEach((row,i) => {
      assert.ok(fields.every(k=>Object.hasOwn(row,k)), 'all planning fields exist')
      assert.deepEqual(plain(pick(row)),pick(python[n][i]), row.sku)
      assert.deepEqual(plain(pick(orderGuidance(row,'2026-11-11',settings))),plain(pick(row)))
    })
  })
})

test('planning exact parity covers non-sample floats null inputs and corrupt product overrides', () => {
  const make=(sales,settings={})=>({item:{sku:'T',monthly_sales:sales,supplier_days:14,unit_cost:2},settings})
  const cases=[make([202,730,887,676,784]),make([10,20]),make([0,0,0])]
  for(const bad of ['x',null,[],5]) cases.push(make([10,20,30,40],{order_cost:50,product_overrides:{T:bad}}))
  let seed=123456789
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
  for(let i=0;i<500;i++) cases.push(make(Array.from({length:3+next()%10},()=>next()%10000/(i%2?7:1)),
    {order_cost:15,product_overrides:{T:{unit_cost:i%3?1.2:1e-8,pack_size:.25}}}))
  const py=`import json,sys\nfrom engine import inventory_planning\nprint(json.dumps([inventory_planning(c['item'],'2026-10',c['settings']) for c in json.load(sys.stdin)]))`
  const expected=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8'}))
  cases.forEach((c,i)=>assert.deepEqual(plain(context.p.inventoryPlanning(c.item,'2026-10',c.settings)),expected[i],`fixture ${i}`))
})

test('default sample safety stock is added before MOQ / pack rounding; zero cover never orders', () => {
  const months=['2026-08','2026-09','2026-10'],asOf='2026-10-31'
  const item={sku:'TEST',name:'Test',unit:'units',on_hand:0,supplier_days:14,monthly_sales:[60,90,120],receipts:{}}
  const [row]=calculate([item],months,asOf,6)
  const off=orderGuidance(row,asOf,{include_backup_in_orders:false})
  const on=orderGuidance(row,asOf,{product_overrides:{TEST:{minimum_order:100,pack_size:24}}})
  const ss=Math.ceil(1.6449 * 30 * Math.sqrt((14+30)/30))
  assert.equal(on.safety_stock,ss)
  assert.equal(off.quantity,Math.ceil(180+90*13/31))
  assert.equal(on.quantity,Math.ceil((180+90*13/31+ss)/24)*24)
  assert.equal(on.runout_date,off.runout_date)
  assert.equal(on.order_by,off.order_by)
  assert.equal(orderGuidance(row,asOf).quantity,off.quantity+ss)
  for(const include_backup_in_orders of [false,true])
    assert.equal(orderGuidance(row,asOf,{months_of_cover:0,include_backup_in_orders,product_overrides:{TEST:{minimum_order:100,pack_size:24}}}).quantity,0)
})

test('default sample policy v2 dates and quantities match independently reviewed order-up-to results', () => {
  const rows=calculate(SAMPLE.items,SAMPLE.months,SAMPLE.as_of,6)
  rows.forEach((row,i)=>{
    const g=orderGuidance(row,'2026-11-11')
    assert.equal(g.quantity,orderUpTo(row,g),row.sku)
    assert.equal(g.stock_date,SAMPLE.as_of)
    assert.equal(g.lead_days,Math.ceil(row.supplier_days??14))
    assert.equal(g.endpoint,new Date(Date.parse(g.order_date+'T00:00:00Z')+(g.lead_days+60)*86400000).toISOString().slice(0,10))
    assert.equal(g.buffer_demand,0)
  })
})

test('planning settings normalize costs and strict boolean without accepting corrupt persistence', () => {
  const normalized=normalizeOrderSettings({service_level:.8,review_days:-1,order_cost:'15',holding_pct:0,include_backup_in_orders:'true'})
  assert.equal(normalized.service_level,.95)
  assert.equal(normalized.review_days,30)
  assert.equal(normalized.order_cost,null)
  assert.equal(normalized.holding_pct,20)
  assert.equal(normalized.include_backup_in_orders,true)
  assert.equal(normalizeOrderSettings({include_backup_in_orders:false}).include_backup_in_orders,false)
  assert.equal(normalizeOrderSettings({product_overrides:{TEST:{unit_cost:1.2}}}).product_overrides.TEST.unit_cost,1.2)
})

test('sales pattern uses plain display buckets at exact boundaries, including null and zero', () => {
  for (const [sigma,mean,expected] of [[null,100,null],[0,0,'Steady'],[24.9,100,'Steady'],[25,100,'Up and down'],[59.9,100,'Up and down'],[60,100,'Very uneven'],[100,0,'Very uneven']])
    assert.equal(context.p.salesPattern(sigma,mean),expected)
})

test('planning uses standard-plus-plain settings and detail labels', () => {
  for(const label of ['Planning (optional)','Safety stock — extra kept for delays or surprise demand','Reorder point — order when stock drops to','Most economical order size','Chance of not running out per order cycle','Review period — how often you order (days)','Cost per order (ordering cost)','Holding cost — % of item cost per year (storage, money tied up, damage)','Unit cost — what one unit costs you','Add safety stock to suggested orders']) assert.ok(source.includes(label),label)
  for(const label of ['Some risk · 90% (about 1 order in 10)','Low risk · 95% (1 in 20)','Very low risk · 99% (1 in 100)']) assert.ok(source.includes(label))
  assert.ok(source.includes('Service level'))
})
