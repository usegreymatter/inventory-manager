// Lifecycle: living. Offline synthetic workbook UI acceptance, no live data.
// Run after integration/build:
// TMPDIR=$PWD/.scratch PLAYWRIGHT_MODULE=/path/to/playwright/index.js \
// CHROMIUM_EXECUTABLE=/path/to/chrome node standalone/capture-smart-import.cjs
// --check validates the complete fixture contract without launching a browser.
// --source-ui tests current UI source in a scratch-only probe (no final build proof).
// --repeat-safety limits UI coverage to repeat/default/warning/status regressions.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const fixtureRoot = path.join(root, 'tests/fixtures/smart-import')
const out = path.join(root, '.scratch/pp')
const reportPath = path.join(out, 'smart-import-report.json')
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]
const report = {
  status: 'RUNNING', scope: 'Local built standalone, synthetic fixtures only, HTTP(S) blocked; no live/hosted proof.',
  checks: [], fixtureRuns: [], screenshots: [], errors: [], consoleErrors: [], network: [],
}
let activePage
function check(label, value, evidence) {
  report.checks.push({ label, pass: Boolean(value), ...(evidence === undefined ? {} : { evidence }) })
  assert.ok(value, label + (evidence === undefined ? '' : ': ' + JSON.stringify(evidence)))
}
function equal(label, actual, expected) {
  try { assert.deepEqual(actual, expected) } catch (error) {
    report.checks.push({ label, pass: false, evidence: { actual, expected } })
    throw error
  }
  report.checks.push({ label, pass: true })
}
async function screenshot(page, name) {
  const file = path.join(out, name)
  await page.screenshot({ path: file, fullPage: false })
  report.screenshots.push(file)
}
function baseMapping(entry) {
  return entry.expected.mappings.find(mapping =>
    mapping.sheet === entry.report.sheet_used ||
    (entry.fixture.filename.endsWith('.csv') && mapping.sheet === 'CSV' && entry.report.sheet_used === path.parse(entry.fixture.filename).name))
}
const layoutLabel = layout => ({ wide: 'Monthly sales columns', long: 'Sales by date', products: 'Product list' })[layout]
const state = page => page.evaluate(() => window.smartImportQA.state())
async function upload(page, file) {
  await page.locator('#csv-file').setInputFiles(file)
}
async function dialog(page) {
  await page.locator('#smart-import').waitFor({ state: 'visible' })
}
async function unchanged(page, previous, label) { equal(label, await state(page), previous) }
async function imported(page, entry, label) {
  await page.waitForFunction(filename => window.smartImportQA.state().source === filename, entry.fixture.filename)
  const current = await state(page)
  equal(label + ' imported product count', current.count, entry.fixture.expected_product_count)
  equal(label + ' source filename', current.source, entry.fixture.filename)
  const expectedItems = entry.expected.expected_scenario.items
  equal(label + ' exact product-code universe', current.items.map(item => item.sku).sort(), expectedItems.map(item => item.sku).sort())
  for (const expected of expectedItems) {
    const actual = current.items.find(item => item.sku === expected.sku)
    for (const field of ['name', 'unit', 'on_hand', 'supplier_days', 'supplier', 'monthly_sales']) {
      if (Object.hasOwn(expected, field)) equal(label + ' ' + expected.sku + ' ' + field, actual[field], expected[field])
    }
  }
  return current
}
async function modalContract(page, entry, label, previous) {
  await dialog(page)
  equal(label + ' dialog title', await page.locator('#smart-import-title').textContent(), 'We understood your file')
  for (const [id, text] of [['use', 'Use this'], ['change', 'Edit mappings'], ['cancel', 'Cancel']]) {
    check(label + ' ' + text + ' action visible', await page.locator('#smart-import-' + id).isVisible())
    equal(label + ' ' + text + ' label', await page.locator('#smart-import-' + id).textContent(), text)
  }
  const intended = baseMapping(entry)
  check(label + ' selected sheet has independent fixture mapping', Boolean(intended), entry.report.sheet_used)
  equal(label + ' physical header matches fixture intent', entry.report.header_row, intended.header_row)
  equal(label + ' summary sheet/header/layout', await page.locator('#smart-import-summary').textContent(),
    `${entry.report.sheet_used} · Header row ${intended.header_row} · ${layoutLabel(entry.report.layout)}`)
  check(label + ' ready count', new RegExp('^' + entry.fixture.expected_product_count + ' products ready(?:\\b| ·)').test(await page.locator('#smart-import-ready').textContent()))
  check(label + ' confirmation enabled', await page.locator('#smart-import-use').isEnabled())
  const expectedPreview = entry.report.canonical_rows.slice(1, 6).map(row => [row[0], row[1], String(Number(row[3]))])
  const preview = await page.locator('#smart-import-preview tr').evaluateAll(rows => rows.filter(row => row.querySelector('td')).map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)))
  equal(label + ' first five preview (two-product fixtures)', preview, expectedPreview)
  equal(label + ' preview count', preview.length, Math.min(5, entry.fixture.expected_product_count))
  await unchanged(page, previous, label + ' no dataset mutation before confirmation')
  const geometry = await page.locator('#smart-import').evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: innerWidth, height: innerHeight, content: element.scrollWidth, client: element.clientWidth,
      pageWidth: document.documentElement.scrollWidth }
  })
  check(label + ' no modal/page horizontal overflow', geometry.left >= 0 && geometry.right <= geometry.width + 1 && geometry.content <= geometry.client + 1 && geometry.pageWidth <= geometry.width, geometry)
  const buttons = await page.locator('#smart-import button').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => ({ id: element.id, height: element.getBoundingClientRect().height })))
  check(label + ' 44px dialog buttons', buttons.length >= 3 && buttons.every(button => button.height >= 44), buttons)
}
async function scrollAndReachActions(page, label, viewport) {
  await page.locator('#smart-import details').evaluateAll(elements => elements.forEach(element => { element.open = true }))
  const scroll = await page.locator('#smart-import').evaluate(element => {
    const scrollable = [element, ...element.querySelectorAll('*')].filter(candidate => candidate.scrollHeight > candidate.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(candidate).overflowY))
    for (const candidate of scrollable) candidate.scrollTop = candidate.scrollHeight
    return scrollable.map(candidate => ({ tag: candidate.tagName, id: candidate.id, top: candidate.scrollTop,
      client: candidate.clientHeight, total: candidate.scrollHeight, remaining: candidate.scrollHeight - candidate.clientHeight - candidate.scrollTop }))
  })
  check(label + ' expanded dialog has a scroll container', scroll.length > 0, scroll)
  check(label + ' expanded report scroll reaches end', scroll.every(container => container.top > 0 && container.remaining <= 1), scroll)
  const actions = await page.locator('#smart-import-use,#smart-import-change,#smart-import-cancel').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }
  }))
  check(label + ' footer actions reachable after scrolling', actions.every(rect => rect.left >= 0 && rect.right <= viewport.width && rect.top >= 0 && rect.bottom <= viewport.height && rect.hit), actions)
}
async function mappingCorrection(page, entry, label, previous) {
  check(label + ' suggested matches have explicit review guidance', (await page.locator('.smart-import-note').textContent()).includes('Suggested matches need your review before you use this file.'))
  await page.locator('#smart-import-change').click()
  const column = entry.report.mapping.find(column => column.source === 'QOH')
  check(label + ' QOH has reviewable low/medium confidence', column && ['low', 'medium'].includes(column.confidence), column)
  const mapping = page.locator('#smart-import select').filter({ has: page.locator('option[value="on_hand"]') }).and(page.getByRole('combobox', { name: entry.report.sheet_used + ': QOH', exact: true }))
  equal(label + ' QOH initially maps to on hand', await mapping.inputValue(), 'on_hand')
  await mapping.selectOption('')
  await page.locator('#smart-import-missing').waitFor({ state: 'visible' })
  check(label + ' ignored stock exposes missing required field', (await page.locator('#smart-import-missing').textContent()).includes('On-hand stock'))
  check(label + ' missing stock disables Use this', await page.locator('#smart-import-use').isDisabled())
  await unchanged(page, previous, label + ' broken mapping preserves existing dataset')
  await mapping.selectOption('on_hand')
  check(label + ' corrected stock enables Use this', await page.locator('#smart-import-use').isEnabled())
  check(label + ' missing warning clears after correction', !await page.locator('#smart-import-missing').isVisible())
  equal(label + ' redundant manual mapping preserves physical header', await page.locator('#smart-import-summary').textContent(),
    `${entry.report.sheet_used} · Header row ${entry.report.header_row} · ${layoutLabel(entry.report.layout)}`)
}
async function repeatAndReview(page, entry, label, previous) {
  await upload(page, path.join(fixtureRoot, entry.fixture.filename))
  await page.waitForFunction(() => document.getElementById('source-status').textContent.includes('Same layout as last time — imported automatically · '))
  check(label + ' remembered layout skips modal', !await page.locator('#smart-import').isVisible())
  const status = await page.locator('#source-status').textContent()
  check(label + ' automatic-import status and Review', status.includes('Same layout as last time — imported automatically · Review'), status)
  await imported(page, entry, label + ' remembered')
  const review = page.locator('#smart-import-review')
  check(label + ' Review is at least 44px high', await review.evaluate(element => element.getBoundingClientRect().height >= 44))
  await review.click()
  await modalContract(page, entry, label + ' retained Review', previous)
  await page.keyboard.press('Escape')
  await page.locator('#smart-import').waitFor({ state: 'hidden' })
  await unchanged(page, previous, label + ' cancel retained Review preserves dataset')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stock-runway-smart-mappings-v1')))
  check(label + ' mapping rule persisted locally', Array.isArray(saved) && saved.length === 1 && saved[0].fingerprint === entry.report.fingerprint, saved)
  const serialized = JSON.stringify(saved)
  check(label + ' remembered rule excludes product rows', entry.expected.expected_scenario.items.every(item => !serialized.includes(item.sku) && !serialized.includes(item.name)))
}
async function repeatSafety(page, entry, label, previous) {
  const original = fs.readFileSync(path.join(fixtureRoot, entry.fixture.filename), 'utf8')
  const payload = text => ({ name: entry.fixture.filename, mimeType: 'text/csv', buffer: Buffer.from(text) })
  const savedRules = () => page.evaluate(() => localStorage.getItem('stock-runway-smart-mappings-v1'))
  const saved = await savedRules()
  // Same headers, same warnings, but one product now has invalid negative stock.
  await upload(page, payload(original.replace('units,8,21,', 'units,-8,21,')))
  await page.waitForFunction(() => document.getElementById('smart-import').open || !document.getElementById('source-status').textContent.includes('Reading'))
  check(label + ' changed rows never bypass review', await page.locator('#smart-import').isVisible())
  equal(label + ' exact rejected/ready counts', await page.locator('#smart-import-ready').textContent(), '1 products ready · 1 rows set aside')
  await unchanged(page, previous, label + ' rejected repeat preserves prior products before confirmation')
  const rejects = page.locator('#smart-import details').filter({ has: page.locator('summary', { hasText: /^Rows set aside · 1$/ }) })
  await rejects.locator('summary').click()
  check(label + ' rejected row reason is readable', /Row \d+:.*(?:on.hand|negative|stock)/i.test(await rejects.innerText()), await rejects.innerText())
  equal(label + ' review does not rewrite mapping storage', await savedRules(), saved)
  await page.locator('#smart-import-use').click()
  await page.waitForFunction(() => !document.getElementById('smart-import').open && window.smartImportQA.state().count === 1)
  equal(label + ' explicit Use this accepts usable products only', (await state(page)).items.map(item => item.sku), ['A-001'])
  const accepted = await state(page)
  await upload(page, payload(original.replace('units,8,21,', 'units,-8,21,')))
  await dialog(page)
  equal(label + ' previously accepted exclusions still require review', await page.locator('#smart-import-ready').textContent(), '1 products ready · 1 rows set aside')
  await page.locator('#smart-import-cancel').click()
  await unchanged(page, accepted, label + ' cancel repeat with exclusions keeps prior data')
  // Restore a clean confirmation before checking changed defaults and warnings.
  await upload(page, payload(original))
  await page.waitForFunction(() => document.getElementById('smart-import').open || !document.getElementById('source-status').textContent.includes('Reading'))
  if (await page.locator('#smart-import').isVisible()) await page.locator('#smart-import-use').click()
  await page.waitForFunction(() => window.smartImportQA.state().count === 2 && !document.getElementById('smart-import').open)
  const clean = await state(page)
  await upload(page, payload(original.replace('units,8,21,', 'units,8,,')))
  await page.waitForFunction(() => document.getElementById('smart-import').open || !document.getElementById('source-status').textContent.includes('Reading'))
  check(label + ' changed lead-time defaults require review', await page.locator('#smart-import').isVisible())
  check(label + ' changed defaults have readable detail', /lead time blank in 1 imported rows/.test(await page.locator('#smart-import').textContent()))
  await unchanged(page, clean, label + ' changed defaults preserve current dataset')
  await page.locator('#smart-import-cancel').click()
  await upload(page, payload(original.replace('B,2,4,6', 'B,,4,6')))
  await dialog(page)
  check(label + ' changed blank-sales warning is visible', /blank sales cells treated as 0/.test(await page.locator('#smart-import').textContent()))
  await unchanged(page, clean, label + ' changed warnings preserve current dataset')
  await page.locator('#smart-import-cancel').click()
  const serialized = await savedRules()
  check(label + ' persisted rules contain neither product rows nor defaults/rejections', !/A-001|B-002|Synthetic Widget|rows_set_aside|defaulted/.test(serialized), serialized)
}
async function sourceStatusReset(page, entry, label) {
  const canonical = 'sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\nLEGACY-001,Synthetic legacy product,units,7,12,1,2,3\n'
  await upload(page, { name: 'legacy-reset.csv', mimeType: 'text/csv', buffer: Buffer.from(canonical) })
  const confirm = page.locator('#import-check')
  if (await confirm.count()) {
    await page.waitForFunction(() => document.getElementById('import-check')?.open || window.smartImportQA.state().source === 'legacy-reset.csv')
    if (await confirm.isVisible()) await confirm.getByRole('button', { name: /Use|Import/, exact: false }).click()
  }
  await page.waitForFunction(() => window.smartImportQA.state().source === 'legacy-reset.csv')
  check(label + ' legacy import clears fixed smart source bar', !await page.locator('#source-status').evaluate(element => element.classList.contains('smart-import-source')))
  check(label + ' legacy import restores status to import panel', await page.locator('#source-status').evaluate(element => element.parentElement.id === 'dropzone'))
  check(label + ' legacy import removes stale Review', await page.locator('#smart-import-review').count() === 0)
  await upload(page, path.join(fixtureRoot, entry.fixture.filename))
  await page.waitForFunction(() => document.getElementById('source-status').classList.contains('smart-import-source'))
  check(label + ' smart status restored before sample reset', await page.locator('#smart-import-review').count() === 1)
  // The premium page hides its sample button; exercise its existing reset handler.
  await page.evaluate(() => document.getElementById('sample').click())
  equal(label + ' sample reset source', (await state(page)).source, 'sample')
  check(label + ' sample reset has no fixed source bar or Review', !await page.locator('#source-status').evaluate(element => element.classList.contains('smart-import-source')) && await page.locator('#smart-import-review').count() === 0)
  check(label + ' sample reset restores status to import panel', await page.locator('#source-status').evaluate(element => element.parentElement.id === 'dropzone'))
}
async function errorContract(page, filename, payload, previous, label, message) {
  await upload(page, payload)
  await page.locator('#file-error').waitFor({ state: 'visible' })
  const text = await page.locator('#file-error').textContent()
  check(label + ' friendly error for ' + filename, message.test(text), text)
  check(label + ' previous-data assurance', /Previous data is unchanged/i.test(text), text)
  check(label + ' unusable input cannot confirm', !await page.locator('#smart-import').isVisible())
  await unchanged(page, previous, label + ' invalid input preserves exact prior dataset')
}
async function loadMatrix() {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
  check('manifest explicitly contains 15 fixtures', manifest.fixture_count === 15 && manifest.fixtures.length === 15)
  check('manifest filenames are unique', new Set(manifest.fixtures.map(fixture => fixture.filename)).size === 15)
  const source = fs.readFileSync(path.join(root, 'desktop/plugin.js'), 'utf8')
  const erp = source.match(/(?:export\s+)?const ERP_ALIASES\s*=\s*(\{[^\n]+\})/)
  assert.ok(erp, 'production ERP_ALIASES literal missing')
  const vocabulary = JSON.parse(fs.readFileSync(path.join(root, 'smart-import-vocabulary.json'), 'utf8'))
  const aliases = Object.fromEntries(Object.entries(JSON.parse(erp[1])).map(([field, labels]) => [field, [...labels, ...(vocabulary[field] || [])]]))
  const typeLiteral = source.match(/const PRODUCT_TYPE_ALIASES\s*=\s*(\[[^\n]+\])/)
  assert.ok(typeLiteral, 'production PRODUCT_TYPE_ALIASES literal missing')
  const types = JSON.parse(JSON.stringify(require('node:vm').runInNewContext(typeLiteral[1], {}, { timeout: 1000 })))
  const core = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(root, 'desktop/smart-import.js')).toString('base64'))
  return Promise.all(manifest.fixtures.map(async fixture => {
    const bytes = fs.readFileSync(path.join(fixtureRoot, fixture.filename))
    equal(fixture.filename + ' checksum', createHash('sha256').update(bytes).digest('hex'), fixture.sha256)
    const sheets = await core.readWorkbook(bytes, fixture.filename)
    const understanding = core.understandWorkbook(sheets, null, null, aliases, types)
    const expected = JSON.parse(fs.readFileSync(path.join(fixtureRoot, fixture.expected_file), 'utf8'))
    equal(fixture.filename + ' independent expected count', expected.expected_product_count, fixture.expected_product_count)
    equal(fixture.filename + ' canonical product count', understanding.canonical_rows.length - 1, fixture.expected_product_count)
    if (expected.expected_scenario) {
      equal(fixture.filename + ' independent scenario count', expected.expected_scenario.items.length, fixture.expected_product_count)
      equal(fixture.filename + ' required mappings automatic', understanding.missing, [])
    } else check(fixture.filename + ' missing product code blocks', understanding.missing.includes('Product code (SKU)'))
    return { fixture, expected, report: understanding }
  }))
}
async function main() {
  fs.mkdirSync(out, { recursive: true })
  let browser
  try {
    const completeMatrix = await loadMatrix()
    const focused = process.argv.includes('--repeat-safety')
    const matrix = focused ? completeMatrix.filter(entry => entry.fixture.filename === 'messy_title.csv') : completeMatrix
    report.focusedRepeatSafety = focused
    const bundleFile = path.join(root, 'standalone/stock-runway.html')
    const bundle = fs.readFileSync(bundleFile, 'utf8')
    report.bundleSha256 = createHash('sha256').update(bundle).digest('hex')
    report.bundleSmartImportReady = bundle.includes("dialog.id='smart-import'")
    report.expectedFixtureRuns = matrix.length * viewports.length
    if (process.argv.includes('--check')) {
      report.status = 'FIXTURE_CONTRACT_ONLY'
      report.notChecked = ['Browser UI, screenshots and all UI acceptance; run without --check after integration/build.']
      console.log(JSON.stringify({ status: report.status, fixtures: matrix.length, checks: report.checks.length, bundleSmartImportReady: report.bundleSmartImportReady, report: reportPath }, null, 2))
      return
    }
    check('built standalone contains integrated smart-import UI (build before capture)', report.bundleSmartImportReady)
    equal('standalone has exactly one application script', (bundle.match(/<\/script>/g) || []).length, 1)
    let candidate = bundle
    if (process.argv.includes('--source-ui')) {
      // Probe-only splice: never rewrites built deliverables. Parent owns final build.
      const start = candidate.indexOf('// Shared, local-only workbook review. No spreadsheet rows are persisted.')
      const tail = 'function stockImportStatus(result,file){smartImportUI.status(result,file)}'
      const end = candidate.indexOf(tail, start)
      check('source UI splice has exact build boundaries', start >= 0 && end > start)
      const ui = fs.readFileSync(path.join(root, 'standalone/design/smart-import.js'), 'utf8')
      candidate = candidate.slice(0, start) + ui + candidate.slice(end + tail.length)
      candidate = candidate.replace('</head>', '<style>' + fs.readFileSync(path.join(root, 'standalone/design/smart-import.css'), 'utf8') + '</style></head>')
      report.scope = 'Local source UI spliced into existing built standalone probe; synthetic fixtures only, HTTP(S) blocked. Not final build proof.'
      report.sourceUiSha256 = createHash('sha256').update(ui).digest('hex')
    }
    const hook = '\nwindow.smartImportQA={state:()=>({count:data.items.length,items:data.items,source:sourceName})};\n'
    const probe = path.join(out, 'smart-import-probe.html')
    fs.writeFileSync(probe, candidate.replace('</script>', hook + '</script>'))
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined })
    for (const viewport of viewports) {
      for (const entry of matrix) {
        const label = `${viewport.width} ${entry.fixture.filename}`
        const run = { viewport, fixture: entry.fixture.filename, expectedCount: entry.fixture.expected_product_count, status: 'RUNNING' }
        report.fixtureRuns.push(run)
        // Fresh contexts guarantee no remembered mapping can bypass this fixture's review.
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' })
        try {
          await context.route(/^https?:\/\//, route => { report.network.push({ fixture: label, url: route.request().url() }); return route.abort() })
          const page = await context.newPage()
          activePage = page
          page.setDefaultTimeout(10000)
          page.on('pageerror', error => report.errors.push({ fixture: label, message: String(error) }))
          page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ fixture: label, message: message.text() }) })
          await page.goto(pathToFileURL(probe).href)
          await page.waitForFunction(() => Boolean(window.smartImportQA))
          await page.evaluate(() => localStorage.clear())
          let previous = await state(page)
          if (!entry.expected.expected_scenario) {
            const seed = matrix.find(entry => entry.fixture.filename === 'wide_months.xlsx')
            await upload(page, path.join(fixtureRoot, seed.fixture.filename))
            await modalContract(page, seed, label + ' seed', previous)
            await page.locator('#smart-import-use').click()
            previous = await imported(page, seed, label + ' seed')
            await errorContract(page, entry.fixture.filename, path.join(fixtureRoot, entry.fixture.filename), previous, label, /product code|SKU/i)
            if (viewport.width === 1440) await screenshot(page, 'smart-import-error-1440.png')
            await errorContract(page, 'unsupported.xls', { name: 'unsupported.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('Synthetic legacy workbook probe; not real workbook data.') }, previous, label + ' legacy', /Save as \.xlsx or CSV/i)
            run.status = 'PASS'
            continue
          }
          await upload(page, path.join(fixtureRoot, entry.fixture.filename))
          await modalContract(page, entry, label, previous)
          if (entry.fixture.filename === 'title_rows.xlsx') {
            await screenshot(page, `smart-import-${viewport.width}.png`)
            await scrollAndReachActions(page, label, viewport)
            await page.locator('#smart-import-cancel').click()
            await page.locator('#smart-import').waitFor({ state: 'hidden' })
            await unchanged(page, previous, label + ' Cancel preserves previous dataset')
            await upload(page, path.join(fixtureRoot, entry.fixture.filename))
            await modalContract(page, entry, label + ' after Cancel', previous)
            await page.keyboard.press('Escape')
            await page.locator('#smart-import').waitFor({ state: 'hidden' })
            await unchanged(page, previous, label + ' Escape preserves previous dataset')
            await upload(page, path.join(fixtureRoot, entry.fixture.filename))
            await modalContract(page, entry, label + ' after Escape', previous)
          }
          if (entry.fixture.filename === 'fuzzy_qoh.xlsx') await mappingCorrection(page, entry, label, previous)
          await page.locator('#smart-import-use').click()
          await page.locator('#smart-import').waitFor({ state: 'hidden' })
          const current = await imported(page, entry, label)
          if (entry.fixture.filename === 'wide_months.xlsx') await repeatAndReview(page, entry, label, current)
          if (entry.fixture.filename === 'messy_title.csv') {
            await repeatSafety(page, entry, label, current)
            await sourceStatusReset(page, entry, label)
          }
          run.status = 'PASS'
        } catch (error) {
          run.status = 'FAIL'; run.error = String(error)
          if (activePage && !activePage.isClosed()) {
            run.failureScreenshot = path.join(out, `smart-import-failure-${viewport.width}-${path.parse(entry.fixture.filename).name}.png`)
            await activePage.screenshot({ path: run.failureScreenshot }).catch(() => {})
            run.domText = await activePage.locator('body').innerText().catch(() => '')
          }
          throw error
        } finally { activePage = null; await context.close() }
      }
    }
    equal('all requested fixture/viewport pairs ran', report.fixtureRuns.length, report.expectedFixtureRuns)
    equal('all fixture/viewport pairs passed', report.fixtureRuns.filter(run => run.status === 'PASS').length, report.expectedFixtureRuns)
    check('no browser exceptions', report.errors.length === 0, report.errors)
    check('no console errors', report.consoleErrors.length === 0, report.consoleErrors)
    check('no HTTP(S) network attempts', report.network.length === 0, report.network)
    if (!focused) for (const name of ['smart-import-1440.png', 'smart-import-390.png', 'smart-import-error-1440.png']) check(name + ' captured', report.screenshots.includes(path.join(out, name)))
    report.status = 'PASS'
    console.log(JSON.stringify({ status: report.status, fixtureRuns: report.fixtureRuns.length, checks: report.checks.length, screenshots: report.screenshots, report: reportPath }, null, 2))
  } catch (error) {
    report.status = 'FAIL'; report.failure = { message: String(error), stack: error.stack }
    throw error
  } finally {
    if (browser) await browser.close().catch(error => { report.status = 'FAIL'; report.errors.push({ message: String(error) }); process.exitCode = 1 })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
