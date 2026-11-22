// Lifecycle: living. Regenerates the README worklist screenshots (light + dark) from the offline demo page.
// Usage: PLAYWRIGHT_MODULE=/path/to/playwright/index.js [CHROMIUM_EXECUTABLE=/path/to/chrome] node docs/capture-readme.cjs
'use strict'
const path = require('node:path'), fs = require('node:fs'), { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/img')
const page_url = pathToFileURL(path.join(root, 'standalone/inventory-manager.html')).href
;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined })
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme, deviceScaleFactor: 1 })
      await context.route(/^(?!file:|data:|blob:)/, route => route.abort()) // offline: block any network
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date('2026-11-12T09:00:00'))
      await page.goto(page_url)
      await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t) }, theme)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(300)
      const file = path.join(out, `worklist-${theme}.png`)
      await page.screenshot({ path: file })
      console.log(file, fs.statSync(file).size)
      await context.close()
    }
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exit(1) })
