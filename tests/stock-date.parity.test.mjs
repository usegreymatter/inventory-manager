// Stock count date parity: Desktop/standalone JS and Python must agree field by field. Synthetic only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const pure = source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle ='))
const context = vm.createContext({ TextEncoder, TextDecoder, atob, btoa })
vm.runInContext(pure.replaceAll('export ', '') + '\nglobalThis.helpers = { calculate, orderGuidance, applyStockDate, stockDateNotice, STOCK_DATE_ZERO_SALES_WARNING, stockDateReason, normalizeOrderSettings, validateOrderSettings }', context)
const h = context.helpers
const plain = value => JSON.parse(JSON.stringify(value))
const KEYS = ['quantity', 'order_by', 'runout_date', 'out_of_stock', 'status', 'safety_stock', 'reorder_point']
const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
const item = (sku, extra = {}) => ({ sku, name: sku, unit: 'box', on_hand: 3000, supplier_days: 14, monthly_sales: [930, 900, 930, 930, 900, 930], ...extra })
const data = (...items) => ({ as_of: '2026-10-31', months: MONTHS, items })

function js(c) {
  const { data: d, today, stock_date: stockDate } = c
  const out = { notice: h.stockDateNotice(d.as_of, today, stockDate ?? null), reason: stockDate ? h.stockDateReason(stockDate, d.as_of, today) : null }
  let moved
  try { moved = stockDate ? h.applyStockDate(d, stockDate, today) : d } catch (error) { out.error = error.message; return out }
  out.items = moved.items.map(raw => {
    const row = Object.fromEntries(['on_hand', 'counted_on_hand', 'stock_counted_on', 'stock_date_adjustment', 'input_warnings'].map(k => [k, raw[k] ?? null]))
    try {
      const physical = h.calculate([raw], moved.months, moved.as_of, 6, undefined, today)[0]
      const it = { ...raw, ...physical, on_hand: raw.on_hand, monthly_sales: raw.monthly_sales, as_of: moved.as_of }
      const g = h.orderGuidance(it, today, undefined, moved.as_of)
      row.guidance = Object.fromEntries(KEYS.map(k => [k, g[k] ?? null]))
    } catch (error) { row.guidance_error = 'Error' }
    return row
  })
  return plain(out)
}

const seasonal = [120, 340, 80.5, 610, 0, 455.25]
const cases = [
  { name: 'no date, stale today warns', data: data(item('A')), today: '2026-11-24' },
  { name: 'no date, fresh today quiet', data: data(item('A')), today: '2026-11-05' },
  { name: 'count on today', data: data(item('A')), today: '2026-11-24', stock_date: '2026-11-24' },
  { name: 'count on as_of', data: data(item('A')), today: '2026-11-24', stock_date: '2026-10-31' },
  { name: 'count inside last month', data: data(item('A')), today: '2026-11-24', stock_date: '2026-10-15' },
  { name: 'count first day of last month', data: data(item('A')), today: '2026-11-24', stock_date: '2026-10-01' },
  { name: 'count across a month boundary', data: data(item('A')), today: '2027-01-10', stock_date: '2026-12-20' },
  { name: 'seasonal fractional sales and stock', data: data(item('S', { monthly_sales: seasonal, on_hand: 812.5, supplier_days: 30 })), today: '2026-11-24', stock_date: '2026-11-18' },
  { name: 'seasonal inside month', data: data(item('S', { monthly_sales: seasonal, on_hand: 812.5 })), today: '2026-11-24', stock_date: '2026-10-07' },
  { name: 'low stock already short', data: data(item('L', { on_hand: 200 })), today: '2026-11-24', stock_date: '2026-11-24' },
  { name: 'zero last month inside count warns', data: data(item('Z0', { monthly_sales: [930, 900, 930, 930, 900, 0] })), today: '2026-11-24', stock_date: '2026-10-15' },
  { name: 'zero last month on month end quiet', data: data(item('Z0', { monthly_sales: [930, 900, 930, 930, 900, 0] })), today: '2026-11-24', stock_date: '2026-10-31' },
  { name: 'zero stock', data: data(item('Z', { on_hand: 0 })), today: '2026-11-24', stock_date: '2026-11-10' },
  { name: 'receipt before count warns', data: data(item('R', { receipts: { '2026-11': 100 } })), today: '2026-11-24', stock_date: '2026-11-24' },
  { name: 'lots unchanged with warning', data: data(item('T', { lots: [{ qty: 3000, expiry: '2027-12-31' }] })), today: '2026-11-24', stock_date: '2026-11-24' },
  { name: 'held item unchanged', data: data(item('H', { monthly_sales: [null, null, null, null, null, null] })), today: '2026-11-24', stock_date: '2026-11-24' },
  { name: 'mixed items', data: data(item('A'), item('S', { monthly_sales: seasonal, on_hand: 50 }), item('B', { on_hand: 9000, supplier_days: 60 })), today: '2026-11-24', stock_date: '2026-11-20' },
  { name: 'refuse before last month', data: data(item('A')), today: '2026-11-24', stock_date: '2026-09-30' },
  { name: 'refuse after today', data: data(item('A')), today: '2026-11-24', stock_date: '2026-11-25' },
  { name: 'refuse impossible date', data: data(item('A')), today: '2026-11-24', stock_date: '2026-02-30' },
]

const python = spawnSync(process.env.PYTHON || 'python3', [new URL('./stock_date_bridge.py', import.meta.url).pathname], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
test('python stock date bridge runs', () => assert.equal(python.status, 0, python.stderr))
const expected = python.status === 0 ? JSON.parse(python.stdout) : []
cases.forEach((c, index) => test(`stock date parity: ${c.name}`, () => assert.deepEqual(js(c), expected[index])))

test('regression: 30 a day, 3000 counted on 24 Nov lasts ~100 days from the count', () => {
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000
  const before = js(cases[0]).items[0], after = js(cases[2]).items[0]
  assert.ok(days('2026-11-24', after.guidance.runout_date) >= 95 && days('2026-11-24', after.guidance.runout_date) <= 105, after.guidance.runout_date)
  assert.ok(days('2026-10-31', before.guidance.runout_date) >= 95 && days('2026-10-31', before.guidance.runout_date) <= 105, before.guidance.runout_date)
  assert.ok(after.guidance.quantity < before.guidance.quantity)
  assert.ok(after.guidance.order_by > before.guidance.order_by)
  assert.equal(after.counted_on_hand, 3000)
})

test('no stock date leaves data untouched and count on as_of is a no-op', () => {
  assert.deepEqual(js(cases[3]).items[0].guidance, js({ ...cases[3], stock_date: undefined }).items[0].guidance)
  assert.match(js(cases[0]).notice, /assumed counted on 2026-10-31/)
  assert.equal(js(cases[1]).notice, null)
})

test('count date is never a saved setting (rejected like Python)', () => {
  assert.throws(() => h.validateOrderSettings({ stock_counted_on: '2026-11-24' }), /Invalid setting: stock_counted_on/)
  assert.equal(h.normalizeOrderSettings({ stock_counted_on: '2026-11-24' }).stock_counted_on, undefined)
})

test('zero last-month sales with a count inside the month warns, stock not reduced', () => {
  const row = js(cases.find(c => c.name === 'zero last month inside count warns')).items[0]
  assert.equal(row.stock_date_adjustment, 0)
  assert.equal(row.on_hand, 3000)
  assert.ok(row.input_warnings.includes(h.STOCK_DATE_ZERO_SALES_WARNING))
})
