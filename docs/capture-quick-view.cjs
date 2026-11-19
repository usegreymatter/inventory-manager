// Lifecycle: living. Offline SDK-shim proof, not a real Desktop integration test.
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE to an existing local module; no installs.')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const env = { ...process.env }; delete env.PYTHONPATH
const tool = spawnSync(process.env.PYTHON || 'python3', ['-c', `import sys,types,pathlib,json
pkg=types.ModuleType('stock_runway');pkg.__path__=[str(pathlib.Path.cwd())];sys.modules['stock_runway']=pkg
from stock_runway.tools import make_handler
print(json.loads(make_handler()({}))['card'])`], { env, encoding: 'utf8' })
assert.equal(tool.status, 0, tool.stderr)
const line = tool.stdout.trim()
assert.ok(line.length <= 1900)
const many = spawnSync(process.env.PYTHON || 'python3', ['-c', `import sys,types,pathlib,json
pkg=types.ModuleType('stock_runway');pkg.__path__=[str(pathlib.Path.cwd())];sys.modules['stock_runway']=pkg
from stock_runway import tools
data=tools.load_sample(None)
data['items']=[dict(data['items'][i%5],sku=f'ITEM-{i:03d}') for i in range(100)]
tools.load_sample=lambda _:data
print(json.loads(tools.make_handler()({}))['card'])`], { env, encoding: 'utf8' })
assert.equal(many.status, 0, many.stderr)
const largeLine = many.stdout.trim()
assert.ok(largeLine.length <= 1900)
const largeData = JSON.parse(Buffer.from(/^::stock-runway\{data="([A-Za-z0-9_-]+)"\}$/.exec(largeLine)[1], 'base64url').toString('utf8'))
assert.ok(largeData.more > 0)
assert.equal(largeData.rows.length + largeData.more, 100)
;(async () => {
  fs.mkdirSync('.scratch/quick-view-screens', {recursive:true})
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--disable-background-networking', '--disable-telemetry'] })
  const findings = []
  try {
    for (const width of [360, 390, 1440]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(/^https?:/, route => route.abort())
      await context.addInitScript(card => { window.stockRunwayCard = card }, line)
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
      page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
      const url = pathToFileURL(path.resolve('docs/harness.html')).href + `?theme=${theme}`
      await page.goto(url + '#card')
      await page.waitForFunction(() => window.runwayDialogHostReady === true)
      await page.getByRole('table').waitFor()
      assert.equal(await page.getByRole('row').count(), 6)
      assert.ok((await page.getByRole('row').nth(1).innerText()).includes('UL-FOAM-GRN'))
      assert.ok((await page.getByRole('row').nth(1).innerText()).includes('Nov 2026'))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: `.scratch/quick-view-screens/card-${width}-${theme}.png`, fullPage: true })
      // Same registered shortcut works with no plugin page mounted.
      await page.keyboard.press('Meta+Shift+i')
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert.equal(await dialog.getByRole('row').count(), 6)
      const bounds = await dialog.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
      const region = dialog.getByRole('region')
      await region.evaluate(element => { element.scrollLeft = element.scrollWidth })
      assert.ok((await region.innerText()).includes('Usable for planning'))
      await region.evaluate(element => { element.scrollLeft = 0 })
      await page.screenshot({ path: `.scratch/quick-view-screens/popup-${width}-${theme}.png`, fullPage: true })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Stock Runway: quick view', exact: true }).click()
      await dialog.waitFor()
      await dialog.getByRole('button', { name: 'Open full page', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.getByRole('heading', { name: 'Stock Runway', exact: true }).waitFor()
      await page.getByRole('button', { name: 'My file (CSV)', exact: true }).click()
      await page.locator('input[type=file]').setInputFiles({ name: 'fake.csv', mimeType: 'text/csv',
        buffer: Buffer.from('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nFAKE,Fake item,ea,5,3,10,10,10\n') })
      await page.getByRole('heading', { name: 'Fake item · SKU FAKE', exact: true }).waitFor()
      await page.getByRole('combobox', { name: 'Look ahead', exact: true }).selectOption('4')
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      await page.getByRole('heading', { name: 'Stock Runway settings', exact: true }).waitFor()
      assert.equal(await page.getByRole('combobox', { name: 'Default forecast horizon', exact: true }).count(), 1)
      assert.equal(await page.getByRole('combobox', { name: 'Look ahead', exact: true }).count(), 0)
      await page.keyboard.press('Meta+Shift+i')
      await dialog.waitFor()
      assert.equal(await dialog.getByRole('row').count(), 2)
      assert.ok((await dialog.innerText()).includes('Fake item'))
      assert.ok((await dialog.innerText()).includes('4-month horizon'))
      await page.keyboard.press('Escape')
      await page.reload()
      await page.getByRole('heading', { name: 'Stock Runway settings', exact: true }).waitFor({ state: 'visible' })
      await page.waitForFunction(() => window.runwayDialogHostReady === true)
      await page.keyboard.press('Meta+Shift+i')
      await dialog.waitFor()
      assert.ok((await dialog.innerText()).includes('Fake item'), 'CSV survives reload')
      await page.keyboard.press('Escape')
      // The statusbar can disappear; the titlebar host must keep working.
      for (const shell of ['hidden', 'simple']) {
        await page.evaluate(mode => {
          window.runwayShell.setStatusbarVisible(mode !== 'hidden')
          window.runwayShell.setSimple(mode === 'simple')
        }, shell)
        await page.locator('.status-bar').waitFor({ state: 'detached' })
        await page.keyboard.press('Meta+Shift+i')
        await dialog.waitFor()
        assert.ok((await dialog.innerText()).includes('Fake item'))
        await page.keyboard.press('Escape')
      }
      // Chrome-owning pages may omit even the titlebar. Clear old open state,
      // and never queue an invisible open which appears when returning.
      await page.keyboard.press('Meta+Shift+i')
      await dialog.waitFor()
      await page.evaluate(() => window.runwayShell.setTitlebarVisible(false))
      await dialog.waitFor({ state: 'detached' })
      await page.keyboard.press('Meta+Shift+i')
      await page.evaluate(() => window.runwayShell.setTitlebarVisible(true))
      await page.waitForTimeout(50)
      assert.equal(await dialog.count(), 0)
      await page.keyboard.press('Meta+Shift+i')
      await dialog.waitFor()
      assert.equal(await dialog.getByRole('button', { name: /more, open full page/ }).count(), 0, 'dialog has one full-page button, not two')
      assert.equal(await dialog.getByRole('button', { name: 'Open full page', exact: true }).count(), 1)
      await page.keyboard.press('Escape')
      await page.evaluate(card => { window.stockRunwayCard = card; location.hash = '#card' }, largeLine)
      const more = page.getByRole('button', { name: `+${largeData.more} more, open full page`, exact: true })
      await more.waitFor()
      assert.equal(await page.getByRole('row').count(), largeData.rows.length + 1)
      await more.click()
      await page.getByRole('heading', { name: 'Stock Runway', exact: true }).waitFor()
      assert.deepEqual(errors, [])
      findings.push({ width, theme, rows: 5, popupAndCard: true, pageOverflow: false,
        shortcutOffRoute: true, hiddenStatusbar: true, simpleMode: true, staleOpenCleared: true, moreNavigation: true,
        escape: true, fullPage: true, persistedCsv: true, consoleErrors: errors.length })
      await context.close()
    }
    fs.writeFileSync('.scratch/quick-view-screens/report.json', JSON.stringify({caption:'Offline local SDK harness only',findings},null,2))
    console.log(JSON.stringify({ label: 'Harness, not the real app', cardLineChars: line.length, truncatedCardChars: largeLine.length, truncatedCardRows: largeData.rows.length, more: largeData.more, findings }, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
