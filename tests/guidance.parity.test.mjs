// Exact field-by-field oracle: Desktop and Python share reviewed fixes. Same VM shims as desktop.test.mjs.
import assert from 'node:assert/strict'
import {orderUpTo} from './policy-v2-support.mjs'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const pure = source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle ='))
const context = vm.createContext({ TextEncoder, TextDecoder, atob, btoa })
vm.runInContext(pure.replaceAll('export ', '') + '\nglobalThis.helpers = { SAMPLE, calculate, parseCsv, orderGuidance, orderBucket, activeSkip, salesDataAge, bigOrderWarning, normalizeOrderSettings, orderSentence, shortageSentence, gapSentence, noOrderSentence, validCard, decodeCard }', context)
const h = context.helpers
const plain = value => JSON.parse(JSON.stringify(value))
const cases = []
const shift = (start, days) => new Date(Date.parse(start + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
function addData(name, data, settings = {}, offsets = [-30, 0, 30, 200]) {
  const items = h.calculate(data.items, data.months, data.as_of, 6, settings)
  for (const offset of offsets) for (const item of items) {
    cases.push({ name: `${name}/${item.sku}/${offset}/${cases.length}`, item: plain(item), today: shift(data.as_of, offset), settings, as_of: data.as_of, months: data.months })
  }
}
addData('sample', h.SAMPLE)
for (const name of fs.readdirSync(new URL('../docs/erp-examples/', import.meta.url)).filter(name => name.endsWith('.csv')).sort()) {
  addData(name, h.parseCsv(fs.readFileSync(new URL('../docs/erp-examples/' + name, import.meta.url), 'utf8')))
}
// Deterministic cross product exercises every service level, seasonality, decimals,
// receipt restoration/first gaps, incoming coverage, stale dates, MOQ, and skips.
for (let i = 0; i < 108; i++) {
  const seasonal = i % 3 === 0
  const months = seasonal ? Array.from({length:12}, (_, j) => `${j < 2 ? 2025 : 2026}-${String((j+10)%12+1).padStart(2,'0')}`) : ['2026-08','2026-09','2026-10']
  const sales = seasonal ? Array.from({length:12}, (_, j) => [0, 2.75, 15, 800, 999999999999.875][(i+j)%5])
    : i % 9 === 0 ? [0,0,0] : [i+.125, i*3+.375, i*2+.625]
  const item = {sku:`SYN-${i}`, name:'Synthetic', unit:'ea', on_hand:[0, .125, 10, 1000, 999999999999.875][i%5], monthly_sales:sales, receipts:{}}
  if (i%4 === 0) item.on_order = i%8 === 0 ? 1000000000000 : .375
  if (i%5 === 0) item.receipts = {'2026-11': .125, '2026-12': 999999999999.5, '2027-03': 3}
  if (i%4 !== 1) item.supplier_days = [0, 14.5, 100, 3650][i%4]
  const settings = {service_level:[.9,.95,.99][i%3], include_backup_in_orders:i%2===0, months_of_cover:[0,.125,2,36][i%4],
    product_overrides:{[item.sku]:{pack_size:[.125,.000001,1,2.5][i%4], minimum_order:i%7===0 ? 10000.125 : 0}},
    skipped_items:{[item.sku]:{reason:'Already ordered', skipped_on:'2026-10-25', as_of:'2026-10-31'}}}
  if (i%6===0) settings.big_order_months = .5
  if (i%11===0) settings.default_delivery_days = null
  addData(`synthetic-${i}`, {items:[item], months, as_of:'2026-10-31'}, settings)
}
// Raw guidance inputs exercise validation/calendars independently of calculate's held-item guard.
const base = {sku:'RAW', name:'Raw', unit:'ea', on_hand:10, monthly_sales:[30,30,30], monthly_demand:30, seasonal:false, receipts:{}, as_of:'2026-10-31'}
for (const [name, patch, settings, asOf, today] of [
  ['invalid-stock', {on_hand:-1}, {}, '2026-10-31', '2026-11-12'],
  ['invalid-date', {}, {}, '2026-10-30', '2026-11-12'],
  ['invalid-receipt', {receipts:{'2026-13':1}}, {}, '2026-10-31', '2026-11-12'],
  ['bad-pack', {}, {product_overrides:{RAW:{pack_size:.0000001}}}, '2026-10-31', '2026-11-12'],
  ['bad-minimum', {}, {product_overrides:{RAW:{minimum_order:-1}}}, '2026-10-31', '2026-11-12'],
  ['calendar-runout', {on_hand:1e12, monthly_demand:1}, {}, '2026-10-31', '2026-11-12'],
  ['calendar-position', {on_order:1e12, monthly_demand:1}, {}, '2026-10-31', '2026-11-12'],
  ['calendar-order', {on_hand:0, supplier_days:3650}, {}, '1000-01-31', '1000-02-01'],
  ['calendar-endpoint', {on_hand:0}, {}, '9999-10-31', '9999-12-31'],
  ['zero-sales', {on_hand:10, monthly_demand:0, monthly_sales:[0,0,0]}, {}, '2026-10-31', '2026-11-12'],
  ['zero-everything', {on_hand:0, monthly_demand:0, monthly_sales:[0,0,0]}, {}, '2026-10-31', '2026-11-12'],
  ['fractional-demand', {monthly_demand:.125}, {}, '2026-10-31', '2026-11-12'],
  ['cover-incoming', {on_order:1000, on_hand:100}, {}, '2026-10-31', '2026-11-12'],
  ['gap-incoming', {on_order:1000, on_hand:0}, {}, '2026-10-31', '2026-11-12'],
]) cases.push({name, item:{...base,...patch,as_of:asOf},settings,as_of:asOf,today,months:['2026-08','2026-09','2026-10']})

for (const cover of [0,.125,2,36]) for (const buffer of [0,7,365,3650])
  cases.push({name:`buffer-bounds-${cover}-${buffer}`,item:{...base,on_hand:990,supplier_days:14},
    settings:{months_of_cover:cover,buffer_days:buffer},as_of:base.as_of,today:'2026-11-12',months:['2026-08','2026-09','2026-10']})

cases.push({name:'gap-with-positive-order',item:{...base,on_hand:40,on_order:160,supplier_days:150},
  settings:{},as_of:base.as_of,today:'2026-11-12',months:['2026-08','2026-09','2026-10']})

// September uses en-GB's "Sept" for dates, not en-US month-label "Sep".
for (const on_hand of [300, 330, 340]) cases.push({name:`september-${on_hand}`,
  item:{...base,on_hand,supplier_days:14},settings:{},as_of:base.as_of,
  today:'2026-11-12',months:['2026-08','2026-09','2026-10']})

// Reproducible LCG fuzz: independent random stock, sales, receipts, lead time,
// cover, packs, safety inclusion and dates, including seasonal histories.
let seed = 0x5eed1234
const random = n => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return Math.floor(seed / 0x100000000 * n) }
for (let i=0; i<1200; i++) {
  const seasonal = random(2) === 0
  const months = seasonal ? Array.from({length:12},(_,j)=>`${j<2?2025:2026}-${String((j+10)%12+1).padStart(2,'0')}`) : ['2026-08','2026-09','2026-10']
  const raw = {sku:`FUZZ-${i}`,name:'Synthetic fuzz',unit:'ea',on_hand:random(30000)/8,
    monthly_sales:Array.from({length:months.length},()=>random(1600)/8),supplier_days:random(731)/2,receipts:{}}
  if (random(3)===0) raw.on_order=random(12000)/8
  if (random(3)===0) raw.receipts={'2026-12':random(4000)/8,'2027-03':random(4000)/8}
  const settings={buffer_days:random(3651),months_of_cover:[0,.125,2,6,12,36][random(6)],service_level:[.9,.95,.99][random(3)],
    include_backup_in_orders:random(2)===0,product_overrides:{[raw.sku]:{pack_size:[.000001,.125,1,2.5][random(4)]}}}
  const [item]=h.calculate([raw],months,base.as_of,6,settings)
  cases.push({name:`seeded-fuzz-${i}`,item:plain(item),settings,as_of:base.as_of,
    today:shift(base.as_of,random(500)-100),months})
}

// Deliberate Python hardening is narrowly allowlisted below, never silently
// excluded from the corpus. All other odd inputs must match Desktop exactly.
const odd = [
  ['receipts-missing', (()=>{const item={...base};delete item.receipts;return item})(), '2026-11-12'],
  ['receipts-null', {...base,receipts:null}, '2026-11-12'],
  ['held-array', {...base,held:[]}, '2026-11-12'],
  ['held-object', {...base,held:{}}, '2026-11-12'],
  ['year-zero', {...base}, '0000-01-01'],
  ['sales-null', {...base,monthly_sales:null,seasonal:true,on_hand:300}, '2026-11-12'],
]
for(const [name,item,today] of odd) cases.push({name,item,today,settings:{},as_of:base.as_of,months:['2026-08','2026-09','2026-10']})

// Desktop loads settings through normalizeOrderSettings before rendering its
// warning. Keep raw settings for guidance validation (notably invalid MOQ/packs).
const malformed = [null, 'bad', '6', '', false, true, -1, NaN, Infinity, -Infinity, [], {}, [6]]
const addMalformed = (name, settings) => cases.push({name, item:{...base}, settings,
  today:'2026-11-12', as_of:base.as_of, months:['2026-08','2026-09','2026-10']})
for (const [i, value] of malformed.entries()) {
  addMalformed(`malformed-container-${i}`, value)
  // A >6-month order makes NaN/Infinity fallback observable: passing those raw
  // thresholds to the warning would silently suppress a required warning.
  addMalformed(`large-order-big_order_months-${i}`, {months_of_cover:12, big_order_months:value})
  for (const key of ['big_order_months', 'default_delivery_days', 'months_of_cover', 'overstock_months',
    'buffer_days', 'urgent_days', 'running_low_days', 'service_level', 'review_days', 'order_cost', 'holding_pct',
    'include_backup_in_orders', 'product_overrides']) addMalformed(`malformed-${key}-${i}`, {[key]:value})
}
for (const key of ['default_delivery_days','buffer_days','urgent_days','running_low_days','review_days'])
  addMalformed(`fractional-${key}`, {[key]:1.5})
for (const key of ['big_order_months','default_delivery_days','months_of_cover','overstock_months',
  'buffer_days','urgent_days','running_low_days','service_level','review_days','order_cost','holding_pct'])
  addMalformed(`out-of-range-${key}`, {[key]:1e20})

for (const buffer_days of [0,7,30,3650]) addData(`buffer-${buffer_days}`, h.SAMPLE, {buffer_days})

const expected = cases.map(c => {
  const guidance = h.orderGuidance(c.item,c.today,c.settings,c.as_of)
  const result = {guidance, bucket:h.orderBucket(c.item,c.today,c.settings,c.as_of),
    skip:h.activeSkip(c.settings,c.item.sku,c.today,c.as_of) ?? null,
    age:h.salesDataAge(c.months,c.today), warning:h.bigOrderWarning(guidance,h.normalizeOrderSettings(c.settings))}
  if(guidance.status !== 'needs-data') Object.assign(result,{order_sentence:h.orderSentence(c.item,guidance),
    shortage_sentence:h.shortageSentence(c.item,guidance),gap_sentence:h.gapSentence(guidance),no_order_sentence:h.noOrderSentence(c.item,guidance)})
  return plain(result)
})
const python = spawnSync(process.env.PYTHON || 'python3', [new URL('./guidance_bridge.py', import.meta.url).pathname], {input:JSON.stringify(cases, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? {__nonfinite__:String(value)} : value), encoding:'utf8',maxBuffer:32*1024*1024})

test('Python guidance oracle exits successfully', () => {
  assert.equal(python.status,0,python.stderr)
  assert.equal(cases.filter(c=>c.name.startsWith("seeded-fuzz-")).length,1200)
  assert.ok(cases.length >= 1500, `Only ${cases.length} compared cases`)
})
const actual = python.status === 0 ? JSON.parse(python.stdout) : []
const intentionalHardening = new Map([
  ['receipts-missing','empty-receipts'], ['receipts-null','empty-receipts'], ['year-zero','invalid-calendar']
])
for (let i = 0; i < cases.length; i++) test(`guidance parity ${cases[i].name}`, () => {
  const allowed = intentionalHardening.get(cases[i].name)
  if (allowed === 'empty-receipts') {
    // Python safely interprets missing/null receipts as empty; Desktop's direct
    // lookup throws. Pin both behaviours, and compare every Python output field
    // to Desktop with an explicit empty map (no broad field exclusions).
    assert.deepEqual(expected[i], {guidance:{status:'needs-data',reason:'The forecast exceeds the supported arithmetic range.'},
      bucket:'needs-data',skip:null,age:12,warning:null})
    const item={...cases[i].item,receipts:{}}
    const guidance=h.orderGuidance(item,cases[i].today)
    assert.deepEqual(actual[i],plain({guidance,bucket:h.orderBucket(item,cases[i].today),skip:null,age:12,warning:null,
      order_sentence:h.orderSentence(item,guidance),shortage_sentence:h.shortageSentence(item,guidance),
      gap_sentence:h.gapSentence(guidance),no_order_sentence:h.noOrderSentence(item,guidance)}))
  } else if (allowed === 'invalid-calendar') {
    // Python's calendar has no year zero; reject it rather than invent an epoch.
    assert.equal(expected[i].guidance.status,'order')
    assert.equal(expected[i].bucket,'healthy')
    assert.equal(expected[i].age,0)
    assert.deepEqual(actual[i],{guidance:{status:'needs-data',reason:'Needs a valid stock date, stock and forecast.'},
      bucket:'needs-data',skip:null,age:null,warning:null})
  } else assert.deepEqual(actual[i],expected[i])
})
test('hardening allowlist is exact and all 1200 seeded cases have zero differences',()=>{
  assert.deepEqual(cases.filter(c=>intentionalHardening.has(c.name)).map(c=>c.name).sort(),[...intentionalHardening.keys()].sort())
  const fuzz=cases.map((c,i)=>({c,i})).filter(({c})=>c.name.startsWith('seeded-fuzz-'))
  assert.equal(fuzz.length,1200)
  for(const {i} of fuzz) assert.deepEqual(actual[i],expected[i])
})
test(`exact parity case count: ${cases.length}`,()=>assert.equal(actual.length,cases.length))

test('purchase status invariants across regression and 1200 seeded cases', () => {
  const regression = cases.findIndex(c=>c.name==='gap-with-positive-order')
  for (const result of [expected[regression],actual[regression]]) {
    assert.equal(result.guidance.quantity,orderUpTo(cases[regression].item,result.guidance))
    assert.equal(result.guidance.supply_gap,true)
    assert.equal(result.bucket,'order','uncovered gap with a positive purchase must take precedence')
  }
  for (const [i,c] of cases.entries()) {
    if (intentionalHardening.has(c.name)) continue
    for (const [surface,result] of [['JS',expected[i]],['Python',actual[i]]]) {
      const {guidance:g,bucket} = result
      if (g.status === 'needs-data') continue
      const name = `${surface}/${c.name}`
      const settings = h.normalizeOrderSettings(c.settings)
      const due = Date.parse(g.order_by + 'T00:00:00Z')
      const now = Date.parse(c.today + 'T00:00:00Z')
      const window = settings.running_low_days
      if (g.supply_gap) assert.ok(!['overstocked','healthy'].includes(bucket),name+' uncovered gap')
      if (g.quantity > 0) {
        assert.notEqual(bucket,'overstocked',name+' positive order')
        if (g.order_by === 'now' || due <= now+settings.urgent_days*86400000 || g.supply_gap)
          assert.equal(bucket,'order',name+' urgent order')
        else if (due <= now+window*86400000)
          assert.equal(bucket,'running-low',name+' within order-by threshold')
      } else {
        assert.notEqual(bucket,'order',name+' zero quantity cannot be Order now')
        assert.equal(g.order_by,null,name+' no purchase deadline without quantity')
      }
    }
  }
})

test('chat purchase lines and guidance match Desktop; existing compact card still validates', () => {
  const child = spawnSync(process.env.PYTHON || 'python3', [new URL('./guidance_bridge.py', import.meta.url).pathname, '--chat'], {encoding:'utf8'})
  assert.equal(child.status,0,child.stderr)
  const {payload,slash} = JSON.parse(child.stdout)
  const desktop = h.calculate(h.SAMPLE.items,h.SAMPLE.months,h.SAMPLE.as_of,6)
  for (const item of desktop) {
    const guidance = h.orderGuidance(item,'2026-11-12')
    const row = payload.items.find(row=>row.sku===item.sku)
    assert.deepEqual(row.guidance,plain(guidance))
    assert.equal(row.order_bucket,h.orderBucket(item,'2026-11-12'))
    const sentence = guidance.quantity > 0 ? h.orderSentence(item,guidance) : h.noOrderSentence(item,guidance)
    const labels={order:'Order now','running-low':'Order soon',healthy:'OK',overstocked:'Overstocked','no-sales':'No sales','needs-data':'Not enough history'}
    let line=item.sku+': '+sentence+'; '+labels[h.orderBucket(item,'2026-11-12')]
    for(const extra of [h.shortageSentence(item,guidance),h.bigOrderWarning(guidance,h.normalizeOrderSettings({}))])
      if(extra) line+='; '+extra
    assert.ok(payload.purchase_summary.includes(line),line)
    assert.ok(slash.split('\n').includes('• '+line),line)
  }
  const encoded = payload.card.match(/^::stock-runway\{data="([A-Za-z0-9_-]+)"\}$/)[1]
  const card = h.decodeCard({data:encoded})
  assert.ok(card)
  assert.equal(h.validCard(card),true)
  assert.deepEqual(Object.keys(card).sort(),['as_of','disclosure','horizon','more','rows'])
})
