// Isolated, SDK-free execution of the real Desktop core, not a second formula.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'desktop/plugin.js'), 'utf8')
const context = vm.createContext({TextEncoder, TextDecoder, atob, btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle =')).replaceAll('export ', '') + '\nglobalThis.h = {calculate, orderGuidance, orderBucket}', context)
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const rows = input.cases.map(c => {
  const [item] = context.h.calculate([c.item], c.months, input.as_of, 6, c.settings || {}, input.today)
  const g = context.h.orderGuidance(item, input.today, c.settings || {}, input.as_of)
  return {order_qty:g.quantity ?? null, order_by:g.order_by ?? null,
    run_out:g.runout_date ?? null, status:context.h.orderBucket(item, input.today, c.settings || {}, input.as_of)}
})
process.stdout.write(JSON.stringify(rows))
