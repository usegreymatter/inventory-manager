import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const read = path => fs.readFileSync(new URL('../'+path, import.meta.url), 'utf8')
test('every emitted health code has exactly one compact A3 warning label', () => {
  const health = read('standalone/design/health.js'), python = read('health.py')
  const ctx = vm.createContext({})
  vm.runInContext(health+'\n'+read('standalone/design/strings-a3.js')+'\nthis.labels={health:HEALTH_LABELS,a3:STRINGS}',ctx)
  const healthCodes = Object.keys(ctx.labels.health).sort()
  // Parse the Python label vocabulary, including codes selected by conditional warn calls.
  const pythonLabels = python.match(/LABELS = \{([\s\S]*?)\n\}/)[1]
  const pythonCodes = [...pythonLabels.matchAll(/'([a-z_]+)'\s*:/g)].map(m=>m[1]).sort()
  const a3Codes = Object.keys(ctx.labels.a3).filter(k=>k.startsWith('warning_')).map(k=>k.slice(8)).sort()
  assert.deepEqual(healthCodes, pythonCodes)
  assert.deepEqual(a3Codes, healthCodes)
  assert.equal(ctx.labels.a3.warning_incoming_invalid, 'Check incoming orders')
  for (const code of healthCodes) {
    const label = ctx.labels.a3['warning_'+code]
    assert.ok(label.trim() && label.trim().split(/\s+/).length <= 3, code+': '+label)
  }
})
