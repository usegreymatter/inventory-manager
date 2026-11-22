// Lifecycle: living. Offline, dependency-free fixture intent and Python/JS parity.
// Run: TMPDIR=$PWD/.scratch node --test tests/smart-import.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = path.join(root, 'tests/fixtures/smart-import')
const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json'), 'utf8'))
const plugin = fs.readFileSync(path.join(root, 'desktop/plugin.js'), 'utf8')
const moduleSource = fs.readFileSync(path.join(root, 'desktop/smart-import.js'), 'utf8')
const core = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'))
const vocabulary = JSON.parse(fs.readFileSync(path.join(root, 'smart-import-vocabulary.json'), 'utf8'))
// Read production literals, not a hand-maintained approximation of ERP vocabulary.
const aliasLiteral = plugin.match(/(?:export\s+)?const ERP_ALIASES\s*=\s*(\{[^\n]+\})/)
assert.ok(aliasLiteral, 'production ERP_ALIASES JSON literal exists')
// Import-only metadata may extend the literal in the generated workbook span.
const aliasContext=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa})
vm.runInContext(plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.resolvedAliases=ERP_ALIASES',aliasContext)
const erpAliases = JSON.parse(JSON.stringify(aliasContext.resolvedAliases))
const typeLiteral = plugin.match(/const PRODUCT_TYPE_ALIASES\s*=\s*(\[[^\n]+\])/)
assert.ok(typeLiteral, 'production PRODUCT_TYPE_ALIASES literal exists')
const typeAliases = JSON.parse(JSON.stringify(vm.runInNewContext(typeLiteral[1], {}, { timeout: 1000 })))
const aliases = Object.fromEntries(Object.entries(erpAliases).map(([field, labels]) => [field, [...labels, ...(vocabulary[field] || [])]]))
const understand = (sheets, overrides = null) => core.understandWorkbook(sheets, null, overrides, aliases, typeAliases)

const pythonHelper = String.raw`
import importlib, json, pathlib, sys, types
root = pathlib.Path.cwd()
package = types.ModuleType('stock_runway')
package.__path__ = [str(root)]
sys.modules['stock_runway'] = package
core = importlib.import_module('stock_runway.smart_import')
from stock_runway.sources import ERP_ALIASES
from stock_runway.csv_import import PRODUCT_TYPE_ALIASES
vocabulary = json.loads((root/'smart-import-vocabulary.json').read_text())
aliases = {field: [*labels, *vocabulary.get(field, [])] for field, labels in ERP_ALIASES.items()}
results = []
for request in json.load(sys.stdin):
    sheets = core.read_workbook(root/'tests/fixtures/smart-import'/request['filename'])
    report = core.understand_workbook(sheets, None, request.get('overrides'))
    results.append({'sheets': sheets, 'report': report})
print(json.dumps({'aliases': aliases, 'typeAliases': PRODUCT_TYPE_ALIASES, 'results': results}, ensure_ascii=False))
`
function python(requests) {
  const run = spawnSync(process.env.SMART_IMPORT_PYTHON || '/usr/bin/python3', ['-c', pythonHelper], {
    cwd: root, input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: 60000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', TMPDIR: path.join(root, '.scratch') },
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, 'Python workbook understanding failed: ' + run.stderr)
  const result = JSON.parse(run.stdout)
  assert.deepEqual(aliases, result.aliases, 'production Python/JS aliases including shared vocabulary')
  assert.deepEqual(typeAliases, result.typeAliases, 'production Python/JS type aliases')
  assert.equal(result.results.length, requests.length, 'Python returned every requested report')
  return result.results
}
const baseline = python(manifest.fixtures.map(({ filename }) => ({ filename })))
const matrix = await Promise.all(manifest.fixtures.map(async (fixture, index) => {
  const file = path.join(fixtures, fixture.filename)
  const bytes = fs.readFileSync(file)
  const sheets = await core.readWorkbook(bytes, fixture.filename)
  return { fixture, bytes, sheets, report: understand(sheets), python: baseline[index],
    expected: JSON.parse(fs.readFileSync(path.join(fixtures, fixture.expected_file), 'utf8')) }
}))

function expectedLayout(mapping) {
  if (mapping.fields.date && mapping.fields.quantity) return 'long'
  return mapping.monthly_sales?.length ? 'wide' : 'products'
}
function assertIntent(entry) {
  const { fixture, expected, report } = entry
  assert.equal(expected.fixture, fixture.filename)
  assert.equal(expected.expected_product_count, fixture.expected_product_count)
  assert.equal(expected.expected_layout, fixture.expected_layout)
  assert.equal(report.canonical_rows.length - 1, fixture.expected_product_count, 'independent product count')
  // Fixture intent calls a CSV's sole logical sheet "CSV"; readers use its
  // filename stem because CSV has no worksheet-name metadata.
  const mappings = expected.mappings.map(mapping => ({ ...mapping,
    sheet: fixture.filename.endsWith('.csv') && mapping.sheet === 'CSV' ? path.parse(fixture.filename).name : mapping.sheet }))
  const base = mappings.find(mapping => mapping.sheet === report.sheet_used)
  assert.ok(base, 'selected sheet occurs in independent intended mappings')
  assert.equal(report.header_row, base.header_row, 'physical header row')
  assert.equal(report.layout, expectedLayout(base), 'base-sheet layout, not manifest scenario label')
  for (const mapping of mappings) {
    const actual = report.sheets.find(sheet => sheet.name === mapping.sheet)
    assert.ok(actual, 'every expected worksheet is understood')
    assert.equal(actual.header_row, mapping.header_row, mapping.sheet + ' physical header row')
    assert.deepEqual(actual.mapping.map(column => column.source), mapping.headers, mapping.sheet + ' header cells')
    for (const [field, source] of Object.entries(mapping.fields)) {
      // Transaction IDs are intentionally not an inventory canonical field.
      if (field === 'transaction_id') continue
      const column = actual.mapping.find(column => column.source === source.header)
      assert.equal(column?.field, field, mapping.sheet + ': ' + source.header)
    }
    for (const month of mapping.monthly_sales || []) {
      assert.equal(actual.mapping.find(column => column.source === month.header)?.field, month.month)
    }
  }
  if (expected.expected_scenario === null) {
    assert.ok(report.missing.includes('Product code (SKU)'), 'no SKU blocks import, never invents identifiers')
    assert.equal(report.canonical_rows.length, 1)
    return
  }
  assert.deepEqual(report.missing, [], 'usable input needs no manual mapping (including Arabic)')
  const { items, months } = expected.expected_scenario
  const header = report.canonical_rows[0]
  assert.deepEqual(header.filter(column => /^\d{4}-\d{2}$/.test(column)), months)
  const actual = new Map(report.canonical_rows.slice(1).map(row => [row[0], Object.fromEntries(header.map((field, index) => [field, row[index]]))]))
  assert.equal(actual.size, items.length, 'no duplicate canonical products')
  assert.deepEqual([...actual.keys()].sort(), items.map(item => item.sku).sort(), 'exact SKU universe')
  for (const item of items) {
    const row = actual.get(item.sku)
    for (const field of ['sku', 'name', 'unit', 'supplier']) {
      if (Object.hasOwn(item, field)) assert.equal(row[field], item[field], item.sku + ' ' + field)
    }
    for (const field of ['on_hand', 'supplier_days', 'on_order', 'unit_cost']) {
      if (Object.hasOwn(item, field)) {
        assert.notEqual(row[field], '', 'no fabricated numeric zero')
        assert.equal(Number(row[field]), item[field], item.sku + ' ' + field)
      }
    }
    assert.deepEqual(months.map(month => Number(row[month])), item.monthly_sales, item.sku + ' independent fulfilled sales')
  }
  if (expected.unmatched_skus) {
    const unmatched = new Set(Object.values(expected.unmatched_skus).flat())
    assert.equal(report.match_report.unmatched, unmatched.size, 'unmatched related SKU count')
    for (const sku of unmatched) assert.ok(!actual.has(sku), 'unmatched related SKU not fabricated as a product')
  }
}

test('fixture manifest is the complete 15-file synthetic contract', () => {
  assert.equal(manifest.fixture_count, 15)
  assert.equal(manifest.fixtures.length, manifest.fixture_count)
  assert.equal(new Set(manifest.fixtures.map(fixture => fixture.filename)).size, 15)
  assert.equal(matrix.length, 15)
})
for (const entry of matrix) {
  test(entry.fixture.filename + ': exact reader/report/canonical_rows parity and independent intent', () => {
    assert.equal(createHash('sha256').update(entry.bytes).digest('hex'), entry.fixture.sha256, 'fixture bytes match manifest')
    assert.deepEqual(entry.sheets, entry.python.sheets, 'independent byte readers agree exactly')
    assert.deepEqual(entry.report.canonical_rows, entry.python.report.canonical_rows, 'canonical rows agree exactly')
    assert.deepEqual(entry.report, entry.python.report, 'whole understanding report agrees exactly')
    assertIntent(entry)
  })
}

test('redundant confirmed mappings cannot move the physical header or alter canonical rows', () => {
  const requests = matrix.map(({ fixture, report }) => ({ filename: fixture.filename,
    overrides: Object.fromEntries(report.sheets.flatMap(sheet => sheet.mapping.filter(column => column.field).map(column => [sheet.name + ':' + column.index, column.field]))) }))
  const confirmedPython = python(requests)
  for (const [index, entry] of matrix.entries()) {
    const confirmed = understand(entry.sheets, requests[index].overrides)
    assert.equal(confirmed.header_row, entry.report.header_row, entry.fixture.filename + ' selected header invariant')
    assert.deepEqual(confirmed.sheets.map(sheet => [sheet.name, sheet.header_row]), entry.report.sheets.map(sheet => [sheet.name, sheet.header_row]), entry.fixture.filename + ' all-sheet header invariant')
    assert.deepEqual(confirmed.canonical_rows, entry.report.canonical_rows, entry.fixture.filename + ' redundant mapping preserves all canonical values')
    assert.deepEqual(confirmed, confirmedPython[index].report, entry.fixture.filename + ' confirmed report parity')
  }
})

test('QOH is reviewable; explicitly ignoring stock blocks and restoring it recovers', () => {
  const entry = matrix.find(entry => entry.fixture.filename === 'fuzzy_qoh.xlsx')
  assert.ok(entry)
  const column = entry.report.mapping.find(column => column.source === 'QOH')
  assert.equal(column?.field, 'on_hand')
  assert.ok(['low', 'medium'].includes(column.confidence))
  const key = entry.report.sheet_used + ':' + column.index
  const ignored = understand(entry.sheets, { [key]: '' })
  assert.equal(ignored.header_row, entry.report.header_row)
  assert.ok(ignored.missing.includes('On-hand stock'))
  const restored = understand(entry.sheets, { [key]: 'on_hand' })
  assert.deepEqual(restored.missing, [])
  assert.deepEqual(restored.canonical_rows, entry.report.canonical_rows)
  const py = python([{ filename: entry.fixture.filename, overrides: { [key]: '' } }, { filename: entry.fixture.filename, overrides: { [key]: 'on_hand' } }])
  assert.deepEqual(ignored, py[0].report)
  assert.deepEqual(restored, py[1].report)
})

test('synthetic fixture generator is deterministic and read-only under --check', () => {
  const run = spawnSync(process.env.SMART_IMPORT_PYTHON || '/usr/bin/python3', ['scripts/generate_smart_import_fixtures.py', '--check'], {
    cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', TMPDIR: path.join(root, '.scratch') },
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stderr || run.stdout)
  assert.match(run.stdout, /verified/)
})

test('embedded plugin smart-import helper, when integrated, is the exact module mirror', async t => {
  // The standalone builder embeds this same production helper. Avoid importing
  // React/desktop SDK dependencies in the dependency-free acceptance lane.
  const pure = plugin.slice(plugin.indexOf('const SAMPLE ='), plugin.indexOf('const pageStyle ='))
  const helperName = ['understandStockWorkbook', 'smartUnderstandWorkbook'].find(name => new RegExp('(?:export\\s+)?function\\s+' + name + '\\s*\\(').test(pure))
  if (!helperName) return t.skip('plugin smart-import mirror is not integrated yet')
  const context = vm.createContext({ TextEncoder, TextDecoder, atob, btoa, Blob, DecompressionStream, Uint8Array, ArrayBuffer })
  const readerName = /(?:export\s+)?async function readSmartWorkbook\s*\(/.test(pure) ? 'readSmartWorkbook' : null
  vm.runInContext(pure.replaceAll('export ', '') + '\nglobalThis.smartImportQAHelper = ' + helperName + '; globalThis.smartImportQAReader = ' + (readerName || 'null'), context, { timeout: 5000 })
  for (const { fixture, bytes, sheets, report } of matrix) {
    const mirrored = context.smartImportQAHelper(sheets, null, null, aliases, typeAliases)
    assert.deepEqual(JSON.parse(JSON.stringify(mirrored)), report, fixture.filename + ' embedded/module exact report parity')
    if (readerName) {
      const mirroredSheets = await context.smartImportQAReader({ name: fixture.filename, size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
      assert.deepEqual(JSON.parse(JSON.stringify(mirroredSheets)), sheets, fixture.filename + ' embedded/module exact byte-reader parity')
    }
  }
})
