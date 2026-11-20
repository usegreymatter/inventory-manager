const {acceptMeaning}=require('./qa-input-meaning.cjs')
// Lifecycle: living. Optional offline browser proof; uses existing Playwright/Chrome.
// PLAYWRIGHT_MODULE=/absolute/path/playwright/index.js CHROMIUM_EXECUTABLE=... node standalone/capture.cjs
// Add --design for option-a/option-b only (390x844 + 1440x900, light/dark, .scratch/design).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const root = path.resolve(__dirname, '..'), out = path.join(root, '.scratch/standalone')
fs.mkdirSync(out, { recursive: true })
const file = path.join(__dirname, 'design/baseline.html'), url = pathToFileURL(file).href
const plugin = fs.readFileSync(path.join(root, 'desktop/plugin.js'), 'utf8')
const ctx = vm.createContext({ TextEncoder, TextDecoder, atob, btoa })
vm.runInContext(plugin.slice(plugin.indexOf('const SAMPLE ='), plugin.indexOf('const pageStyle =')).replaceAll('export ', '') + '\nglobalThis.api={SAMPLE,sortRows,evaluateDataset,orderGuidance,orderBucket,orderSentence,noOrderSentence,DEFAULT_ORDER_SETTINGS}', ctx)
const core = ctx.api, today = '2026-11-11', report = { checks: [], screenshots: [], networkRequests: [], browserErrors: [] }
// A supply gap covered by a dated, confirmed receipt is deliberately independent
// of the five-item teaching sample. An undated CSV on_order value is not that proof.
const confirmedGap = {bundle_version:'1.0',decision_date:'2026-11-11',as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:[{
  sku:'GAP',name:'<img src=x onerror=alert(1)>',unit:'l',on_hand:0,on_order:0,supplier_days:14,monthly_sales:[30,30,30],receipts:{},
  planning_facts:{version:'1.0',warehouses:['Synthetic'],incoming_pos:[{po_line_id:'synthetic-gap-receipt',sku:'GAP',warehouse:'Synthetic',supplier:'Fictional supplier',remaining_qty:1000,due_date:'2026-11-20',status:'confirmed'}]}
}]}
const designMode = process.argv.includes('--design')
// File-only is the default; loopback hosting requires an explicit separate opt-in.
const offlineOnly = !process.argv.includes('--static-http') || process.argv.includes('--offline-only')
function check(name, condition) { assert.ok(condition, name); report.checks.push(name) }
async function setup(page) {
  if (offlineOnly) await page.route(/^https?:/, route => route.abort())
  page.on('pageerror', error => report.browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.browserErrors.push(message.text()) })
  page.on('request', req => { if (!req.url().startsWith('file:')) report.networkRequests.push(req.url()) })
  await page.addInitScript(() => {
    const RealDate = Date, fixed = new RealDate('2026-11-11T09:00:00Z').getTime()
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])) } static now() { return fixed } }
  })
}
async function geometry(page, label, minimum = 40) {
  const m = await page.evaluate(() => ({
    width: innerWidth, pageWidth: document.documentElement.scrollWidth,
    controls: [...document.querySelectorAll('button,summary,input:not([type=file]),select,.file-button')]
      .filter(el => {
        if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return false
        for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.tagName === 'DETAILS' && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(el)) return false
        }
        return true
      })
      .map(el => ({ id:el.id || el.textContent.trim().slice(0,30), height:el.getBoundingClientRect().height, width:el.getBoundingClientRect().width })),
    background: getComputedStyle(document.body).backgroundColor,
  }))
  check(`${label}: no horizontal overflow`, m.pageWidth <= m.width)
  const small = m.controls.filter(c => c.height < minimum - 0.1 || (minimum >= 44 && c.width < minimum - 0.1))
  check(`${label}: ${minimum}px tap targets${small.length ? `: ${JSON.stringify(small)}` : ''}`, small.length === 0)
  return m
}
async function loadCsv(page, text, name = 'synthetic.csv') {
  await page.locator('#csv-file').setInputFiles({ name, mimeType:'text/csv', buffer:Buffer.from(text) });await acceptMeaning(page)
  await page.waitForFunction(() => !document.getElementById('source-status').textContent.startsWith('Reading'))
}
async function designReadability(page, label) {
  await page.waitForFunction(() => [...document.querySelectorAll('.mini-wrap')].every(el => el.querySelector('svg') || el.textContent.includes('unavailable')))
  const metrics = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement)
    const rgb = color => {
      const el = document.createElement('span'); el.style.color = color; document.body.append(el)
      const result = getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number); el.remove(); return result
    }
    const luminance = value => value.map(c => {c/=255; return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
    const bg = luminance(rgb(css.getPropertyValue('--bg')))
    const contrast = name => {const fg = luminance(rgb(css.getPropertyValue(name)));return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)}
    const clipped = [...document.querySelectorAll('svg text')].filter(el => el.getClientRects().length && el.closest('svg').getBoundingClientRect().width > 0).flatMap(el => {
      const b=el.getBoundingClientRect(),s=el.closest('svg').getBoundingClientRect()
      return b.left < s.left-1 || b.right > s.right+1 || b.top < s.top-1 || b.bottom > s.bottom+1 ? [el.textContent] : []
    })
    return {text:['--ink','--muted','--accent'].map(contrast),graphics:['--accent','--history','--amber','--red','--supply'].map(contrast),clipped}
  })
  check(`${label}: AA text contrast`,metrics.text.every(value => value >= 4.5))
  check(`${label}: chart strokes meet non-text contrast`,metrics.graphics.every(value => value >= 3))
  check(`${label}: chart text fits SVG: ${JSON.stringify(metrics.clipped)}`,metrics.clipped.length === 0)
}
async function captureDesigns(browser) {
  const designOut = path.join(root, '.scratch/design')
  fs.mkdirSync(designOut, { recursive: true })
  const screenshot = async (page, label) => {
    const shot = path.join(designOut, `${label}.png`)
    await page.waitForTimeout(300) // Capture after the <=260ms entry draw, never mid-line.
    await page.screenshot({ path:shot, fullPage:false })
    report.screenshots.push(shot)
  }
  for (const design of ['option-a', 'option-b']) {
    const designUrl = pathToFileURL(path.join(__dirname, `design/${design}.html`)).href
    for (const viewport of [{width:390,height:844}, {width:1440,height:900}]) for (const theme of ['light','dark']) {
      const label = `${design}-${viewport.width}x${viewport.height}-${theme}`
      const context = await browser.newContext({viewport, colorScheme:theme, timezoneId:'Asia/Kuwait', offline:true})
      try {
        const page = await context.newPage(); await setup(page); await page.goto(designUrl)
        await page.locator('#orders .order-row').first().waitFor()
        check(`${label}: sample opens`, (await page.locator('#snapshot').textContent()).startsWith('Sample data'))
        for (const id of ['snapshot','orders','others','copy-po','settings','csv-file','dropzone','theme-toggle']) {
          check(`${label}: preserved #${id}`, await page.locator(`#${id}`).count() === 1)
        }
        const initial = await geometry(page,label,44)
        await designReadability(page,label)
        check(`${label}: system color scheme`, await page.evaluate(theme => getComputedStyle(document.documentElement).colorScheme.includes(theme),theme))
        await screenshot(page,label)
        if (design === 'option-a') {
          const buttons = page.locator('.item-select[data-sku]')
          check(`${label}: switchable items`, await buttons.count() > 1)
          const before = await page.locator('.chart-wrap svg[data-chart]').first().evaluate(el => el.outerHTML)
          await buttons.nth(1).click()
          await page.waitForFunction(previous => {
            const svg = document.querySelector('.chart-wrap svg[data-chart]')
            return svg && svg.outerHTML !== previous
          },before)
          check(`${label}: chart changes with item selection`, before !== await page.locator('.chart-wrap svg[data-chart]').first().evaluate(el => el.outerHTML))
          await buttons.first().focus(); await page.keyboard.press('Enter')
          check(`${label}: keyboard item switch restores first chart`, before === await page.locator('.chart-wrap svg[data-chart]').first().evaluate(el => el.outerHTML))
        } else {
          const row = page.locator('details.chart-row').first()
          check(`${label}: chart row starts collapsed`, !(await row.evaluate(el => el.open)))
          await row.locator(':scope > summary').click()
          check(`${label}: chart row expands`, await row.evaluate(el => el.open))
          await row.locator('.chart-wrap svg[data-chart]').waitFor({state:'visible'})
          await row.locator(':scope > summary').focus(); await page.keyboard.press('Enter')
          check(`${label}: keyboard collapses chart row`, !(await row.evaluate(el => el.open)))
          await page.keyboard.press('Enter')
        }
        const svg = page.locator('.chart-wrap svg[data-chart]:visible').first()
        await svg.scrollIntoViewIfNeeded()
        const box = await svg.boundingBox()
        check(`${label}: visible chart has geometry`, box && box.width > 0 && box.height > 0)
        await page.mouse.move(box.x + box.width * 0.5,box.y + box.height * 0.5)
        const tooltip = page.locator('.chart-tooltip:visible').first()
        await tooltip.waitFor({state:'visible'})
        check(`${label}: tooltip contains numeric data`, /\d/.test((await tooltip.textContent()).trim()))
        check(`${label}: tooltip includes demand, deliveries and stock`, /[Dd]emand/.test(await tooltip.textContent()) && /Deliveries/.test(await tooltip.textContent()) && /Stock/.test(await tooltip.textContent()))
        await geometry(page,`${label}-tooltip`,44)
        await designReadability(page,`${label}-expanded`)
        await page.waitForTimeout(120) // Let the 70ms crosshair ease finish before the still.
        await screenshot(page,`${label}-tooltip`)
        await svg.focus(); await page.keyboard.press('ArrowRight')
        check(`${label}: keyboard tooltip`,await tooltip.isVisible())
        await page.keyboard.press('Escape')
        check(`${label}: Escape clears tooltip`,await page.locator('.chart-tooltip:visible').count() === 0)
        await svg.dispatchEvent('pointerdown',{clientX:box.x+box.width*.7,clientY:box.y+box.height*.5,pointerType:'touch'})
        check(`${label}: touch pointer shows tooltip`,await page.locator('.chart-tooltip:visible').count() === 1)
        await page.mouse.move(0,0)
        await page.locator('#theme-toggle').click()
        const changed = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        check(`${label}: explicit theme changes appearance`, changed !== initial.background)
        await page.reload(); await page.locator('#orders .order-row').first().waitFor()
        check(`${label}: explicit theme persists on reload`, await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === changed)
        await page.locator('#theme-toggle').click()
        await page.locator('#settings > summary').click()
        await geometry(page,`${label}-settings`,44)
        await page.locator('#delivery-days').fill('0')
        check(`${label}: invalid draft is rejected`, await page.locator('#settings-error').isVisible())
        await page.locator('#delivery-days').fill('21')
        await page.reload(); await page.locator('#orders .order-row').first().waitFor()
        await page.locator('#settings > summary').click()
        check(`${label}: order settings persist`, await page.locator('#delivery-days').inputValue() === '21')
        await page.locator('#reset-settings').click(); await page.locator('#settings > summary').click()
        await page.emulateMedia({reducedMotion:'reduce'})
        check(`${label}: reduced-motion preference active`, await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
        const moving = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => {
          const style = getComputedStyle(el), seconds = text => text.split(',').some(value => parseFloat(value) > 0.01)
          return el.getClientRects().length && ((style.animationName !== 'none' && seconds(style.animationDuration)) || seconds(style.transitionDuration))
        }).map(el => el.id || el.className?.baseVal || el.className || el.tagName))
        check(`${label}: reduced-motion disables animated transitions: ${JSON.stringify(moving)}`, moving.length === 0)
        await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => {window.__copied = text}}}))
        await page.locator('#copy-po').click()
        const po = await page.evaluate(() => window.__copied)
        check(`${label}: copy produces purchase order`, typeof po === 'string' && po.startsWith('Purchase order · Stock Runway\nDate: 2026-11-11\n'))
        await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async () => {throw Error('denied')}}}))
        await page.locator('#copy-po').click()
        check(`${label}: copy fallback is exact and selected`, await page.locator('#copy-fallback').isVisible() && await page.locator('#po-text').inputValue() === po && await page.locator('#po-text').evaluate(el => el.selectionEnd - el.selectionStart === el.value.length))
        await geometry(page,`${label}-copy-fallback`,44)
        // File uploads are local synthetic/checked-in fixtures only; never live ERP.
        if (viewport.width === 390 && theme === 'light') {
          await page.locator('#file-panel > summary').click()
          const fixtures = fs.readdirSync(path.join(root,'docs/erp-examples')).filter(f => f.endsWith('.csv')).sort()
          check(`${design}: all eight ERP fixtures enumerated`,fixtures.length === 8)
          for (const name of fixtures) {
            await loadCsv(page,fs.readFileSync(path.join(root,'docs/erp-examples',name),'utf8'),name)
            check(`${design}: uploads ${name}`, !(await page.locator('#file-error').isVisible()) && (await page.locator('#source-status').textContent()).startsWith(`Using ${name}`))
          }
          const before = await page.locator('#order-count').textContent()
          await loadCsv(page,'not,a,valid,csv','bad.csv')
          check(`${design}: invalid upload preserves dataset`, await page.locator('#file-error').isVisible() && await page.locator('#order-count').textContent() === before)
          await loadCsv(page,JSON.stringify(confirmedGap),'synthetic-confirmed-gap.json')
          check(`${design}: zero-quantity supply gap stays visible and safe`, await page.locator('#orders .order-row').count() === 1 && await page.locator('#copy-po').isDisabled() && await page.locator('#orders img').count() === 0 && (await page.locator('#orders').textContent()).includes('<img src=x onerror=alert(1)>'))
          await loadCsv(page,'sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nZERO,Out of stock,units,0,14,30,30,30\n','zero.csv')
          check(`${design}: out-of-stock warning`, (await page.locator('#orders .answer').textContent()).startsWith('Out of stock — Order'))
          await page.reload(); await page.locator('#orders .order-row').first().waitFor()
          check(`${design}: uploaded data never persists`, (await page.locator('#snapshot').textContent()).startsWith('Sample data'))
          const blocked = await context.newPage(); await setup(blocked)
          await blocked.addInitScript(() => Object.defineProperty(window,'localStorage',{get(){throw Error('blocked')}}))
          await blocked.goto(designUrl); await blocked.locator('#orders .order-row').first().waitFor()
          await blocked.locator('#theme-toggle').click()
          check(`${design}: storage denied stays usable`, (await blocked.locator('#storage-status').textContent()).includes('unavailable'))
          await blocked.close()
        }
      } finally { await context.close() }
    }
  }
  check('design pages make zero network requests',report.networkRequests.length === 0)
  check(`design pages have no console or page errors: ${JSON.stringify(report.browserErrors)}`,report.browserErrors.length === 0)
  check('all eight design viewport/theme combinations and tooltip screenshots captured',report.screenshots.length === 16)
  fs.writeFileSync(path.join(designOut,'browser-report.json'),JSON.stringify(report,null,2)+'\n')
  console.log(`${report.checks.length} design browser checks passed; ${report.screenshots.length} screenshots; zero network requests and console errors`)
  console.log(JSON.stringify({screenshots:report.screenshots,report:path.join(designOut,'browser-report.json')}))
}
;(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE })
  let server
  try {
    if (designMode) { await captureDesigns(browser); return }
    for (const width of [360,390,768,1440]) for (const theme of ['light','dark']) {
      const context = await browser.newContext({ viewport:{ width, height:900 }, colorScheme:theme, timezoneId:'Asia/Kuwait', offline:true })
      const page = await context.newPage(); await setup(page); await page.goto(url)
      await page.locator('#orders .order-row').first().waitFor()
      const label = `${width}-${theme}`
      check(`${label}: sample opens`, (await page.locator('#snapshot').textContent()).startsWith('Sample data'))
      check(`${label}: first section is Order today`, await page.locator('main > section').first().getAttribute('aria-labelledby') === 'order-title')
      check(`${label}: other items and settings collapsed`, await page.locator('#other-items[open],#settings[open]').count() === 0)
      const m = await geometry(page, label)
      check(`${label}: real system theme`, theme === 'light' ? m.background === 'rgb(248, 249, 247)' : m.background === 'rgb(21, 27, 24)')
      const expected = core.sortRows(core.evaluateDataset(core.SAMPLE, 6, core.DEFAULT_ORDER_SETTINGS)).map(item => ({ item, guidance:core.orderGuidance(item,today,core.DEFAULT_ORDER_SETTINGS,core.SAMPLE.as_of), bucket:core.orderBucket(item,today,core.DEFAULT_ORDER_SETTINGS,core.SAMPLE.as_of) })).filter(r => ['order','running-low'].includes(r.bucket))
      const actual = await page.locator('#orders .order-row').evaluateAll(rows => rows.map(r => ({ sku:r.dataset.sku, answer:r.querySelector('.answer').textContent })))
      check(`${label}: plugin order rows match`, actual.length === expected.length && expected.every(e => actual.some(a => a.sku === e.item.sku && a.answer === (e.guidance.quantity > 0 ? `${e.guidance.out_of_stock ? 'Out of stock — ' : ''}${core.orderSentence(e.item,e.guidance)}` : core.noOrderSentence(e.item,e.guidance)))))
      if ([390,1440].includes(width)) {
        const shot = path.join(out, `sample-${label}.png`)
        await page.screenshot({ path:shot, fullPage:true }); report.screenshots.push(shot)
      }
      await page.locator('#settings > summary').click()
      await geometry(page, `${label}-expanded-settings`)
      if (width === 390 && theme === 'light') {
        // Keyboard focus and invalid drafts preserve the previous calculation.
        await page.locator('#delivery-days').focus()
        check('visible keyboard focus', await page.locator('#delivery-days').evaluate(el => getComputedStyle(el).outlineStyle !== 'none'))
        await page.locator('#delivery-days').fill('0')
        check('invalid setting has error', await page.locator('#settings-error').isVisible())
        await page.locator('#delivery-days').fill('21')
        await page.locator('#cover-months').fill('3')
        await page.locator('#service-level').selectOption('0.99')
        await page.reload(); await page.locator('#order-count').waitFor()
        await page.locator('#settings > summary').click()
        check('settings persist across file reload', await page.locator('#delivery-days').inputValue() === '21' && await page.locator('#cover-months').inputValue() === '3' && await page.locator('#service-level').inputValue() === '0.99')
        await page.locator('#reset-settings').click()
        check('settings reset', await page.locator('#delivery-days').inputValue() === '14')
        await page.locator('#settings > summary').click()
        // Exercise the success path without writing the user's system clipboard.
        await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{ configurable:true, value:{ writeText:async value => { window.__copied = value } } }))
        await page.locator('#copy-po').click()
        check('copy success feedback', (await page.locator('#copy-status').textContent()).startsWith('Copied'))
        const po = await page.evaluate(() => window.__copied)
        fs.writeFileSync(path.join(out,'sample-po.txt'), po + '\n')
        check('sample PO format and count', po.startsWith('Purchase order · Stock Runway\nDate: 2026-11-11\n\n• ') && po.endsWith(`\n\n${expected.filter(r => r.guidance.quantity > 0).length} items`))
        await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{ configurable:true, value:{ writeText:async () => { throw Error('denied') } } }))
        await page.locator('#copy-po').click()
        check('clipboard failure reveals exact fallback', await page.locator('#copy-fallback').isVisible() && await page.locator('#po-text').inputValue() === po)
        check('fallback text selected', await page.locator('#po-text').evaluate(el => el.selectionEnd - el.selectionStart === el.value.length))
        // Every ERP fixture is picked through the real input, then data is rejected safely.
        const csvFiles = fs.readdirSync(path.join(root,'docs/erp-examples')).filter(f => f.endsWith('.csv')).sort()
        check('all eight ERP fixtures enumerated', csvFiles.length === 8)
        for (const name of csvFiles) {
          await loadCsv(page,fs.readFileSync(path.join(root,'docs/erp-examples',name),'utf8'),name)
          check(`file picker loads ${name}`, !(await page.locator('#file-error').isVisible()) && (await page.locator('#source-status').textContent()).startsWith(`Using ${name}`))
        }
        const before = await page.locator('#order-count').textContent()
        await loadCsv(page,'not,a,valid,csv','bad.csv')
        check('bad file retains previous dataset', await page.locator('#file-error').isVisible() && await page.locator('#order-count').textContent() === before)
        const csv = 'sku,name,unit,on_hand,supplier_days,on_order,2026-06,2026-07,2026-08\nGAP,<img src=x onerror=alert(1)>,l,0,14,1000,30,30,30\n'
        await page.locator('#dropzone').evaluate((el,text) => { const dt = new DataTransfer(); dt.items.add(new File([text],'dropped.csv',{type:'text/csv'})); el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})) },csv)
        await page.getByRole('heading',{name:'Before we suggest orders',exact:true}).waitFor({state:'visible'})
        check('drag and drop waits for meaning review', !(await page.locator('#source-status').textContent()).startsWith('Using dropped.csv'))
        await acceptMeaning(page)
        await page.waitForFunction(() => document.getElementById('source-status').textContent.startsWith('Using dropped.csv'))
        check('drag and drop parses safely', await page.locator('#orders .product').textContent() === '<img src=x onerror=alert(1)>' && await page.locator('#orders img').count() === 0)
        check('stale-data warning', await page.locator('#stale-warning').isVisible() && (await page.locator('#stale-warning').textContent()).includes('72 days ago'))
        check('unknown incoming warning hides when explicit', !(await page.locator('#incoming-warning').isVisible()))
        await loadCsv(page,JSON.stringify(confirmedGap),'synthetic-confirmed-gap.json')
        check('zero-quantity supply-gap row remains visible', await page.locator('#orders .order-row').count() === 1 && await page.locator('#copy-po').isDisabled())
        const zero = 'sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nZERO,Out of stock,units,0,14,30,30,30\n'
        await loadCsv(page,zero)
        check('out-of-stock label is explicit', (await page.locator('#orders .answer').textContent()).startsWith('Out of stock — Order'))
        check('unknown incoming warning visible', await page.locator('#incoming-warning').isVisible())
        await page.locator('#settings > summary').click(); await page.locator('#cover-months').fill('12')
        check('big-order warning', (await page.locator('#orders').textContent()).includes('Check this order:'))
        await page.locator('#reset-settings').click()
        await page.locator('#other-items > summary').click()
        await geometry(page,'390-expanded-all')
        await page.reload(); await page.locator('#order-count').waitFor()
        check('CSV not persisted; reload returns to sample', (await page.locator('#snapshot').textContent()).startsWith('Sample data'))
        const storedKeys = await page.evaluate(() => Object.keys(localStorage))
        check('only settings and reviewed layout defaults persisted', JSON.stringify(storedKeys.sort()) === JSON.stringify(['stock-runway-smart-mappings-v1','stock-runway.standalone.order-settings.v1'].sort()))
        const rules = await page.evaluate(() => JSON.parse(localStorage.getItem('stock-runway-smart-mappings-v1')))
        check('remembered layouts contain only mappings and explicit meaning choices', Array.isArray(rules) && rules.length > 0 && rules.every(rule =>
          JSON.stringify(Object.keys(rule).sort()) === JSON.stringify(['fingerprint','sheet','overrides','choices','warning_fingerprint'].sort()) &&
          typeof rule.fingerprint === 'string' && JSON.parse(rule.fingerprint).every(layout =>
            Array.isArray(layout) && layout.length === 2 && layout[0] === 'CSV' && Array.isArray(layout[1]) && layout[1].every(header => typeof header === 'string')) &&
          /^[a-f0-9]{64}$/.test(rule.warning_fingerprint) && rule.sheet === 'CSV' &&
          Object.keys(rule.overrides).every(key => /^CSV:\d+$/.test(key)) &&
          JSON.stringify(Object.keys(rule.choices).sort()) === JSON.stringify(['stock_includes_reserved','incoming_not_in_file','units_confirmed'].sort()) &&
          Object.values(rule.choices).every(value => typeof value === 'boolean') && rule.choices.units_confirmed))
        check('uploaded product values and filenames never persisted', !/GAP|ZERO|<img|Out of stock|synthetic\.csv|dropped\.csv/.test(JSON.stringify(rules)))
        // Simulate storage failure at cold load, without changing the browser profile.
        const blocked = await context.newPage(); await setup(blocked)
        await blocked.addInitScript(() => Object.defineProperty(window,'localStorage',{get(){throw Error('blocked')}}))
        await blocked.goto(url); await blocked.locator('#orders .order-row').first().waitFor()
        check('storage-denied startup stays usable', (await blocked.locator('#storage-status').textContent()).includes('unavailable'))
        await blocked.close()
      }
      await context.close()
    }
    check('offline file page makes zero network requests', report.networkRequests.length === 0)
    report.offlineNetworkRequests = [...report.networkRequests]
    report.networkRequests = []
    // A local static HTTP smoke checks the same artifact's static-hosting path, not a deployment.
    // --offline-only respects verification packets that prohibit even loopback HTTP.
    if (!offlineOnly) {
      server = http.createServer((req,res) => { res.setHeader('Content-Type','text/html'); res.end(fs.readFileSync(file)) })
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
      const page = await browser.newPage(); await setup(page)
      await page.goto(`http://127.0.0.1:${server.address().port}/stock-runway.html`)
      await page.locator('#orders .order-row').first().waitFor()
      check('local static HTTP startup works', (await page.locator('#snapshot').textContent()).startsWith('Sample data'))
      await page.close()
      report.staticHttpRequests = report.networkRequests
    } else report.staticHttpSkipped = 'File-only default; no server or network (static HTTP requires --static-http)'
    delete report.networkRequests
    report.poTextPath = path.join(out,'sample-po.txt')
    check(`baseline has no console or page errors: ${JSON.stringify(report.browserErrors)}`,report.browserErrors.length === 0)
    fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n')
    console.log(`${report.checks.length} browser checks passed; 4 screenshots; offline zero network requests; local static HTTP ${report.staticHttpSkipped?'skipped (file-only)':'passed'}`)
    console.log(JSON.stringify({ screenshots:report.screenshots, poTextPath:report.poTextPath }))
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
