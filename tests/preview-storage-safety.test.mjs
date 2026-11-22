import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const core = source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle =')).replaceAll('export ', '')
const persistence = source.slice(source.indexOf('// METHOD_PERSISTENCE_START'), source.indexOf('// METHOD_PERSISTENCE_END'))
const context = vm.createContext({ TextEncoder, TextDecoder, atob, btoa })
vm.runInContext(core + '\n' + persistence + '\nthis.api={previewIndustryPreset,normalizeOrderSettings,calculate,orderGuidance,withPreviousMethods,rememberMethods,lib:StockRunwayForecastMethods}', context)
const api = context.api
const plain = value => JSON.parse(JSON.stringify(value))
const settings = extra => plain(api.normalizeOrderSettings(extra))
const item = (sku, extra = {}) => ({sku, name: 'Synthetic', unit: 'ea', monthly_sales: [300, 300, 300], on_hand: 0, supplier_days: 14, receipts: {}, ...extra})
const data = items => ({items, months: ['2032-10', '2032-11', '2032-12'], as_of: '2032-12-31'})
const storageKey = 'stock-runway.recommended-picks.v1'
const memory = initial => {
  let value = JSON.stringify(initial)
  return {getItem: () => value, setItem: (_, next) => {value = next}, read: () => JSON.parse(value)}
}

test('remembered methods scrub corrupt records and reserved object keys without losing valid modes/seeds', () => {
  const record = {month: '2032-11', method: api.lib.RECOMMEND_CANDIDATES[0]}
  const stored = JSON.parse(JSON.stringify({
    VALID: {false: {...record, extra: 'drop', previous: {month: '2032-10', method: record.method}}, true: record, extra: 'drop'},
    UNKNOWN: {false: {month: '9998-01', method: 'bogus'}},
    BAD_MONTH: {false: {month: '9999-99', method: record.method}},
    BAD_PREVIOUS: {false: {...record, previous: {month: '2032-99', method: record.method}}},
    REVERSED_SEED: {false: {...record, previous: {month: '2032-12', method: record.method}}},
    ARRAY: [], STRING: 'corrupt', NULL: null,
  }))
  Object.defineProperty(stored, '__proto__', {enumerable: true, value: {false: record}})
  stored.constructor = {false: record}
  const storage = memory(stored)
  const catalog = data([item('VALID')])
  api.rememberMethods([], catalog, {forecast_method: 'recommended'}, storage)
  assert.deepEqual(storage.read(), {
    VALID: {false: {month: record.month, method: record.method, previous: {month: '2032-10', method: record.method}}, true: record},
    BAD_PREVIOUS: {false: record}, REVERSED_SEED: {false: record},
  })
  const result = sku => ({sku, forecast_method: {requested: 'recommended', method: record.method}})
  api.rememberMethods([result('UNKNOWN'), result('__proto__'), result('constructor')], catalog, {forecast_method: 'recommended'}, storage)
  assert.equal(storage.read().UNKNOWN.false.month, '2032-12', 'invalid future pick must not block a valid new pick')
  assert.equal(Object.hasOwn(storage.read(), '__proto__'), false)
  assert.equal(Object.hasOwn(storage.read(), 'constructor'), false)
})

test('loading remembered methods rejects reserved SKUs and malformed top-level or mode shapes', () => {
  const record = {month: '2032-11', method: api.lib.RECOMMEND_CANDIDATES[0]}
  const stored = JSON.parse('{"__proto__":{},"constructor":{},"VALID":{}}')
  for (const key of Object.keys(stored)) stored[key].false = record
  const catalog = data([item('__proto__'), item('constructor'), item('VALID')])
  const loaded = api.withPreviousMethods(catalog, {forecast_method: 'recommended'}, memory(stored))
  assert.equal(loaded.items[0]._method_model, undefined)
  assert.equal(loaded.items[1]._method_model, undefined)
  assert.equal(loaded.items[2]._method_model.recommend_input[0], record.month)
  for (const corrupt of [null, [], 'bad', {VALID: {false: {month: '2032-1', method: record.method}}}]) {
    assert.equal(api.withPreviousMethods(catalog, {forecast_method: 'recommended'}, memory(corrupt)).items[2]._method_model, undefined)
  }
})

test('Desktop preview receives the exact prepared Recommended dataset used by table evaluation', () => {
  let evaluated
  const element = (type, props) => ({type, props})
  const storage = memory({X: {false: {month: '2032-11', method: 'ses'}}})
  let memoCursor = 0, stateCursor = 0
  const memos = [], states = []
  const ui = vm.createContext({
    TextEncoder, TextDecoder, atob, btoa, localStorage: storage,
    Date: class extends Date {constructor(...args) {super(...(args.length ? args : ['2032-12-31T12:00:00']))}},
    Component: class {}, jsx: element, jsxs: element, useRef: () => ({current: null}),
    useState: initial => {
      const index = stateCursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], next => {states[index] = typeof next === 'function' ? next(states[index]) : next}]
    },
    useEffect: () => {}, useMemo: (callback, deps) => {
      const index = memoCursor++, previous = memos[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) memos[index] = {deps, value: callback()}
      return memos[index].value
    },
    ...Object.fromEntries(['Button', 'Badge', 'StatusDot', 'EmptyState', 'SegmentedControl', 'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem'].map(key => [key, key])),
    capture: value => {evaluated = value},
  })
  vm.runInContext(source.slice(source.indexOf('const SAMPLE ='), source.indexOf('export default')).replaceAll('export ', '') + `
    const originalEvaluateDataset=evaluateDataset;
    evaluateDataset=(...args)=>{capture(args[0]);return originalEvaluateDataset(...args)};
    this.api={Page,IndustryPresetControls,previewIndustryPreset,calculate,orderGuidance,forecastDiary};`, ui)
  // Fixed synthetic history whose selected method and order quantity depend on
  // the earlier SES seed (unseeded Recommended selects Current).
  const sales = [27,42,96,46,31,22,42,35,85,23,32,35,45,50,33,30,57,42,38,37,30,51,27,28,21,36,26,27,38,44,33,42,23,23,40,19]
  const catalog = data([item('X', {monthly_sales: sales})])
  catalog.months = Array.from({length: 36}, (_, i) => `${2030 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`)
  const current = settings({forecast_method: 'recommended', months_of_cover: .25})
  const diary = ui.api.forecastDiary({...catalog, as_of: '2032-11-30', months: catalog.months.slice(0, -1), items: [{...catalog.items[0], monthly_sales: sales.slice(0, -1)}]})
  assert.equal(diary.length, 1)
  const stored = {source: 'csv', csv_data: catalog, order_settings: current, forecast_diary: diary}
  const host = {storage: {get: (key, fallback) => key === 'forecast_diary' ? plain(stored[key]) : stored[key] ?? fallback, set: () => {}}}
  const render = () => {memoCursor = 0; stateCursor = 0; return ui.api.Page({ctx: host})}
  const tree = render()
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]
  const controls = nodes(tree).find(node => node.type === ui.api.IndustryPresetControls)
  assert.ok(controls)
  assert.ok(evaluated.items[0]._method_model, 'exercise a genuine remembered Recommended seed')
  assert.ok(evaluated.items[0]._learning_context, 'preserve real learning preparation too')
  assert.equal(controls.props.dataset, evaluated)
  assert.equal(nodes(render()).find(node => node.type === ui.api.IndustryPresetControls).props.dataset, controls.props.dataset, 'equivalent storage/learning reads keep the preview snapshot stable')
  const preview = ui.api.previewIndustryPreset(controls.props.settings, 'grocery', controls.props.dataset, '2032-12-31')
  const expectedTotal = config => ui.api.calculate(evaluated.items, evaluated.months, evaluated.as_of, 6, config, '2032-12-31')
    .reduce((total, row) => total + ui.api.orderGuidance({...row, as_of: evaluated.as_of}, '2032-12-31', config, evaluated.as_of, false).quantity, 0)
  assert.equal(preview.impact.before_quantity, expectedTotal(current))
  assert.equal(preview.impact.after_quantity, expectedTotal(preview.next))
  assert.notEqual(ui.api.previewIndustryPreset(current, 'grocery', catalog, '2032-12-31').impact.after_quantity, preview.impact.after_quantity, 'raw-data preview must demonstrably differ for this fixture')
  stored.forecast_diary = []
  const refreshed = nodes(render()).find(node => node.type === ui.api.IndustryPresetControls).props.dataset
  assert.notEqual(refreshed, controls.props.dataset, 'a real learning-input change invalidates the snapshot')
  assert.equal(refreshed, evaluated)

  // Render the real controls after Page with persistent hooks. A prepared
  // Recommended dataset changes with settings; that must not disable Undo.
  const renderControls = identity => {
    const page = render()
    const props = nodes(page).find(node => node.type === ui.api.IndustryPresetControls).props
    if (identity) props.datasetIdentity = identity
    return {props, tree: ui.api.IndustryPresetControls(props)}
  }
  const find = (tree, predicate) => nodes(tree).find(predicate)
  let controlsView = renderControls()
  const beforeApply = plain(controlsView.props.settings)
  find(controlsView.tree, node => node.props?.['data-setting-preset'] === 'grocery').props.onClick()
  controlsView = renderControls()
  const confirm = find(controlsView.tree, node => node.props?.id === 'confirm-setting-preset')
  assert.equal(confirm.props.disabled, false)
  confirm.props.onClick()
  controlsView = renderControls()
  const undo = find(controlsView.tree, node => node.props?.id === 'undo-setting-preset')
  assert.equal(undo.props.disabled, false, 'changing prepared data through preset apply must not invalidate undo')
  const replaced = renderControls({...catalog})
  assert.equal(find(replaced.tree, node => node.props?.id === 'undo-setting-preset').props.disabled, true, 'a replaced raw dataset must still invalidate undo')
  undo.props.onClick()
  controlsView = renderControls()
  assert.deepEqual(plain(controlsView.props.settings), beforeApply)
})
