import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import nodeTest from 'node:test'

const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
// Keep core parity independent of where toolbar controls live. Real View-menu,
// search, filter-chip and column interactions are exercised in capture-clean/columns.cjs.
const outputs = ['baseline', 'shipped', 'option-a', 'option-b', 'option-a2', 'option-a3'].map(name => ({
  name,
  html: fs.readFileSync(new URL(`../standalone/${name === 'shipped' ? 'inventory-manager' : `design/${name}`}.html`, import.meta.url), 'utf8'),
}))
const block = (html, name) => {
  const start = `/* STOCK_RUNWAY_${name}_START */\n`, end = `/* STOCK_RUNWAY_${name}_END */`
  assert.equal(html.split(start).length, 2, `one ${name} start anchor`)
  assert.equal(html.split(end).length, 2, `one ${name} end anchor`)
  return html.split(start)[1].split(end)[0]
}
const expectedCore = source.split("import { jsx, jsxs } from 'react/jsx-runtime'\n")[1].split('const pageStyle =')[0]
const baselineHelpers = block(outputs[0].html, 'HELPERS')
for (const name of ['standaloneRows', 'attentionRows', 'purchaseOrderText']) assert.ok(baselineHelpers.includes(`function ${name}(`))
// Same SDK-free VM shim as desktop.test.mjs. Both sides are evaluated independently.
const load = code => {
  const ctx = vm.createContext({ TextEncoder, TextDecoder, atob, btoa })
  vm.runInContext(code.replace(/^export \{[^\n]*\}\s*$/gm, '').replaceAll('export ', '') + '\nglobalThis.api = { SAMPLE, evaluateDataset, parseCsv, sortRows, orderGuidance, orderBucket, orderSentence, normalizeOrderSettings, DEFAULT_ORDER_SETTINGS, desktopOrderList: typeof desktopOrderList === "function" ? desktopOrderList : null, standaloneRows: typeof standaloneRows === "function" ? standaloneRows : null, attentionRows: typeof attentionRows === "function" ? attentionRows : null, purchaseOrderText: typeof purchaseOrderText === "function" ? purchaseOrderText : null }', ctx)
  return ctx.api
}
const desktopListSource = source.slice(source.indexOf('  const orderList = orderRows.filter'), source.indexOf('  const hasPlanningHistory ='))
const plugin = load(source.slice(source.indexOf('const SAMPLE ='), source.indexOf('const pageStyle ='))
  + '\nfunction desktopOrderList(orderRows, today, orderSettings, data) { const showSkipped = false;\n' + desktopListSource + '\nreturn orderList; }')
for (const { name: design, html } of outputs) {
const test = (name, fn) => nodeTest(`${design}: ${name}`, fn)
const embedded = block(html, 'CORE'), helpers = block(html, 'HELPERS')
test('exact unmodified plugin core and baseline helpers including PO builder', () => {
  assert.equal(embedded, expectedCore)
  assert.equal(helpers, baselineHelpers)
  const offline = html.replace('<a class="version-link" href="https://github.com/usegreymatter/inventory-manager/releases" target="_blank" rel="noopener noreferrer">Check for a newer version</a>', "") // Exact click-only navigation, never a dependency.
  assert.doesNotMatch(offline, /(?:src|href)\s*=\s*['"]\s*(?:https?:)?\/\//i)
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/)
})
const standalone = load(embedded + '\n' + helpers)
const plain = value => JSON.parse(JSON.stringify(value))
const today = '2026-11-11'
const settingsMatrix = [standalone.DEFAULT_ORDER_SETTINGS,
  { default_delivery_days: null, months_of_cover: 0, service_level: 0.9 },
  { default_delivery_days: 30, months_of_cover: 3.5, service_level: 0.99, include_backup_in_orders: true }]
const fixtures = ['sample', ...fs.readdirSync(new URL('../docs/erp-examples/', import.meta.url)).filter(f => f.endsWith('.csv')).sort()]
assert.equal(fixtures.length, 9, 'sample plus all eight ERP examples')

for (const name of fixtures) test(`generated core matches plugin guidance and buckets: ${name}`, () => {
  const csv = name === 'sample' ? null : fs.readFileSync(new URL(`../docs/erp-examples/${name}`, import.meta.url), 'utf8')
  const a = csv ? standalone.parseCsv(csv) : standalone.SAMPLE
  const b = csv ? plugin.parseCsv(csv) : plugin.SAMPLE
  assert.deepEqual(plain(a), plain(b))
  for (const raw of settingsMatrix) {
    const settings = standalone.normalizeOrderSettings(raw)
    const left = standalone.sortRows(standalone.evaluateDataset(a, 6, settings))
    const right = plugin.sortRows(plugin.evaluateDataset(b, 6, settings))
    assert.ok(left.length > 0)
    assert.deepEqual(plain(left), plain(right))
    for (let i = 0; i < left.length; i++) {
      assert.deepEqual(plain(standalone.orderGuidance(left[i], today, settings, a.as_of)), plain(plugin.orderGuidance(right[i], today, settings, b.as_of)))
      assert.equal(standalone.orderBucket(left[i], today, settings, a.as_of), plugin.orderBucket(right[i], today, settings, b.as_of))
    }
    const rows = standalone.standaloneRows(a, today, settings)
    assert.deepEqual(plain(standalone.attentionRows(rows)), plain(plugin.desktopOrderList(rows, today, settings, a)), 'exact Desktop order-list membership and sorting')
    assert.deepEqual(plain(rows.map(r => r.item)), plain(left))
    for (const row of rows) {
      assert.deepEqual(plain(row.guidance), plain(plugin.orderGuidance(row.item, today, settings, a.as_of)))
      assert.equal(row.bucket, plugin.orderBucket(row.item, today, settings, a.as_of))
    }
  }
})

test('synthetic incoming, out-of-stock, zero-purchase gap, held and rounding cases match Desktop', () => {
  const data = { as_of:'2026-10-31', months:['2026-08','2026-09','2026-10'], items:[] }
  const item = (sku, extra) => ({ sku, name:sku, unit:'l', on_hand:20, supplier_days:14, monthly_sales:[30,30,30], receipts:{}, ...extra })
  data.items = [item('ZERO',{on_hand:0}), item('GAP',{on_hand:0,receipts:{'2026-12':1000}}), item('COVERED',{on_hand:30,on_order:100}),
    item('PACK',{on_hand:0.7}), item('HELD',{on_hand:-1}), item('NO-SALES',{monthly_sales:[0,0,0]}),
    item('RECEIPT',{on_hand:1,receipts:{'2026-12':100}})]
  const settings = standalone.normalizeOrderSettings({ ...standalone.DEFAULT_ORDER_SETTINGS, product_overrides:{ PACK:{pack_size:0.125, minimum_order:0.375} } })
  const rows = standalone.standaloneRows(data,today,settings)
  for (const row of rows) {
    assert.deepEqual(plain(row.guidance), plain(plugin.orderGuidance(row.item,today,settings,data.as_of)))
    assert.equal(row.bucket, plugin.orderBucket(row.item,today,settings,data.as_of))
  }
  const get = sku => rows.find(row => row.item.sku === sku)
  assert.equal(get('ZERO').guidance.out_of_stock,true)
  // The large December receipt cannot suppress November's order decision (trigger unchanged)...
  assert.equal(get('GAP').bucket,'order')
  // ...but MRP netting (policy v2 review fix P1) counts it within the delivery+cover window:
  // on_hand 0, 30/month (~1/day), flat sales so SS 0; only the ~31 days of demand until the
  // 1 Dec receipt must be covered. Pre-netting rule ordered 84 (full window, receipt ignored).
  assert.equal(get('GAP').guidance.quantity,31)
  assert.equal(get('HELD').bucket,'needs-data')
  const attention = standalone.attentionRows(rows)
  assert.deepEqual(plain(attention), plain(plugin.desktopOrderList(rows,today,settings,data)))
  const po = standalone.purchaseOrderText(attention,today)
  assert.ok(po.includes('• GAP') && !po.includes('• HELD'))
  assert.ok(po.includes('• ZERO'))
})

test('PO format, positive order-today items only, exact quantities and units', () => {
  const row = (name, sku, unit, quantity, bucket = 'order') => ({ item: { name, sku, unit }, guidance: { quantity }, bucket })
  const text = standalone.purchaseOrderText([
    row('Cement', 'C-1', 'bags', 1200), row('Cable', 'W-2', 'm', 0.125),
    row('Incoming covers it', 'Z-1', 'pcs', 0), row('Later', 'L-1', 'l', 5, 'healthy'),
    row('Soon', 'S-1', 'boxes', 2, 'running-low'), row('Held', 'H-1', 'units', undefined, 'needs-data'),
  ], today)
  assert.equal(text, 'Purchase order · Inventory Manager\nDate: 2026-11-11\n\n• Cement (C-1) — 1,200 bags\n• Cable (W-2) — 0.125 m\n• Soon (S-1) — 2 boxes\n\n3 items\n\nOrders already on the way were not included — subtract them before ordering.')
})

test('PO empty case never implies an order or includes zero-quantity attention rows', () => {
  assert.equal(standalone.purchaseOrderText([], today), 'Purchase order · Inventory Manager\nDate: 2026-11-11\n\nNo items to order.\n\n0 items')
  assert.equal(standalone.purchaseOrderText([{ item: {}, guidance: { quantity: 0 }, bucket: 'order' }], today), standalone.purchaseOrderText([], today))
})

test('PO preserves fractional units, singular count and neutralizes embedded line breaks', () => {
  assert.equal(standalone.purchaseOrderText([{ item: { name: 'Oil\nRefill', sku: 'O\r1', unit: 'l' }, guidance: { quantity: 0.000001 }, bucket: 'running-low' }], today), 'Purchase order · Inventory Manager\nDate: 2026-11-11\n\n• Oil Refill (O 1) — 0.000001 l\n\n1 item\n\nOrders already on the way were not included — subtract them before ordering.')
})
}

for (const {name, html} of outputs.filter(o => o.name !== 'baseline')) {
  nodeTest(`${name}: chart series display exact core history, projection, crossings and planning thresholds`, () => {
    const ctx = vm.createContext({TextEncoder, TextDecoder, atob, btoa})
    const copy = ['option-a3','shipped'].includes(name) ? fs.readFileSync(new URL('../standalone/design/strings-a3.js', import.meta.url), 'utf8') : ''
    const code = copy + '\n' + block(html, 'CORE').replaceAll('export ', '') + block(html, 'HELPERS')
      + '\nlet data = SAMPLE; const currentToday = "2026-11-11";\n' + block(html, 'CHART_DATA')
      + '\nglobalThis.api = {setData: next => {data = next}, SAMPLE, chartData, inventoryHistory, stockPath, standaloneRows, DEFAULT_ORDER_SETTINGS};'
    vm.runInContext(code, ctx)
    const api = ctx.api, plain = v => JSON.parse(JSON.stringify(v))
    const csvApi = load(block(html, 'CORE'))
    const csvs = fs.readdirSync(new URL('../docs/erp-examples/', import.meta.url)).filter(f => f.endsWith('.csv'))
    const synthetic = {as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:[
      {sku:'FRACTION',name:'Oil',unit:'l',on_hand:.7,supplier_days:14,monthly_sales:[30,30,30],receipts:{}},
      {sku:'ZERO',name:'Empty',unit:'l',on_hand:0,supplier_days:14,on_order:1000,monthly_sales:[30,30,30],receipts:{}},
      {sku:'HELD',name:'Check',unit:'units',on_hand:-1,supplier_days:14,monthly_sales:[30,30,30],receipts:{}},
    ]}
    const datasets = [api.SAMPLE, synthetic, ...csvs.map(f => csvApi.parseCsv(fs.readFileSync(new URL(`../docs/erp-examples/${f}`, import.meta.url), 'utf8')))]
    for (const dataset of datasets) {
      api.setData(dataset)
      for (const row of api.standaloneRows(dataset, '2026-11-11', api.DEFAULT_ORDER_SETTINGS)) {
        const series = api.chartData(row), item = row.item
        if (item.held || row.guidance.status === 'needs-data') { assert.equal(series, null); continue }
        assert.deepEqual(plain(series.crossing), plain(api.stockPath(item).crossing))
        assert.equal(series.threshold, row.guidance.reorder_point ?? row.guidance.safety_stock)
        const history = api.inventoryHistory(item, dataset.months)
        assert.deepEqual(plain(series.past.map(p => p.stock)), plain(history.rows.length ? history.rows.map(r => r.stock) : item.monthly_sales))
        assert.ok(series.past.every(p => p.kind === (history.rows.length ? 'Past stock' : 'Past sales')))
        assert.equal(series.future[0].t, dataset.months.length)
        assert.equal(series.future[0].stock, item.stock, 'no invented half-month from history to rounded forecast')
        for (const [index, projection] of item.projection.entries()) {
          assert.equal(series.future.find(p => p.t === dataset.months.length + index + 1)?.stock, Math.max(0, projection.stock))
        }
        assert.ok([...series.past, ...series.future].every(p => Number.isFinite(p.stock) && p.stock >= 0))
        assert.ok(series.max >= Math.max(...series.past.map(p => p.stock), ...series.future.map(p => p.stock)))
      }
    }
  })
}

nodeTest('option-a3: A2 computed series reused verbatim and operational controls retained', () => {
  const a2=outputs.find(o=>o.name==='option-a2').html,a3=outputs.find(o=>o.name==='option-a3').html
  assert.equal(block(a3,'A2_SERIES'),block(a2,'A2_SERIES'))
  for(const id of ['settings','csv-file','sample','dropzone','source-status','file-error','copy-po','copy-status','copy-fallback','po-text','delivery-days','cover-months','service-level','reset-settings']) {
    assert.equal([...a3.matchAll(new RegExp(`\\bid=["']${id}["']`,'g'))].length,1,id)
  }
  assert.match(a3,/<meta name="color-scheme" content="light">/)
  assert.doesNotMatch(a3,/prefers-color-scheme/)
})

// Logic-only DOM adapter. This checks application wiring; it is not browser,
// layout, gesture, screenshot or performance evidence.
function a3Application({hash='',dataset=null}={}) {
  const html=outputs.find(o=>o.name==='option-a3').html
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.events={};this.value='';this.style={};this.className='';this.parentElement=null;this.hidden=false;this.classList={add(){},remove(){}}}
    setAttribute(k,v){this.attrs[k]=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v)}
    getAttribute(k){return this.attrs[k]??null} hasAttribute(k){return Object.hasOwn(this.attrs,k)||(k.startsWith('data-')&&Object.hasOwn(this.dataset,k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())))} removeAttribute(k){delete this.attrs[k]}
    append(...xs){for(const x of xs){if(x.parentElement)x.parentElement.children=x.parentElement.children.filter(c=>c!==x);this.children.push(x);x.parentElement=this}}
    prepend(...xs){this.append(...xs);this.children=[...xs,...this.children.filter(c=>!xs.includes(c))]}
    // The Smart import status keeps a comment anchor while moving its status node.
    before(...xs){if(this.parentElement)this.parentElement.prepend(...xs)}
    after(...xs){if(this.parentElement)this.parentElement.append(...xs)}
    replaceChildren(...xs){for(const x of this.children)x.parentElement=null;this.children=[];this.append(...xs)}
    addEventListener(k,fn){(this.events[k]??=[]).push(fn)}
    matches(s){if(s.startsWith('#'))return this.id===s.slice(1);if(s.startsWith('.'))return this.className.split(' ').includes(s.slice(1));const m=s.match(/^(\w+)?(?:\[([^\]]+)\])?$/);return !!m&&(!m[1]||this.tagName===m[1].toUpperCase())&&(!m[2]||this.hasAttribute(m[2]))}
    querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)])}
    querySelector(s){return this.querySelectorAll(s)[0]||null}
    closest(s){return s.split(',').some(q=>this.matches(q))?this:this.parentElement?.closest(s)||null}
    getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:780,height:400,right:780,bottom:400}}
    getClientRects(){return [this.getBoundingClientRect()]}
    get isConnected(){return this===body||!!this.parentElement?.isConnected}
    scrollIntoView(){} setPointerCapture(){} focus(){} select(){}
  }
  const body=new Element('body'),ids=new Map()
  for(const match of html.matchAll(/\bid="([^"]+)"/g)){const e=new Element();e.id=match[1];ids.set(e.id,e);body.append(e)}
  for(const id of ['why-dialog','health-dialog'])ids.get(id).append(Object.assign(new Element('button'),{className:'sheet-close'}))
  const doc={body,hidden:false,querySelector:s=>body.querySelector(s),createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),createDocumentFragment:()=>new Element(),createComment:()=>new Element('comment'),getElementById:id=>ids.get(id),events:{},addEventListener(k,fn){(this.events[k]??=[]).push(fn)}}
  const win={events:{},addEventListener(k,fn){(this.events[k]??=[]).push(fn)}}
  const location={hash},history={replaceState(_,__,url){location.hash=url}}
  const NativeDate=Date
  class FixedDate extends NativeDate {constructor(...a){super(...(a.length?a:['2026-11-12T09:00:00Z']))}}
  const ctx=vm.createContext({document:doc,window:win,location,history,Date:FixedDate,URLSearchParams,TextEncoder,TextDecoder,atob,btoa,performance,localStorage:{getItem(){return null},setItem(){}},matchMedia:()=>({matches:false}),ResizeObserver:class{observe(){}disconnect(){}},navigator:{}})
  let code=html.split('<script type="module" id="runway-app">')[1].split('</script>')[0].replaceAll('export ','')
  if(dataset)code=code.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(dataset))
  vm.runInContext(code,ctx)
  function dispatch(el,type,props={}){const event={target:el,button:0,clientX:300,clientY:100,pointerId:1,preventDefault(){},stopPropagation(){},...props};for(const fn of el.events[type]||[])fn(event)}
  const api={get:id=>ids.get(id),body,doc,win,dispatch,location,run:s=>vm.runInContext(s,ctx),key:key=>dispatch(doc,'keydown',{target:body,key}),input:value=>{ids.get('search').value=value;dispatch(ids.get('search'),'input')},hash:sku=>{location.hash='#sku='+encodeURIComponent(sku);dispatch(win,'hashchange')},selected:()=>body.dataset.selectedSku,buttons:()=>body.querySelectorAll('button[data-sku]')}
  return api
}
nodeTest('option-a3: application keys, chevrons, hash startup and stable sidebar DOM',()=>{
  const a=a3Application(),initial=a.selected(),firstButton=a.buttons()[0]
  a.key('ArrowDown');assert.notEqual(a.selected(),initial)
  a.key('ArrowUp');assert.equal(a.selected(),initial)
  a.key('j');const second=a.selected();a.key('k');assert.equal(a.selected(),initial)
  assert.equal(a.buttons()[0],firstButton,'selection retains sidebar node identity')
  assert.equal(a.run('chartObservers.size'),1,'detached chart observers are disconnected')
  assert.equal(a.run('seriesFor(rowMap.get(selectedSku).item)===seriesFor(rowMap.get(selectedSku).item)'),true,'selected item series cache is reused')
  a.dispatch(a.get('next-sku'),'click');assert.equal(a.selected(),second)
  a.dispatch(a.get('prev-sku'),'click');assert.equal(a.selected(),initial)
  a.hash(second);assert.equal(a.selected(),second)
  assert.equal(a3Application({hash:'#sku='+encodeURIComponent(second)}).selected(),second)
  a.hash('unknown-sku');assert.equal(a.selected(),second,'unknown hash does not replace last chart')
})
nodeTest('option-a3: filtered navigation boundaries, no matches and input keys',()=>{
  const a=a3Application();a.input('silicone');assert.equal(a.buttons().length,2)
  a.dispatch(a.get('next-sku'),'click');const last=a.selected();assert.equal(a.get('next-sku').disabled,true)
  a.key('j');assert.equal(a.selected(),last)
  a.input('no such synthetic item');assert.equal(a.buttons().length,0);assert.equal(a.selected(),last)
  assert.equal(a.get('next-sku').disabled,true);assert.equal(a.get('prev-sku').disabled,true)
  a.input('');assert.equal(a.selected(),last)
  a.dispatch(a.doc,'keydown',{target:Object.assign(a.get('search'),{tagName:'INPUT'}),key:'ArrowDown'});assert.equal(a.selected(),last)
  a.input('silicone');a.hash('TRM-ALU-25');assert.equal(a.selected(),'TRM-ALU-25');assert.equal(a.get('search').value,'');assert.equal(a.buttons().length,5)
})
nodeTest('option-a3: 500-item logical browsing, needs-data and hostile names remain text',()=>{
  const sample=load(block(outputs[0].html,'CORE')).SAMPLE
  const dataset=JSON.parse(JSON.stringify(sample));dataset.items=Array.from({length:500},(_,i)=>({...dataset.items[i%5],sku:`SYN-${i}`,name:i===499?'<img onerror=alert(1)>':'Synthetic '+i}))
  dataset.items[498].on_hand=-1
  const a=a3Application({dataset});assert.equal(a.buttons().length,500)
  a.input('SYN-499');assert.equal(a.selected(),'SYN-499');assert.equal(a.buttons().length,1)
  assert.equal(a.get('hero').querySelector('h1').textContent,'<img onerror=alert(1)>')
  a.input('SYN-498');assert.equal(a.selected(),'SYN-498');assert.equal(a.get('hero').querySelector('figure'),null,'held item has no invented chart')
})

nodeTest('option-a3: horizontal pointer navigation and compact data labels',()=>{
  const a=a3Application(),before=a.selected(),wrap=a.get('hero').querySelector('.chart-wrap')
  a.dispatch(wrap,'pointerdown',{clientX:500,clientY:100})
  a.dispatch(wrap,'pointerup',{clientX:300,clientY:100})
  assert.notEqual(a.selected(),before,'horizontal pointer release selects next product')
  const next=a.get('hero').querySelector('.chart-wrap')
  a.dispatch(next,'pointerdown',{clientX:300,clientY:100})
  a.dispatch(next,'pointerup',{clientX:500,clientY:100})
  assert.equal(a.selected(),before)
  const initial=a.get('hero').querySelector('.chart-wrap')
  a.dispatch(initial,'pointerdown',{clientX:300,clientY:100})
  a.dispatch(initial,'pointerup',{clientX:301,clientY:200})
  assert.equal(a.selected(),before,'vertical scroll does not select another product')
})
