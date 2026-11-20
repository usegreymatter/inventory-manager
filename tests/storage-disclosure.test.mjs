import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// Review-round 2: mapping rules omit rows, but Desktop saves the accepted parsed
// dataset in ctx.storage; do not imply that imported data is never saved.
test('both import reviews disclose device-local data without a false no-rows promise', () => {
  for (const file of ['desktop/plugin.js', 'standalone/design/smart-import.js']) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(source.includes('These answers are remembered for this file layout. Imported data stays on this device.'), file)
    assert.ok(!source.includes('No spreadsheet rows are saved.'), file)
  }
  const plugin = fs.readFileSync('desktop/plugin.js', 'utf8')
  assert.match(plugin, /ctx\.storage\.set\('csv_data',/)
  const standalone = fs.readFileSync('standalone/design/smart-import.js', 'utf8')
  assert.match(standalone, /localStorage\.setItem\(STORE,encoded\)/)
})
