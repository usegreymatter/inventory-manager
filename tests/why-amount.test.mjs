import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'

const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const context = vm.createContext({TextEncoder, TextDecoder, Date, Intl})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle =')).replaceAll('export ', '') + '\nthis.api={calculate,orderGuidance,whyBreakdown,whyThisAmount}', context)
const api = context.api, plain = x => JSON.parse(JSON.stringify(x))
const corpus = []
for (const name of ['sample', 'demo-1000']) {
  const data = JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
  for (const item of data.items) corpus.push({name, item, months:data.months, as_of:data.as_of, today:data.as_of})
}
let seed = 711902
const rand = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n)
for (let i = 0; i < 200; i++) {
  const months = ['2026-08', '2026-09', '2026-10'], sku = `SYN-${i}`
  const item = {sku, name:'Synthetic', unit:'units', on_hand:[0, .1, 25, 1000][rand(4)],
    monthly_sales:Array.from({length:3}, () => rand(4000)/100), receipts:{}}
  if (i % 7 === 0) item.monthly_sales = [0,0,0]
  if (i % 11 === 0) item.on_hand = null
  if (i % 3 === 0) item.on_order = rand(50)/10
  if (i % 4 === 0) item.receipts = {'2026-12':rand(100)/10}
  if (i % 5 !== 0) item.supplier_days = rand(60)
  if (i % 6 === 0) item.demand_change_pct = [-50,0,50][rand(3)]
  const settings = {months_of_cover:[0,.5,2,3.5][rand(4)], include_backup_in_orders:Boolean(rand(2)),
    product_overrides:{[sku]:{pack_size:[.1,.125,.3,4][rand(4)], minimum_order:[0,.4,100][rand(3)]}}}
  if (i % 13 === 0) settings.default_delivery_days = null
  corpus.push({name:'random', item, months, settings, as_of:'2026-10-31', today:'2026-11-01'})
}
// Dated holds and adjusted demand paths must use the existing breakdown too.
for (const file of ['phase2-inputs', 'manual-inputs']) {
  const data = JSON.parse(fs.readFileSync(new URL(`./golden/${file}.json`, import.meta.url), 'utf8'))
  corpus.push(...data.cases.map(c => ({...c, name:file, as_of:'2026-10-31', today:'2026-11-01'})))
}

const late = structuredClone(corpus.find(c => c.item.sku === 'SAME-DAY-SUPPLY'))
late.name = 'late-po-hold'
late.item.planning_facts.incoming_pos[0].due_date = '2026-10-31'
corpus.push(late)

test('explanation parity, purity and exact sentence reconciliation: sample, demo-1000, 200 seeded items, dated holds', () => {
  assert.equal(corpus.filter(c => c.name === 'demo-1000').length, 1000)
  assert.equal(corpus.filter(c => c.name === 'random').length, 200)
  const py = spawnSync('/usr/bin/python3', ['tests/why_amount_bridge.py'], {
    input:JSON.stringify(corpus), encoding:'utf8', maxBuffer:64*1024*1024,
    env:{...process.env, TMPDIR:process.cwd()+'/.scratch'}})
  assert.equal(py.status, 0, py.stderr)
  const expected = JSON.parse(py.stdout)
  assert.equal(expected.length, corpus.length)
  const covered = new Set()
  for (const [i,c] of corpus.entries()) {
    const settings = c.settings || {}, savedSettings = JSON.stringify(settings)
    const item = api.calculate([c.item], c.months, c.as_of, 6, settings, c.today)[0]
    // Guidance requires raw fractional stock (calculate rounds chart stock).
    Object.assign(item, {on_hand:c.item.on_hand, monthly_sales:c.item.monthly_sales})
    const saved = JSON.stringify(item), g = api.orderGuidance(item,c.today,settings)
    const rows = plain(api.whyBreakdown(item,c.today,settings))
    rows.forEach(r => covered.add(r.key))
    const sentence = api.whyThisAmount(item,c.today,settings)
    assert.equal(JSON.stringify(item),saved,`item mutated: ${i}`)
    assert.equal(JSON.stringify(settings),savedSettings,`settings mutated: ${i}`)
    assert.deepEqual({quantity:g.quantity??null,rows,sentence},expected[i],`${i} ${c.name}/${c.item.sku}`)
    if (g.quantity == null) {
      assert.match(sentence,/Purchase advice held:/)
      assert.doesNotMatch(sentence,/Suggested order:/)
    } else {
      // Each numeric term is independently parseable, in ledger order, without rounding.
      const terms = [...sentence.matchAll(/([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?) \[/g)].map(m => Number(m[1]))
      const displayed=Number(sentence.match(/^Suggested order: ([\d.]+)/)[1])
      const precision=Math.min(6,Math.max(2,(String(g.quantity).split('.')[1]||'').length)),scale=10**precision
      assert.equal(terms.reduce((a,b) => a+Math.round(b*scale),0),Math.round(displayed*scale),`decimal display sum ${i}`)
      assert.ok(sentence.startsWith(`Suggested order: ${g.quantity} ${item.unit||'units'} = `))
      assert.equal(rows.reduce((a,r)=>a+r.qty,0),g.quantity,'exact JSON ledger preserved')
    }
    if (g.used_default_lead) assert.match(sentence,/Assumed lead time:/)
    if (g.undated_on_order_assumed_within_lead) assert.match(sentence,/Undated incoming is assumed within lead time/)
    if (g.monthly_demand === 0) assert.match(sentence,/No forecast demand/)
    if (!Object.hasOwn(c.item,'on_order') && g.quantity != null) assert.match(sentence,/Unknown incoming is assumed zero/)
  }
  for (const key of ['minimum_order','pack_rounding','arithmetic_reconciliation','late_po_hold',
    'data_hold','demand_history_hold','committed_orders_hold','undated_incoming',
    'incoming_supply','stockout_correction','projects_excluded','manual_change']) {
    assert.ok(covered.has(key),`missing coverage: ${key}`)
  }
  console.log(`Verified ${corpus.length} explanation cases with exact text/ledger reconciliation`)
})
