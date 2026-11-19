// Lifecycle: living. Offline built-in-sample acceptance for the large Arctic chart.
// Run from repo root: TMPDIR=$PWD/.scratch node standalone/capture-chart.cjs
// Optional --target standalone/design/option-gm-b.html; default is the portable build.
// Writes only ignored .scratch/chart evidence; never builds, installs, or contacts a server.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {pathToFileURL} = require('node:url')
const root = path.resolve(__dirname, '..')
const out = path.join(root, '.scratch/chart')
const args = process.argv.slice(2)
if (args.length && !(args.length === 2 && args[0] === '--target')) throw Error('Usage: node standalone/capture-chart.cjs [--target local-html]')
const target = path.resolve(root, args[1] || 'standalone/stock-runway.html')
if (!target.startsWith(root + path.sep) || !target.endsWith('.html')) throw Error('Target must be repo-local HTML')
const frozenDate = '2026-11-15T12:00:00Z'
const activeRoot = 'body:not(:has(#product-page)) #main, body:not(.chart-focused) #product-page, .chart-focus'
const chart = ':is('+activeRoot+') .chart-wrap svg[data-chart]'
const dialog = '.chart-focus[role="dialog"]'
const sha = content => crypto.createHash('sha256').update(content).digest('hex')
const report = {status:'RUNNING', target, frozenDate, offline:true, checks:[], stages:[], geometry:[], tooltips:[], days:[], screenshots:[], errors:[], network:[], not_checked:['Physical phones, Safari/Firefox, visual/aesthetic approval, live/hosted data, CSV/settings/forecast-engine regression suites.']}
const check = (name, pass, evidence) => {
  report.checks.push({name, pass:Boolean(pass), evidence})
  if (!pass) console.error('FAIL: ' + name)
  return Boolean(pass)
}
async function stage(name, fn) {
  try { await fn(); report.stages.push({name, completed:true}) }
  catch (error) {
    report.stages.push({name, completed:false, error:error.stack || String(error)})
    check(name + ': interaction completed', false, error.message)
  }
}
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}
// Full-page reports use a fixed 380px desktop / 360px phone chart canvas;
// graph-only focus reserves room for navigation, model controls and legends.
// Read-only exports from the module's lexical scope. No fixture, row, date,
// chart method or event handler is changed by the injected probe.
const hooks = `\nwindow.chartQA = {
  state: () => ({source:sourceName, snapshot:data.as_of, today:currentToday, sku:selectedSku,
    drawer:wl.drawer, skus:filteredRows.map(r=>r.item.sku),
    rows:currentRows.map(r=>({sku:r.item.sku,name:r.item.name,unit:r.item.unit,
      days:wlMeta(r).days,runout:r.guidance.runout_date,itemRunout:r.item.runout_day,
      relative:r.item.runout_day?gmRelative(r.item.runout_day):null,formattedRunout:r.guidance.runout_date?gmDate(r.guidance.runout_date):'Not forecast'}))}),
  series: () => {const r=rowMap.get(selectedSku),s=seriesFor(r.item);
    return {sku:r.item.sku,n:s.n,timeline:s.timeline.map((v,i)=>{
      const stock=i<s.n?s.history.rows[i]?.stock:Math.max(0,s.rows[i-s.n].stock);
      return {...v,index:i,label:label(v.month),stock,
        demandText:orderAmount(Math.round(v.demand)),stockText:stock==null?STRINGS.unknown:orderAmount(Math.round(stock)),
        receiptsText:orderAmount(v.receipts||0)};
    })};}
};\n`
function makeProbe() {
  const html = fs.readFileSync(target, 'utf8')
  report.source = {sha256:sha(html), bytes:Buffer.byteLength(html)}
  report.harness_sha256 = sha(fs.readFileSync(__filename))
  const re = /(<script\b[^>]*\bid=["']runway-app["'][^>]*>)([\s\S]*?)(<\/script>)/i
  if (!re.test(html)) throw Error('Expected single runway-app script injection point')
  const probe = path.join(out, 'probe.html')
  // Replacement callback preserves literal dollar tokens in the embedded source.
  fs.writeFileSync(probe, html.replace(re, (_, open, code, close) => open + code + hooks + close))
  report.probe = {path:probe, sha256:sha(fs.readFileSync(probe)), injection:'read-only window.chartQA at end of #runway-app'}
  return probe
}
async function geometry(page, label, focus, phone) {
  const g = await page.evaluate(({chart,dialog,focus}) => {
    const rect = e => {if(!e)return null; const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
    const svg=document.querySelector(chart), lines=[...svg.querySelectorAll('[data-gridline]')]
    const points=lines.flatMap(e=>{const matrix=e.getScreenCTM();return [new DOMPoint(Number(e.getAttribute('x1')),Number(e.getAttribute('y1'))).matrixTransform(matrix),new DOMPoint(Number(e.getAttribute('x2')),Number(e.getAttribute('y2'))).matrixTransform(matrix)]})
    const plot=points.length?{left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))}:null
    if(plot){plot.width=plot.right-plot.left;plot.height=plot.bottom-plot.top}
    const main=document.querySelector('#product-page'), nav=document.querySelector('.product-page-nav'), name=document.querySelector('.product-page-heading h1'), keyline=document.querySelector('.product-page-figures')
    const visible=e=>{if(!e||!e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0}
    return {viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,
      svg:rect(svg),svgPainted:visible(svg),plot,gridlines:lines.length,
      main:rect(main),nav:rect(nav),header:rect(name),keyline:rect(keyline),headerVisible:visible(name),keylineVisible:visible(keyline),
      focus:rect(document.querySelector(dialog)),focusVisible:visible(document.querySelector(dialog)),
      workScroll:{client:main.clientWidth,scroll:main.scrollWidth},chartCount:document.querySelectorAll(chart).length,
      figureInFocus:focus&&Boolean(svg.closest(dialog))}
  }, {chart,dialog,focus})
  report.geometry.push({label,...g})
  check(label + ': one painted SVG', g.svgPainted && g.chartCount === 1, {count:g.chartCount,svg:g.svg})
  check(label + ': no page horizontal overflow', g.pageWidth <= g.viewport.width, g.pageWidth)
  check(label + ': plot geometry measured from actual SVG gridlines', Boolean(g.plot) && g.gridlines >= 2, g.plot)
  if (focus) {
    check(label + ': visible focus dialog owns chart', g.focusVisible && g.figureInFocus, g.focus)
    check(label + ': focus plot >=80% viewport width and >=65% height', g.plot && g.plot.width >= .8*g.viewport.width && g.plot.height >= .65*g.viewport.height, g.plot)
    check(label + ': focus plot fully inside viewport', g.plot && g.plot.left >= -1 && g.plot.top >= 0 && g.plot.right <= g.viewport.width+1 && g.plot.bottom <= g.viewport.height+1, g.plot)
  } else {
    if (!phone) {
      check(label + ': full-page chart has 380px reading canvas', g.svg && g.svg.height >= 380 && g.plot.height > 200, {svg:g.svg,plot:g.plot})
      check(label + ': full product page has no horizontal overflow', g.workScroll.scroll <= g.workScroll.client+1, g.workScroll)
    }
    check(label + ': compact product header visible below navigation', g.headerVisible && g.header && g.header.top >= g.nav.bottom-1 && g.header.bottom <= g.viewport.height && g.header.left >= 0 && g.header.right <= g.viewport.width+1, {header:g.header,nav:g.nav})
    check(label + ': order figures visible above plot', g.keylineVisible && g.keyline && g.plot && g.keyline.top >= g.nav.bottom-1 && g.keyline.bottom <= g.plot.top && g.keyline.bottom <= g.viewport.height, g.keyline)
  }
  return g
}
async function screenshot(page, name, viewport) {
  await settle(page)
  await page.mouse.move(0, 0)
  const before = await page.evaluate(() => ({x:scrollX,y:scrollY,main:document.querySelector('#main').scrollTop}))
  const file = path.join(out, name)
  await page.screenshot({path:file, fullPage:false, animations:'disabled', scale:'css'})
  const bytes = fs.readFileSync(file)
  const after = await page.evaluate(() => ({x:scrollX,y:scrollY,main:document.querySelector('#main').scrollTop}))
  const dimensions = {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}
  report.screenshots.push({path:file,bytes:bytes.length,sha256:sha(bytes),...dimensions})
  check(name + ': exact viewport PNG without auto-scroll', dimensions.width === viewport.width && dimensions.height === viewport.height && JSON.stringify(before) === JSON.stringify(after), {dimensions,before,after})
}
async function selectProduct(page, sku) {
  const button = page.locator(`.work-row[data-sku="${sku}"] .work-product`)
  await page.evaluate(()=>localStorage.removeItem('stock-runway.product-view'));await button.click()
  await page.locator('#product-page').waitFor({state:'visible'});await page.waitForFunction(sku=>chartQA.state().sku===sku,sku);check('product click uses full-page default',await page.locator('#main').isHidden())
  await settle(page)
}
async function daysAgreement(page, row, label) {
  const result = await page.evaluate(sku => {
    const state=chartQA.state(),r=state.rows.find(r=>r.sku===sku)
    const table=document.querySelector('.work-row[data-sku="'+sku+'"] [data-column="days"]')
    return {...r,snapshot:state.snapshot,today:state.today,table:table?.textContent.trim(),header:document.querySelector('.product-page-heading h1')?.textContent.trim(),keyline:document.querySelector('.chart-keyline')?.textContent.trim(),relative:[...document.querySelectorAll('#main .date-relative')].map(e=>e.textContent.trim()),productRunout:document.querySelector('.product-page-figures>div:last-child strong')?.textContent.trim(),formattedRunout:r.formattedRunout}
  }, row.sku)
  // Independent snapshot-day oracle catches the former currentToday/table vs
  // data.as_of/product mismatch. Never manufacture a runout when engine has none.
  const expected = result.runout ? Math.round((Date.parse(result.runout+'T12:00:00Z')-Date.parse(result.snapshot+'T12:00:00Z'))/86400000) : null
  const tableDays = result.table === '—' ? null : /Overdue/.test(result.table||'') ? -Number(result.table.match(/\d+/)?.[0]) : Number(result.table)
  report.days.push({label,expected,...result})
  check(label + ': table days equal snapshot-relative engine runout', result.days === expected && tableDays === expected, {expected,tableDays,...result})
  check(label + ': compact header identifies selected product', Boolean(result.header) && result.header.includes(row.name), result.header)
  if (expected !== null) {
    const text = [result.productRunout,...result.relative].filter(Boolean).join(' | ')
    check(label + ': visible product runout equals same engine date as table', result.productRunout===result.formattedRunout, {expected,keyline:result.keyline,allRelative:text})
    check(label + ': physical item and guidance runout agree', result.itemRunout === result.runout, {item:result.itemRunout,guidance:result.runout})
  } else {
    check(label + ': missing runout is not a fabricated day count', !/\b\d+\s*days?\b/i.test(result.keyline||''), result.keyline)
  }
}
function hasValue(text, expected) {
  // Compare the complete formatted value, never a substring (5 must not match 50).
  const esc = String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(?<![\\d.,])'+esc+'(?![\\d.,])').test(text)
}
async function tooltip(page, label, series, month, receipt, phone) {
  // A real redraw dismisses the previous tip before hit testing; pointerleave is
  // not guaranteed to dismiss a touch-pinned tooltip. Never tap through a tip.
  await page.locator(':is('+activeRoot+') [data-zoom="all"]').click()
  await settle(page)
  await page.mouse.move(0, 0)
  const selector = receipt ? `[data-delivery-marker][data-month="${month.month}"]` : `[data-period][data-month="${month.month}"]`
  const point = await page.locator(chart).evaluate((svg, {selector,receipt}) => {
    const mark=svg.querySelector(selector);if(!mark)return null
    const matrix=mark.getScreenCTM()
    let x,y
    if(receipt){x=Number(mark.getAttribute('cx'));y=Number(mark.getAttribute('cy'))}
    else {
      x=Number(mark.getAttribute('x'))+Number(mark.getAttribute('width'))/2
      const lines=[...svg.querySelectorAll('[data-gridline]')],ys=lines.map(e=>Number(e.getAttribute('y1')))
      // Receipt hit areas are deliberately large on touch. Find an ordinary
      // plot point in this same month, not the neighbouring receipt's hit area.
      let best=-Infinity
      const markers=[...svg.querySelectorAll('[data-delivery-marker]')].map(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy')),r:Number(e.getAttribute('r'))}))
      for(const fraction of [.35,.12,.6,.85,.02,.98]){
        const candidate=Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*fraction
        const p=new DOMPoint(x,candidate).matrixTransform(matrix),hit=document.elementFromPoint(p.x,p.y)
        const clearance=markers.length?Math.min(...markers.map(m=>Math.hypot(m.x-x,m.y-candidate)-m.r)):Infinity
        // Maximise clearance as Chromium also does touch-target adjustment near
        // interactive receipt markers, beyond the exact elementFromPoint pixel.
        if(hit&&svg.closest('.chart-wrap').contains(hit)&&!hit.closest('[data-delivery-marker]')&&clearance>best){y=candidate;best=clearance}
      }
      if(y===undefined)return null
    }
    const p=new DOMPoint(x,y).matrixTransform(matrix)
    const hit=document.elementFromPoint(p.x,p.y)
    return {x:p.x,y:p.y,hit:receipt?(hit===mark||mark.contains(hit)):Boolean(hit&&svg.closest('.chart-wrap').contains(hit))}
  }, {selector,receipt})
  if (!check(label + ': native tooltip target hit-testable', point && point.hit && point.x >= 0 && point.y >= 0, point)) return
  if (phone) await page.touchscreen.tap(point.x, point.y)
  else await page.mouse.move(point.x, point.y)
  await page.locator(':is('+activeRoot+') .chart-tooltip:not([hidden])').waitFor({state:'visible'})
  const actual = await page.locator(':is('+activeRoot+') .chart-tooltip:not([hidden])').evaluate(e => {
    const r=e.getBoundingClientRect()
    return {text:e.innerText,children:[...e.children].map(c=>c.innerText),index:e.getAttribute('data-tooltip-index'),box:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},width:innerWidth,height:innerHeight}
  })
  const index = actual.index === null ? series.timeline.findIndex(r => actual.children[0] === r.label) : Number(actual.index)
  const expected = series.timeline[index]
  report.tooltips.push({label,gesture:phone?'native touch tap':'native mouse hover',receipt,requested:month.month,expected,actual})
  check(label + ': tooltip identifies requested underlying-series month', Boolean(expected) && expected.month === month.month && actual.text.includes(month.label), {index,month:month.month,text:actual.text})
  check(label + ': tooltip fully inside viewport', actual.box.left >= 0 && actual.box.top >= 0 && actual.box.right <= actual.width+1 && actual.box.bottom <= actual.height+1, actual.box)
  if (receipt) {
    const line = actual.children.find(s => /receiv|receipt|deliver|expected|arriv/i.test(s)) || ''
    check(label + ': receipt DOM text equals a2Series monthly total', hasValue(line, month.receiptsText), {expected:month.receipts,formatted:month.receiptsText,line})
    check(label + ': monthly receipt does not fabricate exact day', /month|exact.*date.*unavailable/i.test(actual.text), actual.text)
    const demand = actual.children.find(s => /demand|forecast/i.test(s)) || ''
    const stock = actual.children.find(s => /stock/i.test(s)) || ''
    check(label + ': receipt tooltip retains exact monthly demand and stock', hasValue(demand, month.demandText) && hasValue(stock, month.stockText), {demand,stock,expected:month})
    await page.locator(chart+' '+selector).focus()
    for(const key of ['Enter','Space']){
      await page.keyboard.press(key)
      check(label+': receipt '+key+' retains complete tooltip', await page.locator(':is('+activeRoot+') .chart-tooltip:not([hidden])').innerText()===actual.text)
    }
  } else {
    const demand = actual.children.find(s => /demand|forecast/i.test(s)) || ''
    const stock = actual.children.find(s => /stock/i.test(s)) || ''
    check(label + ': demand DOM text equals a2Series month', hasValue(demand, month.demandText), {expected:month.demand,formatted:month.demandText,line:demand})
    check(label + ': stock DOM text equals a2Series history/projection', hasValue(stock, month.stockText), {expected:month.stock,formatted:month.stockText,line:stock})
    const receiptLine = actual.children.find(s => /receiv|receipt|deliver|expected|arriv/i.test(s))
    if (receiptLine) check(label + ': combined receipt DOM text equals a2Series month', hasValue(receiptLine, month.receiptsText), {expected:month.receipts,line:receiptLine})
  }
  // Escape is tested separately as focus close. Dismiss this tooltip with actual
  // pointer movement so a tooltip Escape handler cannot mask the focus test.
  await page.mouse.move(0, 0)
}
async function tooltips(page, label, phone) {
  await page.locator(chart).scrollIntoViewIfNeeded()
  await page.locator(':is('+activeRoot+') [data-zoom="all"]').click()
  await settle(page)
  const series = await page.evaluate(() => chartQA.series())
  const months = await page.locator(chart+' [data-period]').evaluateAll(es => es.map(e => e.dataset.month))
  const visible = series.timeline.filter(r => months.includes(r.month))
  check(label + ': all underlying months represented', visible.length === series.timeline.length && visible.length > 0, {drawn:months.length,series:series.timeline.length})
  const historical = visible.find(r => r.past)
  const forecast = visible.find(r => !r.past)
  const received = visible.find(r => r.receipts > 0)
  if (historical) await stage(label+' historical tooltip', () => tooltip(page,label+' history',series,historical,false,phone))
  if (forecast) await stage(label+' forecast tooltip', () => tooltip(page,label+' forecast',series,forecast,false,phone))
  check(label + ': sample includes a real receipt month', Boolean(received), series.sku)
  if (received) await stage(label+' receipt tooltip', () => tooltip(page,label+' receipt',series,received,true,phone))
  await page.locator(':is('+activeRoot+') [data-zoom="12"]').click()
  await settle(page)
}
async function focusOpen(page, label, keyboard) {
  if(!await page.locator('#product-page').count()){await page.locator('#main .chart-expand').click();await page.locator('#product-page').waitFor({state:'visible'})}
  await page.evaluate(() => {window.chartQAOriginalFigure=document.querySelector('#product-page figure');window.chartQAOriginalWrap=document.querySelector('#product-page .chart-wrap')})
  if (keyboard) {
    await page.locator(chart).focus()
    await page.keyboard.press('f')
    await settle(page)
    check(label+': f shortcut opens chart focus',await page.locator(dialog).count()===1)
    // Preserve the shortcut failure, but finish the remaining focus/modal checks.
    if(!await page.locator(dialog).count()){await page.locator('#product-page .chart-expand').focus();await page.keyboard.press('Enter')}
  } else await page.locator('#product-page').getByRole('button', {name:'Expand chart',exact:true}).click()
  await page.locator(dialog).waitFor({state:'visible'})
  await settle(page)
  check(label + ': same figure and chart wrapper moved, not cloned', await page.evaluate(dialog => {
    const focus=document.querySelector(dialog)
    return focus.contains(window.chartQAOriginalFigure)&&focus.contains(window.chartQAOriginalWrap)&&[...document.querySelectorAll('.chart-wrap')].filter(e=>!e.closest('[inert]')).length===1
  }, dialog))
}
async function focusJourney(page, viewport, label, phone) {
  const before = await page.evaluate(() => chartQA.state())
  await focusOpen(page,label+' expand click',false)
  await geometry(page,label+' focus',true,phone)
  await screenshot(page,phone?'phone-focus.png':viewport.width===1457?'focus-1457.png':'focus-1440.png',viewport)
  await stage(label+' focus tooltip values', () => tooltips(page,label+' focus',phone))
  // Real swipe routes through the shared chart's pointer handlers, not buttons.
  for(const delta of [1,-1]){
    const box=await page.locator('.chart-focus .chart-wrap').boundingBox(),y=box.y+box.height*.4
    const start=box.x+box.width*(delta===1?.7:.2),end=box.x+box.width*(delta===1?.2:.7)
    if(phone){
      const session=await page.context().newCDPSession(page)
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]})
      for(let i=1;i<=8;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/8,y}]})
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach()
    }else{await page.mouse.move(start,y);await page.mouse.down();await page.mouse.move(end,y,{steps:8});await page.mouse.up()}
    await settle(page)
    const actual=await page.locator(dialog).evaluate(el=>({sku:el.querySelector('figure').chartRow.item.sku,name:el.querySelector('h2').textContent,counter:el.querySelector('nav span').textContent,count:[...document.querySelectorAll('.chart-wrap')].filter(e=>!e.closest('[inert]')).length}))
    const expected=before.skus[delta===1?1:0],state=await page.evaluate(()=>chartQA.state())
    check(label+': native swipe '+delta+' keeps selected product, figure, name and counter synchronized',state.sku===expected&&actual.sku===expected&&actual.name===state.rows.find(r=>r.sku===expected).name&&actual.counter===(delta===1?'2':'1')+' / '+before.skus.length&&actual.count===1,actual)
  }
  // Button navigation is against actual filtered-table ordering, not a guessed SKU.
  await page.locator('#focus-next').click();await settle(page)
  let state = await page.evaluate(() => chartQA.state())
  check(label + ': focus next changes selected table product', state.sku === before.skus[before.skus.indexOf(before.sku)+1] && await page.locator(dialog).isVisible(), {before:before.sku,after:state.sku,order:before.skus})
  await page.locator('#focus-prev').click();await settle(page)
  state = await page.evaluate(() => chartQA.state())
  check(label + ': focus prev reverses selection', state.sku === before.sku && await page.locator(dialog).isVisible(), state.sku)
  // Every sample must fit and retain exact tooltip values in focus, too.
  for(let i=1;i<before.skus.length;i++){
    await page.locator('#focus-next').click();await settle(page)
    const current=await page.evaluate(()=>chartQA.state())
    check(label+': focus visits sample '+i,current.sku===before.skus[i],current.sku)
    await geometry(page,label+' '+current.sku+' focus',true,phone)
    await stage(label+' '+current.sku+' focus tooltip values',()=>tooltips(page,label+' '+current.sku+' focus',phone))
  }
  for(let i=before.skus.length-2;i>=0;i--){
    await page.locator('#focus-prev').click();await settle(page)
    check(label+': focus reverse visits sample '+i,(await page.evaluate(()=>chartQA.state())).sku===before.skus[i])
  }
  await page.keyboard.press('Escape');await settle(page)
  check(label + ': Escape closes focus only, retaining product page', await page.locator(dialog).isHidden() && await page.locator('#product-page').isVisible())
  check(label + ': chart returned to product page once', await page.locator('#product-page .chart-wrap').count() === 1 && await page.locator(chart).count() === 1)
  await focusOpen(page,label+' keyboard expansion',true)
  check(label + ': keyboard expansion opens chart focus', await page.locator(dialog).isVisible())
  await page.locator('#focus-close').click();await settle(page)
  check(label + ': focus close restores product page chart', await page.locator(dialog).isHidden() && await page.locator('#product-page .chart-wrap').count() === 1)
  await page.getByRole('button',{name:'Change settings for this product',exact:true}).click()
  await page.locator('#settings-sheet[open]').waitFor({state:'visible'})
  await page.locator('#settings-sheet button:visible').first().focus()
  await page.keyboard.press('f');await settle(page)
  check(label+': f respects open settings modal without inert deadlock',await page.locator(dialog).count()===0&&await page.locator('#settings-sheet[open]').evaluate(e=>!e.inert))
  await page.keyboard.press('Escape');await settle(page)
  check(label+': settings modal remains dismissible after f',await page.locator('#settings-sheet[open]').count()===0&&await page.locator('#product-page').evaluate(e=>!e.inert))
}
async function main() {
  fs.mkdirSync(out,{recursive:true})
  let browser
  try {
    const probe=makeProbe()
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
    const executablePath=process.env.CHROMIUM_EXECUTABLE||undefined
    browser=await chromium.launch({headless:true,executablePath,timeout:20000})
    report.browser={version:browser.version(),executablePath}
    for (const viewport of [{width:1457,height:777},{width:1440,height:900},{width:390,height:844}]) {
      const label=`${viewport.width}x${viewport.height}`,phone=viewport.width===390
      const context=await browser.newContext({viewport,deviceScaleFactor:1,isMobile:phone,hasTouch:phone,offline:true,serviceWorkers:'block',reducedMotion:'reduce',colorScheme:'light',timezoneId:'Asia/Kuwait'})
      await context.route('**/*',r=>{
        if (/^(?:file|data|blob):/.test(r.request().url())) return r.continue()
        report.network.push(r.request().url());return r.abort('internetdisconnected')
      })
      await context.addInitScript(fixed=>{
        const D=Date,time=new D(fixed).getTime()
        window.Date=class extends D {constructor(...args){super(...(args.length?args:[time]))}static now(){return time}}
      },frozenDate)
      const page=await context.newPage();page.setDefaultTimeout(2500)
      page.on('pageerror',e=>report.errors.push({label,error:String(e)}))
      await stage(label+' acceptance',async()=>{
        await page.goto(pathToFileURL(probe).href,{waitUntil:'load',timeout:10000})
        await page.waitForFunction(()=>Boolean(window.chartQA));await page.locator('[data-view=all]').click();await page.locator('#work-view>summary').click();await page.locator('[data-density=detailed]').click();await page.locator('#column-customize>summary').click();await page.locator('#column-customize label').filter({hasText:'Days left'}).locator('input').check();await page.keyboard.press('Escape');await page.keyboard.press('Escape')
        const state=await page.evaluate(()=>chartQA.state())
        check(label+': all five built-in samples, frozen decision date',state.source==='sample'&&state.rows.length===5&&state.skus.length===5&&state.today==='2026-11-15',state)
        for (const sku of state.skus) await stage(label+' '+sku+' product',async()=>{
          const row=state.rows.find(r=>r.sku===sku)
          await selectProduct(page,sku)
          await daysAgreement(page,row,label+' '+sku)
          await geometry(page,label+' '+sku+' product',false,phone)
          // Graph-only expansion is explicit on the product page; native touch
          // tooltips are exercised there, then Escape restores the product.
          if(phone)await focusOpen(page,label+' '+sku+' phone expansion',false)
          await tooltips(page,label+' '+sku+' product'+(phone?' touch-focus':''),phone)
          if(phone)await page.locator('#focus-close').click()
          await page.locator('#product-page-close').click();await page.locator('#product-page').waitFor({state:'detached'})
        })
        // Reset to first actual table product so Next is not disabled at the end.
        if(await page.locator('#product-page').count()){await page.locator('#product-page-close').click();await page.locator('#product-page').waitFor({state:'detached'})}
        await selectProduct(page,state.skus[0])
        await page.locator('#product-page').evaluate(e=>e.scrollTop=0);await screenshot(page,phone?'phone-detail.png':viewport.width===1457?'product-1457.png':'product-1440.png',viewport)
        await stage(label+' focus journey',()=>focusJourney(page,viewport,label,phone))
      })
      await context.close()
    }
    check('no browser runtime errors',report.errors.length===0,report.errors)
    check('zero external requests (all nonlocal schemes blocked)',report.network.length===0,report.network)
    check('target unchanged during acceptance',sha(fs.readFileSync(target))===report.source.sha256,{before:report.source.sha256,after:sha(fs.readFileSync(target))})
    const required=['product-1457.png','focus-1457.png','focus-1440.png','phone-detail.png','phone-focus.png']
    check('all five required viewport captures produced in this run',required.every(name=>report.screenshots.some(s=>path.basename(s.path)===name)),report.screenshots.map(s=>s.path))
    check('all five products inspected at all three viewports',report.days.length===15,report.days.map(d=>d.label))
    const expectedTooltipCount=3*5*2*3 // viewports × samples × product/focus × history/forecast/receipt
    check('complete sample tooltip matrix observed',report.tooltips.length===expectedTooltipCount,{expected:expectedTooltipCount,observed:report.tooltips.length})
  } catch(error) {
    report.errors.push({type:'harness',error:error.stack||String(error)})
    check('harness completed',false,error.message)
  } finally {
    if(browser)await browser.close()
    report.status=report.checks.length>0&&report.checks.every(c=>c.pass)&&report.stages.every(s=>s.completed)?'PASS':'FAIL'
    report.summary={checks:report.checks.length,passed:report.checks.filter(c=>c.pass).length,failed:report.checks.filter(c=>!c.pass).map(c=>c.name),stages:report.stages.length,tooltipObservations:report.tooltips.length,dayComparisons:report.days.length}
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify({status:report.status,...report.summary,receipt:path.join(out,'report.json'),screenshots:report.screenshots.map(s=>s.path)},null,2))
    if(report.status!=='PASS')process.exitCode=1
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
