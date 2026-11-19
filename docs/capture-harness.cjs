// Lifecycle: living. Existing local Playwright only, disposable offline Chromium.
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const playwrightPath = process.env.PLAYWRIGHT_MODULE
if (!playwrightPath) throw Error('Set PLAYWRIGHT_MODULE to an existing local playwright module.')
const { chromium } = require(playwrightPath)
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--disable-background-networking', '--disable-telemetry'] })
  try {
    const findings = []
    for (const width of [360, 1440]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 1100 } })
        await context.route(/^https?:/, route => route.abort())
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href + `?theme=${theme}`)
        await page.getByRole('heading', { name: 'Stock Runway', exact: true }).waitFor()
        await page.getByRole('img').waitFor()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        const body = await page.locator('body').innerText()
        assert.ok(!/undefined|NaN|\[object Object\]/.test(body))
        assert.ok(body.includes('How good is this forecast?'))
        assert.ok(body.includes('Nov 2026'))
        await page.screenshot({ path: `docs/history/screens/harness-${width}-${theme}.png`, fullPage: true })
        await page.getByRole('button', { name: 'SEAL-CLR-300', exact: false }).click()
        assert.ok((await page.locator('body').innerText()).includes('Mar 2027'))
        await page.getByRole('button', { name: 'My CSV', exact: true }).click()
        await page.locator('input[type=file]').setInputFiles({ name: 'fake.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nFAKE,Fake item,ea,5,3,10,10,10\n') })
        await page.getByRole('heading', { name: 'Fake item' }).waitFor()
        assert.ok((await page.locator('body').innerText()).includes('2026-11-12'))
        await page.locator('input[type=file]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('bad') })
        await page.getByRole('alert').waitFor()
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        await page.getByRole('combobox').selectOption('9')
        await page.getByRole('link', { name: 'Forecast', exact: true }).click()
        assert.equal(await page.getByRole('combobox').inputValue(), '9')
        assert.deepEqual(errors, [])
        findings.push({ width, theme, pageOverflow: false, consoleErrors: errors.length, csv: 'valid and invalid tested', settings: 'persisted 9-month default' })
        await context.close()
      }
    }
    console.log(JSON.stringify({ label: 'Harness, not the real app', findings }, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
