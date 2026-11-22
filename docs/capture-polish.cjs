// Lifecycle: living. Offline sample harness evidence; not the real Desktop app.
// Controller-owned browser capture only. No network, install, or product edits.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')

function logicGuard() {
  // Review round 2: refresh only pureBlock after warehouse/input-review fixes;
  // tests/r2-protected-maths.test.mjs pins every byte outside INPUT_MEANING to d272f95.
  // Input meaning: refresh only pureBlock pin for additive import interpretation checks.
  // Forecast/order code and all protected backend/sample pins remain unchanged.
  // Stress hardening (c43f1ec, fe10103, b1f1543): plugin-only hash refreshed for bounded
  // CSV/XML/XLSX parsing; order maths untouched (golden_diff unchanged).
  // Smart Excel import: refresh ONLY desktop/plugin.js pureBlock hash for the
  // additive bounded workbook reader. Backend/sample hashes and order maths stay frozen.
  // Round 4: plugin-only hash refreshed for advisory detection + default-OFF setting;
  // engine hash stays frozen per packet (its intentional opt-in addition is reported).
  // Intentional seasonal computation rebaseline authorized by stock-runway-seasonal-forecast-20261111.md,
  // narrowed by owner to seasonal-only math. Exact-byte snapshot permits precommit verification;
  // parent reviews these hashes and pins the tested source commit after committing.
  const manifest = JSON.parse(fs.readFileSync('docs/import-logic-baseline.json', 'utf8'))
  const sha256 = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex')
  // H1/M1: restore only the exact SHA-pinned reviewed seams; all prior pins stay frozen.
  const beforeReviewedFeatures = require(require('node:path').resolve('tests/reviewed-v12-delta.cjs'))
  const current = beforeReviewedFeatures(fs.readFileSync('desktop/plugin.js', 'utf8'), 'plugin')
  const start = current.indexOf('const SAMPLE ='), end = current.indexOf('const pageStyle =')
  assert.ok(start >= 0 && end > start, 'pure block boundaries must exist')
  const pure = current.slice(start, end)
  assert.equal(sha256(pure), manifest.pureBlock.sha256, 'calculation/guidance block changed from import snapshot')
  const protectedFiles = ['engine.py', 'sources.py', 'csv_import.py', 'tools.py', 'data/sample.json']
  assert.deepEqual(Object.keys(manifest.files).sort(), [...protectedFiles].sort(), 'all backend/sample protections required')
  // Immutable reviewed checkpoints, never hashes accepted from a mutable worktree.
  // CLI --max-bytes authorized csv_import.py/sources.py at 74572d6; no maths.
  // The engine remains pinned to f2509b4. Fixtures support fresh-history archives.
  const pins = { 'engine.py': '50e8117', 'csv_import.py': 'de6ded8', 'sources.py': 'de6ded8' }
  assert.deepEqual(manifest.pins, pins, 'immutable reviewed backend pins required')
  for (const file of protectedFiles) {
    const pin = pins[file]
    const fixture = pin && `tests/fixtures/baselines/${pin}/${file}`
    // Owner-authorized import-safety checkpoint pins both source importers.
    // Engine, tools and sample protections remain frozen.
    const expected = pin
      ? sha256(fs.existsSync(fixture) ? fs.readFileSync(fixture)
        : require('node:child_process').execFileSync('git',['show',`${pin}:${file}`]))
      : manifest.files[file]
    let bytes=fs.readFileSync(file)
    if(file==='tools.py')bytes=Buffer.from(require(require('node:path').resolve('tests/reviewed-rename-delta.cjs'))(bytes.toString('utf8'),'tools'))
    if(file==='engine.py')bytes=Buffer.from(beforeReviewedFeatures(bytes.toString('utf8'),'engine'))
    // v1.2 intentionally changes opt-in engine functions. Exact full reviewed
    // source fixtures replace the prior display-only reconstruction, not its scope.
    if(file==='engine.py'){
      const text=bytes.toString('utf8'),start=text.indexOf('# Display attribution only.'),end=text.indexOf('@evaluation_pass\ndef order_bucket',start),why=text.indexOf('@evaluation_pass\ndef why_breakdown');
      assert.ok(start>=0&&end>start&&why>=0&&why<start,'engine.py changed from import snapshot: attribution boundaries');
      assert.equal(sha256(text.slice(start,end)),'6d102b17933e2cf6c41648acee967c0154e2435f4706e9b003a7a8891241c322','engine.py changed from import snapshot: display helpers');
      assert.equal(sha256(text.slice(why,start)),'3265a230703957e64d5e183302c6e70afe33e06b1dbb93f264bbec9a70f3d23f','engine.py changed from import snapshot: attribution helpers');
    }
    assert.equal(sha256(bytes), expected, `${file} changed from import snapshot`)
  }
  return { packet: manifest.packet, snapshot: 'docs/import-logic-baseline.json',
    currentPureBytes: Buffer.byteLength(pure), byteIdentical: true, backendDataFilesUnchanged: protectedFiles }
}

const labelIndex = process.argv.indexOf('--label')
const label = labelIndex >= 0 ? process.argv[labelIndex + 1] : null
assert.equal(label, 'after', 'Baseline is immutable. Usage: node docs/capture-polish.cjs --label after')
const logic = logicGuard()
if (process.argv.includes('--guard-only')) { console.log(JSON.stringify(logic)); process.exit(0) }
if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE to an existing local module; no installs.')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const outDir = `.scratch/polish-${label}`
const findings = []

function freezeOrderToday() {
  const NativeDate = Date
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-11-11T12:00:00'])) }
    static now() { return new NativeDate('2026-11-11T12:00:00').getTime() }
  }
}

async function boxes(page) {
  return page.evaluate(() => {
    const selectors = {
      page: 'main', orderPanel: 'section[aria-label^="Order now ("]',
      productFilters: '[aria-label="Product filters"]', selectedProduct: 'section[aria-label="Selected item forecast"]',
      productHeading: 'section[aria-label="Selected item forecast"] h2',
      orderStatus: 'section[aria-label="Selected item forecast"] [role="status"]',
      chart: 'section[aria-label="Selected item forecast"] svg[role="img"]',
      horizonDropdown: 'select[aria-label="Look ahead"]',
      monthTable: 'table[aria-label="Month by month: stock, sales, deliveries"]',
      advanced: 'details[data-advanced-settings]'
    }
    return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const el = document.querySelector(selector)
      if (!el) return [name, null]
      const r = el.getBoundingClientRect()
      return [name, {x:r.x, y:r.y, width:r.width, height:r.height, top:r.top, right:r.right, bottom:r.bottom, left:r.left}]
    }))
  })
}

async function contrastAudit(page) {
  return page.evaluate(() => {
    // Canvas resolves rgb(), color(srgb), color-mix and alpha into sRGB bytes.
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const rgba = css => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1)
      const [r,g,b,a] = ctx.getImageData(0,0,1,1).data
      return [r/255,g/255,b/255,a/255]
    }
    const over = (fg,bg) => {
      const alpha = fg[3] + bg[3]*(1-fg[3])
      return [...fg.slice(0,3).map((v,i)=>(v*fg[3]+bg[i]*bg[3]*(1-fg[3]))/alpha),alpha]
    }
    const background = el => {
      const layers=[]
      for(let node=el;node;node=node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor))
      // The browser canvas is white when no opaque root/background was painted.
      return layers.reverse().reduce((bg,fg)=>over(fg,bg),[1,1,1,1])
    }
    const luminance = rgb => rgb.slice(0,3).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
      .reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0)
    const checks=[]
    const measure=(el,kind,property='color',minimum=4.5)=>{
      const bg=background(el), css=getComputedStyle(el)[property], fg=over(rgba(css),bg)
      const x=luminance(fg),y=luminance(bg),ratio=(Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)
      checks.push({kind,bucket:el.dataset.bucket || el.dataset.statusLabel || el.dataset.statusMark,
        selected:el.getAttribute('aria-pressed'),text:el.textContent.trim(),foreground:css,composedForeground:fg,background:bg,ratio,minimum,pass:ratio>=minimum})
    }
    for(const el of document.querySelectorAll('[data-bucket]:not([data-bucket="all"]),[data-status-label]')) measure(el,'status-text')
    for(const el of document.querySelectorAll('[data-status-mark]')) measure(el,'status-icon','color',3)
    for(const el of document.querySelectorAll('[data-order-sku]')) measure(el,'order-row-accent','borderInlineStartColor',3)
    for(const el of document.querySelectorAll('[data-cell-tone]')) if(el.getClientRects().length) measure(el,el.dataset.cellTone+'-cell')
    return checks
  })
}

async function auditAllStates(page, output) {
  const checks=[]
  const save=()=>fs.writeFileSync(output,JSON.stringify(checks,null,2)+'\n')
  const collect=async state=>{ checks.push({state,checks:await contrastAudit(page)}); save() }
  // Isolated synthetic audit after the matching sample screenshots are complete.
  const months=['2026-08','2026-09','2026-10']
  const item=(sku,on_hand,extra={})=>({sku,name:`Contrast ${sku}`,unit:'m',on_hand,supplier_days:14,
    monthly_sales:[30,30,30],receipts:{},historical_receipts:Object.fromEntries(months.map(m=>[m,30])),...extra})
  const data={as_of:'2026-10-31',months,items:[item('order',5),item('running-low',45),item('healthy',120),
    item('no-sales',30,{monthly_sales:[0,0,0]}),item('needs-data',30,{hold_reason:'Synthetic held item'})]}
  await page.evaluate(data=>{const s=window.runwayTest.ctx.storage;s.set('csv_data',data);s.set('source','csv');window.runwayTest.remount()},data)
  await page.locator('[data-status-label="needs-data"]').first().waitFor()
  await collect('all-unselected-chips')
  for(const bucket of ['order','running-low','healthy','no-sales','needs-data']) {
    const chip=page.locator(`[data-bucket="${bucket}"]`)
    await chip.click()
    assert.equal(await chip.getAttribute('aria-pressed'),'true')
    const row=page.locator('[aria-label="Inventory items, soonest run-out first"] button[aria-pressed]').filter({has:page.locator(`[data-status-label="${bucket}"]`)})
    assert.equal(await row.count(),1,`${bucket}: actual badge row required`)
    await row.click()
    await page.locator(`[data-selected-status="${bucket}"]`).waitFor()
    assert.equal(await page.locator(`[data-selected-status="${bucket}"] [data-status-label="${bucket}"]`).count(),1,`${bucket}: header label required`)
    await collect(bucket+'-selected-chip-badge-header')
  }
  await page.locator('[data-bucket="all"]').click()
  const rows=page.locator('[aria-label="Inventory items, soonest run-out first"] button[aria-pressed]:has([data-status-label])') // product rows only, not filter chips or segmented toggles
  const selection=await rows.evaluateAll(els=>els.map(el=>({selected:el.getAttribute('aria-pressed')==='true',
    background:getComputedStyle(el).backgroundColor,shadow:getComputedStyle(el).boxShadow,accent:getComputedStyle(el).borderInlineStartColor})))
  const selected=selection.find(x=>x.selected),other=selection.find(x=>!x.selected)
  checks.push({state:'selection',selection});save()
  assert.ok(selected && other && selected.shadow!=='none' && selected.shadow!==other.shadow,'visible selection shape required')
  await rows.filter({has:page.locator('[data-status-label="order"]')}).click()
  const detail=page.getByRole('region',{name:'Selected item forecast'})
  await detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'}).click()
  await collect('visible-delivery-and-negative-table')
  // Policy v2 correctly treats positive future purchases as OK, not surplus.
  // Reuse tests/desktop.test.mjs's real zero-cover surplus fixture separately;
  // keep every existing contrast threshold and all six status checks intact.
  await page.evaluate(data=>{const s=window.runwayTest.ctx.storage;s.set('csv_data',data);
    s.set('order_settings',{months_of_cover:0});window.runwayTest.remount()},
    {...data,items:[item('overstocked',990,{supplier_days:0})]})
  await page.locator('[data-selected-status="overstocked"]').waitFor()
  await collect('overstocked-unselected-chip-badge-header')
  const surplusChip=page.locator('[data-bucket="overstocked"]')
  await surplusChip.click()
  assert.equal(await surplusChip.getAttribute('aria-pressed'),'true')
  const surplusRow=page.locator('[aria-label="Inventory items, soonest run-out first"] button[aria-pressed]').filter({has:page.locator('[data-status-label="overstocked"]')})
  assert.equal(await surplusRow.count(),1,'overstocked: actual badge row required')
  await surplusRow.click()
  assert.equal(await page.locator('[data-selected-status="overstocked"] [data-status-label="overstocked"]').count(),1,'overstocked: header label required')
  await collect('overstocked-selected-chip-badge-header')
  const flat=checks.flatMap(x=>x.checks || [])
  for(const bucket of ['order','running-low','healthy','overstocked','no-sales','needs-data']) {
    assert.ok(flat.some(x=>x.bucket===bucket && x.kind==='status-text' && x.selected==='true'),`${bucket}: selected text missing`)
    assert.ok(flat.some(x=>x.bucket===bucket && x.kind==='status-text' && x.selected==='false'),`${bucket}: unselected text missing`)
    assert.ok(flat.some(x=>x.bucket===bucket && x.kind==='status-icon'),`${bucket}: icon missing`)
  }
  for(const kind of ['order-row-accent','delivery-cell','negative-cell']) assert.ok(flat.some(x=>x.kind===kind),`${kind}: no matched elements`)
  for(const check of flat) assert.ok(check.pass,`${check.kind} ${check.bucket || ''}: ${check.ratio} < ${check.minimum}`)
  return checks
}

async function record(page, errors, state, screenshotPath, extra = {}) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${state}: page overflow`)
  const text = await page.locator('body').innerText()
  const geometry = await boxes(page)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const elementSelectors = {
    header: 'section[aria-label="Selected item forecast"] [data-selected-status]',
    chart: 'section[aria-label="Selected item forecast"] figure',
    advanced: 'details[data-advanced-settings]',
    table: 'section[aria-label="Selected item forecast"] [aria-label="Month by month: stock, sales, deliveries"]',
  }
  const elements = {}
  for (const [name, selector] of Object.entries(elementSelectors)) {
    const element = page.locator(selector).first()
    if (label === 'after' && await element.count() && await element.isVisible()) {
      const target = `${path.dirname(screenshotPath)}/${path.basename(screenshotPath, '.png')}-${name}-crop.png`
      await element.screenshot({ path: target })
      elements[name] = target
    }
  }
  return { state, screenshot: screenshotPath, semanticText: text,
    numericTokens: text.match(/(?<![\w])(?:\d[\d,.]*(?:%|\s?(?:m|days?|months?))?)(?![\w])/g) || [],
    boundingBoxes: geometry, elementScreenshots: elements, ...extra, consoleAndPageErrors: [...errors] }
}

;(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--disable-background-networking', '--disable-telemetry', '--no-first-run'] })
  try {
    for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 1100 } })
      await context.route(/^https?:/, route => route.abort())
      await context.addInitScript(freezeOrderToday)
      try {
        const page = await context.newPage(), errors = []
        page.on('pageerror', error => errors.push({ type:'pageerror', message:error.message }))
        page.on('console', message => { if (message.type() === 'error') errors.push({ type:'console', message:message.text() }) })
        await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href + `?theme=${theme}`)
        const detail = page.getByRole('region', { name:'Selected item forecast' })
        await detail.getByRole('heading', { name:'Supply, demand and inventory', exact:true }).waitFor()
        const base = `${outDir}/${width}-${theme}`
        const config = { width, theme }
        const contrast = await contrastAudit(page)
        fs.writeFileSync(`${base}-sample-contrast.json`, JSON.stringify(contrast,null,2)+'\n')
        for(const check of contrast) assert.ok(check.pass,`${check.kind}: ${check.ratio} < ${check.minimum}`)
        findings.push({ ...config, contrast, ...(await record(page, errors, 'page-top-order-panel-and-filters', `${base}-page-top.png`)) })

        const heading = detail.locator('h2').first()
        await heading.waitFor()
        findings.push({ ...config, ...(await record(page, errors, 'selected-product-header', `${base}-product-header.png`)) })
        const chart = detail.locator('svg[role="img"]').first()
        await chart.waitFor()
        findings.push({ ...config, ...(await record(page, errors, 'chart', `${base}-chart.png`)) })

        const select = page.getByRole('combobox', { name:'Look ahead', exact:true })
        const options = await select.locator('option').evaluateAll(nodes => nodes.map(option => ({text:option.textContent, value:option.value, selected:option.selected})))
        await select.focus()
        await page.keyboard.press('Alt+ArrowDown').catch(() => {})
        const nativeSelectNote = 'The SDK shim renders a native HTML select. Its OS popup is not part of page screenshots; capture shows the focused control and records its options DOM. No popup is simulated.'
        findings.push({ ...config, ...(await record(page, errors, 'dropdown-focused-native-select', `${base}-dropdown.png`,
          { dropdown: { limitation:nativeSelectNote, options, focused:await select.evaluate(el=>el===document.activeElement) } })) })
        await page.keyboard.press('Escape').catch(() => {})

        const monthSummary = detail.locator('summary').filter({ hasText:'Month by month: stock, sales, deliveries' })
        await monthSummary.click()
        const table = detail.getByRole('table', { name:'Month by month: stock, sales, deliveries', exact:true })
        await table.waitFor()
        findings.push({ ...config, ...(await record(page, errors, 'expanded-month-table', `${base}-month-table.png`)) })
        await monthSummary.click()

        const advanced = page.locator('details[data-advanced-settings]')
        // All settings now contains nested Accuracy/Costs disclosures.
        await advanced.locator(':scope > summary').click()
        findings.push({ ...config, ...(await record(page, errors, 'expanded-advanced-settings', `${base}-advanced.png`)) })
        const auditedStates = await auditAllStates(page, `${base}-contrast.json`)
        findings.push({...config, state:'contrast-all-buckets', auditedStates})
        assert.deepEqual(errors, [], `${width}px ${theme}: browser errors`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
  const report = { label, caption:'Local offline harness only; synthetic sample data; not the real Desktop app.',
    today:'2026-11-11', logic, configurations:findings }
  fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ label, outDir, captures:findings.length, screenshots:findings.map(x=>x.screenshot), report:`${outDir}/report.json` }, null, 2))
})().catch(error => { fs.writeFileSync(`${outDir}/report.json`,JSON.stringify({label,logic,configurations:findings,error:error.stack},null,2)+'\n'); console.error(error); process.exitCode = 1 })
