// Offline parity runner for the real Desktop core and Python engine.
// Run after integrating detectStockoutMonths and stockout_adjust in plugin.js:
//   node scripts/stockout_parity.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {execFileSync} = require('node:child_process')
const root = path.resolve(__dirname, '..')
const python = process.env.PYTHON || '/usr/bin/python3'
const bridge = path.join(root, 'tests/stockout_advisory_bridge.py')
const options = {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout:120000}
const cases = JSON.parse(execFileSync(python, [bridge, '--corpus'], options))
const expectedRun = require('../tests/python-stdin.cjs')([bridge],JSON.stringify(cases),options)
assert.equal(expectedRun.status,0,expectedRun.error?.message||expectedRun.stderr)
const expected = JSON.parse(expectedRun.stdout)
const source = fs.readFileSync(path.join(root, 'desktop/plugin.js'), 'utf8')
const context = vm.createContext({TextEncoder, TextDecoder, atob, btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle =')).replaceAll('export ', '') +
  '\nglobalThis.h = {calculate, orderGuidance, detectStockoutMonths}', context)
const fields = ['status','quantity','monthly_demand','order_by','runout_date','safety_stock','reorder_point','reason']
const plain = value => JSON.parse(JSON.stringify(value))
let guidanceCases = 0
cases.forEach((c, index) => {
  const result = {detection: plain(context.h.detectStockoutMonths(c.item, c.as_of.slice(0,7)))}
  if (!c.detection_only) {
    guidanceCases++
    const [item] = context.h.calculate([c.item], c.months, c.as_of, 6, {}, c.today)
    for (const [key, enabled] of [['before',false], ['after',true]]) {
      const g = context.h.orderGuidance(item, c.today, {stockout_adjust:enabled}, c.as_of)
      result[key] = Object.fromEntries(fields.map(field => [field, g[field] ?? null]))
    }
  }
  assert.deepEqual(plain(result), expected[index], `advisory parity case ${index}: ${c.item.sku}`)
})
assert.equal(cases.length, expected.length)
console.log(JSON.stringify({cases:cases.length, guidance_cases:guidanceCases, detection_only:cases.length-guidanceCases, result:'pass'}))
