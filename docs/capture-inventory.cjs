const {acceptMeaning}=require('../standalone/qa-input-meaning.cjs')
// Lifecycle: living. Offline disposable harness only, never a real Desktop session.
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

// Sample pins below use scripts/generate_sample.py seed 731209. Checked against
// calculate/inventoryHistory/orderGuidance and the offline runtime; never reuse
// the retired sample's quantities, run-out dates or reconstructed balances.

// Real file-input parsing, at the accepted quantity cap; three history months
// plus Now and six forecast months keep the whole-timeline checks nonvacuous.
const maximumCsv = [
  'sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10,rcv:2026-08,rcv:2026-09,rcv:2026-10',
  'MAX-A12,Synthetic maximum,m,1000000000000,,1000000000000,1000000000000,1000000000000,1000000000000,1000000000000,1000000000000',
].join('\n')

// Native table scroll is allowed; page overflow, token fragmentation and sticky occlusion are not.
async function reachTimelineCell(row, column) {
  await row.evaluate((el, column) => {
    el.scrollIntoView({block:'center',inline:'nearest'})
    const table=el.closest('table'), region=table.closest('[role="region"]')
    region.scrollLeft=0
    if (column>0) {
      const target=el.cells[column].getBoundingClientRect(), month=el.cells[0].getBoundingClientRect()
      region.scrollLeft=target.left-month.right
    }
  }, column)
}

async function measureTimelineRow(row) {
  return row.evaluate(el => {
    const rect = node => {
      const r=node.getBoundingClientRect()
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}
    }
    const table=el.closest('table'), region=table.closest('[role="region"]')
    const cells=[...el.cells].map(cell => {
      const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT),glyphs=[],tokens=[],texts=[]
      while(walker.nextNode()) {
        const node=walker.currentNode
        // Only the compact/full month alternative selected by CSS is rendered.
        if (!node.parentElement.getClientRects().length || getComputedStyle(node.parentElement).display==='none') continue
        texts.push(node.textContent)
        const chars=[]
        for(let i=0;i<node.length;i++) {
          const range=document.createRange(); range.setStart(node,i); range.setEnd(node,i+1)
          const box=rect(range), hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)
          const glyph={text:node.textContent[i],...box,unoccluded:!!hit && cell.contains(hit)}
          chars.push(glyph)
          if(glyph.text.trim()) glyphs.push(glyph)
        }
        for(const match of node.textContent.matchAll(/[+-]?\d+(?:[,.]\d+)*(?:e[+-]?\d+)?/g))
          tokens.push({text:match[0],glyphs:chars.slice(match.index,match.index+match[0].length)})
      }
      const style=getComputedStyle(cell)
      const full=cell.querySelector('.runway-month-full'),compact=cell.querySelector('.runway-month-compact')
      const fullValue=cell.querySelector('.runway-value-full'),compactValue=cell.querySelector('.runway-value-compact')
      const source=full ? (getComputedStyle(full).display==='none' ? compact : full).textContent
        : fullValue ? (getComputedStyle(fullValue).display==='none' ? compactValue : fullValue).textContent : cell.textContent
      return {text:source,renderedText:texts.join(''),fullMonth:full?.textContent,compactMonth:compact?.textContent,visibleText:cell.innerText,accessibleLabel:cell.getAttribute('aria-label'),box:rect(cell),glyphs,tokens,
        fullValue:fullValue?.textContent,title:cell.getAttribute('title'),clientWidth:cell.clientWidth,scrollWidth:cell.scrollWidth,
        position:style.position,left:style.left,background:style.backgroundColor,zIndex:style.zIndex,
        visibility:style.visibility,display:style.display,opacity:style.opacity,
        clipping:[...function*(){for(let p=cell;p;p=p.parentElement) yield p}()]
          .filter(p=>['hidden','clip','auto','scroll'].includes(getComputedStyle(p).overflowX)).map(rect)}
    })
    return {offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth||e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX==='visible'&&!e.closest('[role=region]')).slice(-6).map(e=>e.tagName+'|'+(e.textContent||'').slice(0,40)+'|'+e.getBoundingClientRect().right),viewport:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,
      row:rect(el),previousRow:el.previousElementSibling?.tagName==='TR'?rect(el.previousElementSibling):null,
      nextRow:el.nextElementSibling?.tagName==='TR'?rect(el.nextElementSibling):null,
      region:rect(region),clientWidth:region.clientWidth,scrollWidth:region.scrollWidth,scrollLeft:region.scrollLeft,cells}
  })
}

function assertTimelineView(measured, column) {
  const inside=(a,b)=>a.left>=b.left-1 && a.right<=b.right+1 && a.top>=b.top-1 && a.bottom<=b.bottom+1
  const normalize=text=>text.replace(/\s+/g,' ').trim()
  assert.ok(measured.pageWidth<=measured.viewport,'A11: no horizontal PAGE overflow '+JSON.stringify(measured.offenders))
  assert.ok(measured.region.left>=0 && measured.region.right<=measured.viewport+1)
  if(measured.previousRow) assert.ok(measured.previousRow.bottom<=measured.row.top+1,'A11 previous row overlaps')
  if(measured.nextRow) assert.ok(measured.row.bottom<=measured.nextRow.top+1,'A11 next row overlaps')
  const month=measured.cells[0],selected=column===0?[month]:[month,measured.cells[column]]
  assert.equal(month.position,'sticky'); assert.equal(month.left,'0px')
  assert.ok(Math.abs(month.box.left-measured.region.left)<=1,'A11 Month stays at region left after native scroll')
  assert.notEqual(month.background,'rgba(0, 0, 0, 0)','sticky Month must cover underlying columns')
  assert.ok(Number(month.zIndex)>0)
  for(const cell of selected) {
    assert.ok(cell.scrollWidth<=cell.clientWidth,`A12 cell overflow: ${cell.text} (${cell.scrollWidth}>${cell.clientWidth})`)
    assert.ok(inside(cell.box,measured.region),`A11 unreachable cell: ${cell.text}`)
    assert.ok(cell.box.top>=-1 && cell.box.bottom<=measured.height+1,'A11 row vertically reachable')
    assert.ok(cell.box.width>0 && cell.box.height>0)
    assert.equal(cell.visibility,'visible'); assert.notEqual(cell.display,'none'); assert.notEqual(cell.opacity,'0')
    assert.equal(normalize(cell.visibleText),normalize(cell.text),'A11 full rendered value')
    assert.equal(normalize(cell.renderedText),normalize(cell.text),'A11 no hidden or missing source digits')
    if(cell.fullMonth) {
      assert.equal(cell.accessibleLabel,cell.fullMonth,'A11 full month and Forecast remain accessible')
      assert.equal(cell.compactMonth,cell.fullMonth.split(' · ')[0],'A11 compact month preserves full date')
    }
    if(cell.fullValue) {
      assert.equal(cell.accessibleLabel,cell.fullValue,'A12 exact full value remains accessible')
      assert.equal(cell.title,cell.fullValue,'A12 exact full value remains available in title')
    }
    if(!cell.text.trim()) {
      assert.match(cell.accessibleLabel,/^No (sales|deliveries) at Now separator$/,'only the two intentional Now gaps may have no glyphs')
      continue
    }
    assert.ok(cell.glyphs.length>0,`A11 missing text ranges: ${cell.text}`)
    assert.equal(cell.glyphs.map(g=>g.text).join(''),cell.text.replace(/\s/g,''),'A11 all characters measured')
    for(const glyph of cell.glyphs) {
      assert.ok(glyph.width>0 && glyph.height>0,`A11 invisible glyph: ${cell.text}`)
      assert.ok(inside(glyph,cell.box),`A11 clipped/overlapping text: ${cell.text}`)
      assert.ok(inside(glyph,measured.region),`A11 text outside table viewport: ${cell.text}`)
      for(const clip of cell.clipping) assert.ok(inside(glyph,clip),`A11 ancestor clips: ${cell.text}`)
      assert.ok(glyph.unoccluded,`A11 glyph hidden under sticky Month or another cell: ${cell.text}`)
    }
    assertTimelineNumberTokens(cell)
  }
  // Only deliberate offscreen/under-sticky columns may overlap Month. Each is
  // independently brought fully alongside Month and checked on its own turn.
  if(column>0) assert.ok(month.box.right<=selected[1].box.left+1,'A11 visible Month/target cells overlap')
  for(let i=1;i<measured.cells.length;i++) for(let j=i+1;j<measured.cells.length;j++) {
    const a=measured.cells[i].box,b=measured.cells[j].box
    assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1,'A11 nonsticky cells overlap')
  }
}

function assertTimelineNumberTokens(cell) {
  assert.equal(cell.tokens.length,[...cell.text.matchAll(/[+-]?\d+(?:[,.]\d+)*(?:e[+-]?\d+)?/g)].length,'A11 every numeric token checked')
  for(const token of cell.tokens) {
    assert.equal(token.glyphs.map(g=>g.text).join(''),token.text,'A11 every digit and separator present')
    assert.ok(token.glyphs.length>0)
    assert.ok(token.glyphs.every(g=>g.width>0 && g.height>0 && Math.abs(g.top-token.glyphs[0].top)<=1),
      `A11 numeric token split across lines: ${token.text}`)
  }
}

async function checkTimelineText(page, table, evidence) {
  const region=table.locator('xpath=ancestor::div[@role="region"]')
  const cue=region.locator('xpath=..').locator('[data-table-scroll-cue]')
  await cue.scrollIntoViewIfNeeded()
  assert.equal(await cue.isVisible(),true,'A11 visible scroll cue')
  assert.match(await cue.innerText(),/Scroll sideways.*Month stays in view/)
  const cueBox=await cue.boundingBox()
  assert.ok(cueBox.width>0 && cueBox.x>=0 && cueBox.x+cueBox.width<=await page.evaluate(()=>innerWidth)+1)
  assert.equal(await region.getAttribute('tabindex'),'0')
  assert.equal(await region.evaluate(el=>getComputedStyle(el).overflowX),'auto')
  const rows=table.locator('tr'), measured={views:[],cells:0,glyphs:0,tokens:0}
  const rowCount=await rows.count()
  assert.ok(rowCount>=11,'A11 nonvacuous whole timeline')
  for(let r=0;r<rowCount;r++) {
    const row=rows.nth(r)
    assert.equal(await row.locator('th,td').count(),4)
    for(let c=0;c<4;c++) {
      await reachTimelineCell(row,c)
      const view=await measureTimelineRow(row)
      measured.views.push({row:r,column:c,...view})
      fs.writeFileSync(evidence,JSON.stringify(measured,null,2))
      assertTimelineView(view,c)
      measured.cells++; measured.glyphs+=view.cells[c].glyphs.length; measured.tokens+=view.cells[c].tokens.length
    }
  }
  assert.equal(measured.cells,rowCount*4,'A11 every row and column reached')
  assert.ok(measured.glyphs>100 && measured.tokens>20,'A11 glyph and numeric checks cannot pass empty')
  if(measured.views[0].scrollWidth>measured.views[0].clientWidth)
    assert.ok(measured.views.some(view=>view.scrollLeft>0),'A11 actual native horizontal scroll exercised')
  fs.writeFileSync(evidence,JSON.stringify(measured,null,2))
  return measured
}

async function checkTimelineMatrix(browser) {
  const findings = []
  for (const zoom of [1,2]) for (const width of (zoom===1?[360,390,1440]:[360,390])) for (const theme of ['light','dark']) {
    // Browser-equivalent 200% page zoom: halve the CSS layout viewport AND double
    // raster scale. This reflows content/media queries at 180/195 CSS px and renders
    // 13px text at 26 image pixels on a 360/390px image. deviceScaleFactor alone is not zoom.
    const context = await browser.newContext({viewport:{width:width/zoom,height:1100/zoom},deviceScaleFactor:zoom})
    await context.route(/^https?:/,route=>route.abort())
    await context.addInitScript(freezeOrderToday)
    try {
      const page=await context.newPage(),errors=[]
      page.on('pageerror',error=>errors.push(error.message))
      await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href+`?theme=${theme}`)
      assert.equal(await page.evaluate(()=>innerWidth),width/zoom)
      assert.equal(await page.evaluate(()=>devicePixelRatio),zoom)
      const detail=page.getByRole('region',{name:'Selected item forecast'})
      const summary=detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'})
      const table=detail.getByRole('table',{name:'Month by month: stock, sales, deliveries',exact:true})
      const results=[]
      for (const fixture of ['sample','fractional','maximum']) {
        if (fixture!=='sample') {
          await summary.click()
          await page.getByRole('button',{name:'My file (CSV)',exact:true}).click()
          await page.locator('#runway-csv').setInputFiles(fixture==='fractional'
            ? path.resolve('tests/fixtures/fractional.csv')
            : {name:'a12-maximum.csv',mimeType:'text/csv',buffer:Buffer.from(maximumCsv)});await acceptMeaning(page)
          await detail.getByRole('heading',{name:fixture==='fractional'?'Synthetic liquid · SKU L':'Synthetic maximum · SKU MAX-A12',exact:true}).waitFor()
        }
        await summary.click()
        await table.waitFor({state:'visible'})
        const stem=`.scratch/a4-screens/a12-timeline-${width}-${theme}${zoom===2?'-zoom200':''}${fixture==='sample'?'':`-${fixture}`}`
        const evidence=stem+'.json'
        const measured=await checkTimelineText(page,table,evidence)
        assert.deepEqual(await table.locator('thead th').allTextContents(),['Month','Sold / Forecast','Delivered','Stock at month end'])
        const now=table.locator('[data-now-separator]')
        const expectedNow=fixture==='sample'?'7 m':fixture==='fractional'?'0.7 l':'1,000,000,000,000 m'
        const exactText=cell=>cell.evaluate(el=>el.getAttribute('aria-label') || el.innerText)
        assert.equal(await exactText(now.locator('td').last()),expectedNow)
        assert.equal(await exactText(table.locator('tbody tr').first().locator('td').last()),fixture==='sample'?'Reconstructed 93 m':fixture==='fractional'?'Unknown':'Reconstructed 1,000,000,000,000 m')
        assert.equal(await exactText(table.locator('tbody tr').last().locator('td').last()),fixture==='sample'?'Out of stock · short 27 m':fixture==='fractional'?'Out of stock · short 0.24 l':'Out of stock · short 5,000,000,000,000 m')
        if(fixture==='maximum') {
          assert.equal(await table.locator('tr').count(),11,'maximum fixture was accepted, not held or previous CSV retained')
          for(let r=0;r<3;r++) for(const c of [1,2])
            assert.equal(await exactText(table.locator('tbody tr').nth(r).locator('th,td').nth(c)),'1,000,000,000,000 m')
          for(let r=4;r<10;r++)
            assert.equal(await exactText(table.locator('tbody tr').nth(r).locator('td').first()),'1,000,000,000,000 m')
          if(width<1440) assert.ok(measured.views.some(view=>view.scrollLeft>0),'A12 phone maximum fixture exercises native scroll')
        }
        // Each image is deliberately stock-scrolled, never an initial leftmost view.
        const screenshots=[]
        for (const [suffix,row] of [['-stock-header',table.locator('thead tr')],['-stock-now',now],['-stock-last',table.locator('tbody tr').last()]]) {
          await reachTimelineCell(row,3)
          const view=await measureTimelineRow(row)
          assertTimelineView(view,3)
          const screenshot=stem+suffix+'.png'
          await page.screenshot({path:screenshot})
          screenshots.push({path:screenshot,scrollLeft:view.scrollLeft,month:view.cells[0].visibleText,stock:view.cells[3].visibleText})
        }
        results.push({fixture,cells:measured.cells,glyphs:measured.glyphs,tokens:measured.tokens,expectedNow,evidence,screenshots})
      }
      assert.deepEqual(errors,[])
      findings.push({width,theme,zoom,cssViewport:width/zoom,results})
    } finally { await context.close() }
  }
  return findings
}

// Deterministic actual today for local harness fixtures; production still reads the clock.
function freezeOrderToday() {
  const NativeDate = Date
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-11-11T12:00:00'])) }
    static now() { return new NativeDate('2026-11-11T12:00:00').getTime() }
  }
}
async function clearWithKeyboard(control) {
  await control.focus()
  // Home/End are document-navigation keys on macOS, not portable field bounds.
  await control.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  const selection = await control.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, length: el.value.length }))
  assert.deepEqual(selection, { start: 0, end: selection.length, length: selection.length }, 'keyboard selects the entire rendered field')
  await control.press('Backspace')
  assert.equal(await control.inputValue(), '', 'keyboard deletion leaves the actual DOM field blank')
}
// Structural placement and actual first-screen visibility, independent of a magic Y offset.
async function checkOrderPlacement(panel) {
  const geometry=await panel.evaluate(el=>{
    const bounds=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}}
    const row=el.querySelector('[data-order-sku]'),answer=row?.querySelector('[data-order-answer]'),product=row?.querySelector('[data-order-product]')
    const range=document.createRange()
    if(answer) range.selectNodeContents(answer)
    return {firstAfterTitle:el.previousElementSibling?.tagName==='H1',header:bounds(el.querySelector('h2')),
      row:row?bounds(row):null,list:row?bounds(row.parentElement):null,height:innerHeight,width:innerWidth,scrollY,
      answer:answer?{text:answer.textContent,size:parseFloat(getComputedStyle(answer).fontSize),weight:+getComputedStyle(answer).fontWeight,lines:[...range.getClientRects()].length}:null,
      product:product?{text:product.textContent,size:parseFloat(getComputedStyle(product).fontSize),weight:+getComputedStyle(product).fontWeight}:null}
  })
  assert.equal(geometry.firstAfterTitle,true,'Order today must be the first content block after the page title')
  assert.equal(geometry.scrollY,0,'measure initial viewport before interaction')
  for(const rect of [geometry.header,geometry.row].filter(Boolean)) {
    assert.ok(rect.top>=0 && rect.bottom<=geometry.height,'header and first row fully visible in initial screen')
    assert.ok(rect.left>=0 && rect.right<=geometry.width,'header and first row fit phone width')
  }
  if(geometry.row) {
    assert.ok(geometry.row.bottom<=geometry.list.bottom,'first row is not clipped by the order list')
    assert.ok(geometry.answer.size>geometry.product.size && geometry.answer.weight>geometry.product.weight,'suggested quantity leads product typography')
    if(geometry.width===390 && /^\d/.test(geometry.answer.text)) assert.equal(geometry.answer.lines,1,'suggested quantity stays together at 390')
  }
  return geometry
}
async function checkOrderGuidanceMatrix(browser) {
  const item = (sku,name,on_hand,supplier_days=14,extra={}) => ({sku,name,on_hand,supplier_days,unit:'m',monthly_sales:[30,30,30],receipts:{},...extra})
  const data = {as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:[
    item('ORDER-OUT','Synthetic out of stock',0,3),
    item('ORDER-SOON','Synthetic urgent item',20),
    item('LOW-ITEM','Synthetic running low',45),
    item('HEALTHY','Synthetic healthy item',80),
    item('OVERSTOCK','Synthetic long cover item',1000),
    item('NO-SALES','Synthetic empty no sales',0,3,{monthly_sales:[0,0,0]}),
    item('ZERO-STOCKED','Synthetic stocked no sales',5,3,{monthly_sales:[0,0,0]}),
    item('HELD-ITEM','Synthetic held item',100,14,{hold_reason:'Synthetic forecast hold reason.'}),
    item('GAP-OUT','Synthetic empty awaiting delivery',0,14,{receipts:{'2026-12':100}}),
    item('GAP-LOW','Synthetic shortage before delivery',5,14,{receipts:{'2026-12':1000}}),
    item('UNKNOWN','Synthetic unknown delivery',20,null),
  ]}
  const findings=[]
  for (const width of [360,390,1440]) for (const theme of ['light','dark']) {
    const context=await browser.newContext({viewport:{width,height:1100}})
    await context.route(/^https?:/,route=>route.abort())
    await context.addInitScript(freezeOrderToday)
    await context.addInitScript(payload=>{
      if (!localStorage.getItem('runway-harness.csv_data')) {
        localStorage.setItem('runway-harness.csv_data',JSON.stringify(payload))
        localStorage.setItem('runway-harness.source',JSON.stringify('csv'))
      }
    },data)
    try {
      const page=await context.newPage(),errors=[]
      page.on('pageerror',error=>errors.push(error.message))
      await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href+`?theme=${theme}`)
      const main=page.locator('main'),panel=page.locator('section[data-order-today]')
      const browserPanel=page.getByRole('region',{name:'Inventory items, soonest run-out first'})
      const detail=page.getByRole('region',{name:'Selected item forecast'})
      const advanced=main.locator('details[data-advanced-settings]')
      const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('runway-harness.order_settings')))
      const answer=()=>detail.getByRole('status').first().innerText()
      const select=async sku=>{
        await browserPanel.locator('[data-bucket="all"]').click()
        await browserPanel.locator(`[data-runway-product][aria-label*=" · ${sku} · "]`).click()
      }
      const seed=async items=>{
        await page.evaluate(payload=>{
          localStorage.setItem('runway-harness.csv_data',JSON.stringify(payload))
          localStorage.removeItem('runway-harness.order_settings')
        },{...data,items})
        await page.reload(); await detail.waitFor()
        await page.evaluate(()=>window.scrollTo(0,0))
      }
      await panel.waitFor()
      const initialGeometry=await checkOrderPlacement(panel)
      assert.equal(await advanced.evaluate(el=>el.open),false)
      // Order today includes near-term and zero-purchase attention rows; it is
      // deliberately NOT identical to the exclusive Order now filter anymore.
      assert.equal(await panel.getAttribute('aria-label'),'Order today (7)')
      assert.equal(await panel.locator('[data-order-sku]').count(),7)
      const counts={all:['All',11],order:['Order now',5],'running-low':['Order soon',2],healthy:['OK',2],overstocked:['Overstocked',0],'no-sales':['No sales',1],'needs-data':['Not enough history',1]}
      for (const [bucket,[label,count]] of Object.entries(counts)) {
        assert.equal(await browserPanel.locator(`[data-bucket="${bucket}"]`).innerText(),`${label} (${count})`)
        await browserPanel.locator(`[data-bucket="${bucket}"]`).click()
        assert.equal(await browserPanel.locator('[data-runway-product]').count(),count,`${bucket} rows follow its count`)
      }
      assert.match(await panel.locator('[data-order-sku="ORDER-OUT"]').innerText(),/Suggested order\s+73 m/)
      assert.match(await panel.locator('[data-order-sku="UNKNOWN"]').innerText(),/Assumed delivery time.*All settings/)
      assert.match(await panel.locator('[data-order-sku="GAP-OUT"]').innerText(),/Suggested order\s+31 m/)
      assert.match(await panel.locator('[data-order-sku="GAP-LOW"]').innerText(),/Short from 5 Nov 2026 until the Dec delivery of 1,000 m\./)
      assert.match(await panel.locator('[data-supply-gap="NO-SALES"]').innerText(),/Out of stock — no recent sales; no order quantity suggested/)
      await browserPanel.getByRole('searchbox').fill('HELD-ITEM')
      assert.equal(await browserPanel.locator('[data-bucket="all"]').innerText(),'All (1)')
      assert.equal(await browserPanel.locator('[data-bucket="needs-data"]').innerText(),'Not enough history (1)')
      assert.equal(await panel.getAttribute('aria-label'),'Order today (7)','search filters the browser, not the daily attention list')
      await browserPanel.getByRole('searchbox').fill('')
      const shot=`.scratch/order-screens/fixture-${width}-${theme}.png`
      await page.screenshot({path:shot,fullPage:true})
      await panel.locator('[data-order-sku="ORDER-OUT"]').click()
      assert.equal(await answer(),'Out of stock — Order 73 m now')
      await advanced.locator(':scope > summary').click()
      const edit=async(id,text,field,sku)=>{
        const control=advanced.locator(`#order-setting-${id}`)
        await control.focus() // settle any previous control's legitimate blur save first
        const prior=await saved()
        await clearWithKeyboard(control)
        assert.deepEqual(await saved(),prior,'blank remains a draft until blur')
        await control.pressSequentially(text)
        assert.equal(await control.inputValue(),text)
        const current=await saved()
        assert.equal(sku?current.product_overrides[sku][field]:current[field],Number(text))
        await control.press('Tab')
        assert.equal(await control.inputValue(),text)
      }
      for (const id of ['months-of-cover','overstock-threshold','urgent-window','running-low-window']) {
        const control=advanced.locator(`#order-setting-${id}`),prior=await saved(),before=await control.inputValue()
        await control.fill(''); await control.press('Tab')
        assert.equal(await control.inputValue(),'')
        assert.equal(await control.getAttribute('aria-invalid'),'true')
        assert.deepEqual(await saved(),prior)
        await control.fill(before); await control.press('Tab')
        assert.equal(await control.getAttribute('aria-invalid'),'false')
      }
      await edit('months-of-cover','4','months_of_cover')
      assert.equal(await answer(),'Out of stock — Order 134 m now')
      await edit('default-delivery-days','20','default_delivery_days')
      await edit('overstock-threshold','0.5','overstock_months')
      await edit('urgent-window','0','urgent_days')
      await edit('running-low-window','40','running_low_days')
      await edit('product-minimum-order','135.2','minimum_order','ORDER-OUT')
      assert.equal(await answer(),'Out of stock — Order 136 m now')
      await edit('product-pack-size','2.5','pack_size','ORDER-OUT')
      assert.equal(await answer(),'Out of stock — Order 137.5 m now')
      await edit('months-of-cover','0.25','months_of_cover')
      assert.equal(await answer(),'Out of stock — Order 137.5 m now')
      const persisted=await saved()
      await page.reload(); await detail.waitFor()
      assert.deepEqual(await saved(),persisted)
      assert.equal(await advanced.evaluate(el=>el.open),false)
      await select('ORDER-OUT'); await advanced.locator(':scope > summary').click()
      for (const id of ['product-minimum-order','product-pack-size']) {
        const control=advanced.locator(`#order-setting-${id}`)
        await control.fill(''); await control.press('Tab')
        assert.equal(await control.getAttribute('aria-invalid'),'false')
      }
      assert.equal((await saved()).product_overrides['ORDER-OUT'],undefined)
      await page.getByRole('button',{name:'Reset to defaults',exact:true}).click()
      assert.equal((await saved()).months_of_cover,2)
      assert.equal((await saved()).default_delivery_days,14)
      assert.deepEqual((await saved()).product_overrides,{})
      assert.equal(await answer(),'Out of stock — Order 73 m now')
      const fallback=advanced.locator('#order-setting-default-delivery-days')
      const priorFallback=await saved()
      for (const invalid of ['0','-1','text']) {
        await clearWithKeyboard(fallback); await fallback.pressSequentially(invalid); await fallback.press('Tab')
        assert.equal(await fallback.getAttribute('aria-invalid'),'true')
        assert.deepEqual(await saved(),priorFallback)
      }
      await clearWithKeyboard(fallback); await fallback.press('Tab')
      assert.equal((await saved()).default_delivery_days,null)
      await select('UNKNOWN')
      assert.match(await answer(),/No delivery time/)
      assert.equal(await browserPanel.locator('[data-bucket="needs-data"]').innerText(),'Not enough history (2)')
      await page.reload(); await select('UNKNOWN')
      assert.equal((await saved()).default_delivery_days,null)
      assert.match(await answer(),/No delivery time/)
      const receiptCases=[]
      for (const fixture of [
        {sku:'B1',month:'2026-11',stock:20,runout:'28 Feb 2027',orderBy:'14 Feb 2027',gap:null},
        {sku:'TRUE-GAP',month:'2026-12',stock:20,runout:'20 Nov 2026',orderBy:'11 Nov 2026',gap:'Short from 20 Nov 2026 until the Dec delivery of 100 m.'},
        {sku:'ZERO-DAY',month:'2026-12',stock:30,runout:'30 Nov 2026',orderBy:'16 Nov 2026',gap:'Short from 30 Nov 2026 until the Dec delivery of 100 m.'},
      ]) {
        await seed([item(fixture.sku,`Synthetic ${fixture.sku}`,fixture.stock,14,{receipts:{[fixture.month]:100}})])
        const row=browserPanel.locator('[data-runway-product]')
        assert.match(await row.innerText(),new RegExp(`Runs out ${fixture.runout}`))
        if (fixture.gap) {
          assert.ok((await detail.innerText()).includes(fixture.gap))
          const order=panel.locator(`[data-order-sku="${fixture.sku}"]`)
          assert.equal(await order.count(),1)
          assert.match(await order.locator('[data-order-metric="order-by"]').innerText(),new RegExp(fixture.orderBy))
          assert.ok((await order.innerText()).includes(fixture.gap))
        } else {
          assert.match(await answer(),/by 14 Feb 2027$/)
          assert.doesNotMatch(await detail.innerText(),/Short from/)
          assert.equal(await panel.locator('[data-order-sku]').count(),0)
          assert.match(await panel.innerText(),/Nothing to order today\./)
        }
        const screenshot=`.scratch/order-screens/${fixture.sku}-${width}-${theme}.png`
        await page.screenshot({path:screenshot,fullPage:true})
        receiptCases.push({...fixture,screenshot})
      }
      await seed(Array.from({length:61},(_,i)=>item(`EMPTY-${i}`,'Synthetic empty item',0,0,{monthly_sales:[0,0,0]})))
      assert.equal(await panel.getAttribute('aria-label'),'Order today (61)')
      assert.equal(await panel.locator('[data-order-sku]').count(),10)
      await panel.getByRole('button',{name:'Show all 61',exact:true}).click()
      assert.equal(await panel.locator('[data-order-sku]').count(),61)
      await panel.locator('[data-order-sku="EMPTY-60"]').click()
      await detail.getByRole('heading',{name:'Synthetic empty item · SKU EMPTY-60',exact:true}).waitFor()
      await panel.getByRole('button',{name:'Show top 10',exact:true}).click()
      assert.equal(await panel.locator('[data-order-sku]').count(),10)
      await seed([item('YEAR','Synthetic long cover',400)])
      await advanced.locator(':scope > summary').click(); await edit('months-of-cover','36','months_of_cover')
      assert.match(await answer(),/by 27 Nov 2027$/)
      const before=await answer()
      for (const horizon of ['1','12']) {
        await page.getByRole('combobox',{name:'Look ahead',exact:true}).selectOption(horizon)
        assert.equal(await answer(),before)
      }
      assert.doesNotMatch(await panel.innerText(),/\b(?:MOQ|EOQ|EORQ)\b/)
      assert.doesNotMatch(await main.innerText(),/by now|date unavailable|NaN|undefined|\[object Object\]/)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      assert.deepEqual(errors,[])
      findings.push({width,theme,counts,initialGeometry,receiptCases,keyboardDrafts:true,requiredBlankErrors:true,optionalBlankClears:true,attentionRows:7,showAllRows:61,persisted:true,reset:true,horizonParity:true,screenshot:shot,errors})
    } finally { await context.close() }
  }
  return findings
}
async function checkChartText(chart, expectRunout) {
  const measured = await chart.evaluate(svg => {
    const rect = el => {
      const r = el.getBoundingClientRect()
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}
    }
    return {svg:rect(svg),labels:[...svg.querySelectorAll('text')].map(el=>({text:el.textContent,axisUnit:el.hasAttribute('data-axis-unit'),...rect(el)}))}
  })
  const exactlyOne = predicate => {
    const matches = measured.labels.filter(predicate)
    assert.equal(matches.length,1,'required chart text must exist exactly once')
    assert.ok(matches[0].width>0 && matches[0].height>0,'text must have a real rendered rectangle')
    return matches[0]
  }
  const now = exactlyOne(l=>l.text==='Now')
  const quantity = exactlyOne(l=>l.axisUnit)
  assert.ok(['Metres','Units'].includes(quantity.text),'synthetic fixtures use humanized axis units')
  const separate = (a,b) => a.right+2<=b.left || b.right+2<=a.left || a.bottom+2<=b.top || b.bottom+2<=a.top
  assert.ok(separate(now,quantity),'Now and quantity actual text rectangles overlap')
  for (const l of measured.labels) {
    assert.ok(l.left>=measured.svg.left && l.right<=measured.svg.right && l.top>=measured.svg.top && l.bottom<=measured.svg.bottom,`text clipped inside SVG: ${l.text}`)
  }
  const runouts = measured.labels.filter(l=>/^Runs out |^Out now$/.test(l.text))
  assert.equal(runouts.length,expectRunout?1:0)
  if (expectRunout) {
    const runout = exactlyOne(l=>/^Runs out |^Out now$/.test(l.text))
    assert.ok(separate(runout,now) && separate(runout,quantity),'runout annotation overlaps top labels')
    for (const l of measured.labels.filter(l=>l.text==='Out of stock' || /^[A-Z][a-z]{2} \d{4}$/.test(l.text)))
      assert.ok(separate(runout,l),`runout annotation overlaps ${l.text}`)
  }
  return measured
}
async function checkRecovery(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 1100 } })
  await context.route(/^https?:/, route => route.abort())
  await context.addInitScript(freezeOrderToday)
  await context.addInitScript(() => { window.runwayCaptureCaughtErrors = true })
  const page = await context.newPage()
  const observedErrors = [], uncaughtErrors = []
  let step = 'initial sample'
  page.on('pageerror', error => uncaughtErrors.push({step, message:error.message}))
  const fixture = name => path.resolve('tests/fixtures', name)
  const stale = {name:'stale.csv',mimeType:'text/csv',buffer:Buffer.from(fs.readFileSync(fixture('fractional.csv'),'utf8').replace('Synthetic liquid','Stale file must not win'))}
  const selected = page.getByRole('region', { name: 'Selected item forecast' })
  const stored = () => page.evaluate(() => localStorage.getItem('runway-harness.csv_data'))
  const panel = page.getByRole('alert').filter({hasText: "Couldn't show this forecast."})
  const recovery = () => panel.getByRole('button', { name: 'Back to sample data', exact: true })
  const anotherFile = () => panel.getByLabel('Choose another file', {exact:true})
  const datasetFailure = 'Could not calculate this dataset. Choose another file or go back to sample data.'
  const storageState = () => page.evaluate(() => ({
    source: JSON.parse(localStorage.getItem('runway-harness.source') ?? '"sample"'),
    csv: localStorage.getItem('runway-harness.csv_data'),
  }))
  const check = async (source, csv, name, caughtMessage = null) => {
    if (name === 'recovery') {
      await panel.waitFor({state:'visible'})
      assert.equal(await panel.count(),1,step + ': exactly one owning recovery panel')
      assert.equal(await recovery().isVisible(),true)
      assert.equal(await anotherFile().isVisible(),true)
      assert.equal(await selected.count(),0,step + ': failed route must be replaced')
      assert.equal(await page.locator('#runway-csv').count(),0)
    } else {
      await panel.waitFor({state:'hidden'})
      const active = page.getByRole('button',{name:source === 'sample' ? 'Sample' : 'My file (CSV)',exact:true})
      await active.and(page.locator('[aria-pressed="true"]')).waitFor({state:'visible'})
      assert.equal(await active.getAttribute('aria-pressed'),'true',step + ': visible source')
      if (name) {
        await selected.getByRole('heading',{name,exact:false}).waitFor()
        await selected.getByRole('heading',{name:'Supply, demand and inventory',exact:true}).waitFor()
      } else assert.equal(await selected.count(),0)
    }
    assert.deepEqual(await storageState(),{source,csv},step + ': persisted state')
    assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE'),step + ': no exception text')
    const caught = await page.evaluate(() => window.runwayCaughtErrors.splice(0))
    observedErrors.push(...caught.map(error => ({step,...error})))
    if (caughtMessage) {
      assert.ok(caught.length > 0,step + ': actual React boundary must catch the fault')
      assert.ok(caught.every(error => error.message === caughtMessage && error.componentStack.includes('RecoveryBoundary')),JSON.stringify(caught))
    } else assert.deepEqual(caught,[],step + ': no unexpected caught React errors')
    assert.deepEqual(uncaughtErrors,[],step + ': no uncaught page errors')
  }
  const sample = csv => check('sample',csv,'Foam floor underlay roll')
  const liquid = csv => check('csv',csv,'Synthetic liquid')
  const upload = () => page.locator('#runway-csv')
  const chooseCsv = () => page.getByRole('button', { name: 'My file (CSV)', exact: true }).click()
  const delayRead = () => page.evaluate(() => {
    const original = File.prototype.arrayBuffer
    delete window.finishRunwayRead
    File.prototype.arrayBuffer = function () {
      const file = this
      return new Promise(resolve => { window.finishRunwayRead = async () => { resolve(await original.call(file)); File.prototype.arrayBuffer = original } })
    }
  })
  const pendingRead = () => page.waitForFunction(() => typeof window.finishRunwayRead === 'function')
  const finishRead = () => page.evaluate(async () => { await window.finishRunwayRead(); await new Promise(resolve => setTimeout(resolve, 0)) })
  try {
    await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href + '?theme=light')
    await sample(null)
    step = 'empty CSV source'
    await chooseCsv()
    await upload().waitFor({state:'visible'})
    await check('csv',null,null)
    await upload().setInputFiles(fixture('fractional.csv'));await acceptMeaning(page)
    await selected.getByRole('heading', { name: 'Synthetic liquid', exact: false }).waitFor()
    let good = await stored()
    assert.equal(JSON.parse(good).items[0].name,'Synthetic liquid')
    // Normal uploads carry explicitly reviewed input meaning. The legacy recovery
    // parser still imports canonical CSV directly (no meaning dialog). Pin its
    // exact dataset separately; retain every stock/sales/receipt/lead-time byte.
    const recoveryData = JSON.parse(good)
    delete recoveryData.input_meaning
    for (const item of recoveryData.items) {
      delete item.input_warnings
      delete item.incoming_unknown
    }
    const recoveryGood = JSON.stringify(recoveryData)
    assert.equal(JSON.parse(good).input_meaning.choices.units_confirmed,true)
    step = 'valid fractional upload'
    await liquid(good)
    const checkPresentZero = async onHand => {
      const expected = onHand === 0 ? 'Out of stock' : 'Runs out 1 Nov 2026'
      // Purchase policy nets the cover window, not unmet demand since the snapshot.
      // Tiny demand plus safety stock needs one unit at 0.7 stock, two near zero.
      const quantity = onHand === 0.7 ? 1 : 2
      assert.equal(await selected.getByRole('status').innerText(),`Out of stock — Order ${quantity} l now (Assumed delivery time: 14 days — change in All settings)`)
      const activeRow = page.getByRole('button', {name:/ · L · Synthetic liquid · /})
      assert.ok((await activeRow.getAttribute('aria-label')).startsWith(expected + ' · '))
      const svg = selected.locator('svg[role="img"]')
      assert.equal(await svg.locator('[data-runout-label]').textContent(), onHand === 0 ? 'Out of stock' : 'Runs out Nov')
      if (onHand > 0) assert.doesNotMatch(await selected.innerText(), /Already depleted|Out now/)
      assert.match(await svg.getAttribute('aria-label'), /As of 31 Oct 2026\. Unit: l\./)
    }
    await checkPresentZero(0.7)
    step = 'A10 exact fractional headline and Now stock cell'
    assert.equal(await selected.getByText('0.7 l left · sells about 0.04 l a month · less than a month left', {exact:true}).isVisible(), true)
    assert.ok(!(await selected.innerText()).includes('0 l left'))
    const timelineSummary = selected.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'})
    await timelineSummary.click()
    const timeline = selected.getByRole('table', {name:'Month by month: stock, sales, deliveries', exact:true})
    const now = timeline.getByRole('row').filter({has:page.getByRole('rowheader', {name:'Now', exact:true})})
    assert.equal(await now.getByRole('cell', {name:'0.7 l', exact:true}).isVisible(), true)
    assert.equal(await now.getAttribute('data-now-separator'), 'true')
    assert.equal(await now.getByRole('rowheader').getAttribute('colspan'), '1')
    assert.equal(await timeline.getByRole('row').nth(9).innerText(), 'Nov 2026 · Forecast\t0.04 l\t0 l\tOut of stock · short 0.04 l')
    await page.screenshot({path:'.scratch/a4-screens/a10-fractional-now-390.png',fullPage:true})
    await timelineSummary.click()
    step = 'A10 exact fractional quick-view stock'
    await page.getByRole('button', {name:'Inventory Manager: quick view', exact:true}).click()
    const popup = page.getByRole('dialog')
    await popup.waitFor({state:'visible'})
    const liquidRow = popup.getByRole('row').filter({hasText:'Synthetic liquid'})
    assert.equal(await liquidRow.getByRole('cell').nth(1).innerText(), '0.7')
    await page.keyboard.press('Escape')
    await popup.waitFor({state:'hidden'})
    for (const onHand of [0.000001, 0]) {
      step = 'A10 present-zero browser regression: ' + onHand
      const variant = JSON.parse(good)
      variant.items[0].on_hand = onHand
      await page.evaluate(data => localStorage.setItem('runway-harness.csv_data', JSON.stringify(data)), variant)
      await page.reload()
      await selected.getByRole('heading', {name:'Synthetic liquid', exact:false}).waitFor()
      await checkPresentZero(onHand)
    }
    await page.evaluate(data => localStorage.setItem('runway-harness.csv_data', data), good)
    await page.reload()
    await liquid(good)
    for (const [bad, message] of [['date_boundary.csv',/1000-01.*9998-12/],
      ['mixed_overflow.csv',/Row 3: supplier_days.*3650/],['finite_sales_overflow.csv',/1000000000000/]]) {
      step = 'rejected upload: ' + bad
      await upload().setInputFiles(fixture(bad));await acceptMeaning(page)
      await page.getByRole('alert').filter({hasText:message}).waitFor()
      assert.equal(await stored(),good,'rejected upload must retain prior good data')
      await liquid(good)
    }
    await selected.locator('summary').filter({hasText:'Past sales ('}).click()
    assert.match(await selected.innerText(),/Average per month \(7 months\): 0\.04 l/)
    const past = selected.locator('table').filter({has:page.locator('caption:text-is("Past sales")')})
    assert.match(await past.innerText(),/0\.04 l/)
    assert.ok(!/\t0 l/.test(await past.innerText()))
    await selected.locator('summary').filter({hasText:'How good is this forecast?'}).click()
    assert.match(await selected.innerText(),/Error: <0\.01%/)
    await page.screenshot({path:'.scratch/a4-screens/a9-fractional-390.png',fullPage:true})
    step = 'fractional metre text'
    await page.getByRole('button', {name:/ · M · Synthetic fine metre/}).click()
    await check('csv',good,'Synthetic fine metre')
    assert.match(await selected.innerText(),/Average per month \(7 months\): <0\.01 m/)
    assert.ok(!/\t0 m/.test(await selected.locator('table').filter({has:page.locator('caption:text-is("Past sales")')}).innerText()))
    // Force a whole-dataset calculation exception after parsing a valid CSV.
    step = 'rejected upload calculation exception'
    await page.evaluate(() => {
      const map = Array.prototype.map
      window.restoreRunwayMap = () => { Array.prototype.map = map }
      Array.prototype.map = function (...args) {
        if (this[0]?.sku === 'THROW-DATASET') throw Error('PRIVATE upload calculation failure')
        return map.apply(this,args)
      }
    })
    await upload().setInputFiles({name:'calculation.csv',mimeType:'text/csv',buffer:Buffer.from(fs.readFileSync(fixture('fractional.csv'),'utf8').replace('L,Synthetic','THROW-DATASET,Synthetic'))});await acceptMeaning(page)
    await page.getByRole('alert').filter({hasText:'Could not calculate this file.'}).waitFor()
    assert.equal(await stored(),good)
    assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE'))
    await check('csv',good,'Synthetic fine metre')
    await page.evaluate(() => window.restoreRunwayMap())
    // A pending read cannot overwrite data after a source switch.
    step = 'pending read source switch'
    await delayRead()
    await upload().setInputFiles(stale);await acceptMeaning(page)
    await pendingRead()
    await check('csv',good,'Synthetic fine metre')
    await page.getByRole('button',{name:'Sample',exact:true}).click()
    await sample(good)
    await finishRead()
    assert.equal(await stored(),good)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('runway-harness.source'))),'sample')
    await sample(good)
    // Invalid saved calendar and malformed JSON both enter the real boundary on reload.
    for (const bad of [JSON.stringify({items:[],months:['9999-12'],as_of:'9999-12-31'}),'{invalid-json']) {
      step = 'invalid saved state: ' + bad
      await page.evaluate(value => { localStorage.setItem('runway-harness.source','"csv"'); localStorage.setItem('runway-harness.csv_data',value) },bad)
      await page.reload()
      await check('csv',bad,'recovery',datasetFailure)
      step = 'sample retains invalid saved CSV: ' + bad
      await recovery().click(); await sample(bad)
    }
    // Choose another file is an actual file control and preserves bad state until evaluation succeeds.
    await page.evaluate(() => { localStorage.setItem('runway-harness.source','"csv"'); localStorage.setItem('runway-harness.csv_data','{}') })
    step = 'empty saved dataset recovery'
    await page.reload(); await check('csv','{}','recovery',datasetFailure)
    step = 'rejected recovery upload'
    await anotherFile().setInputFiles(fixture('date_boundary.csv'));await acceptMeaning(page)
    await panel.getByText('Sales months must be from 1000-01 through 9998-12.',{exact:true}).waitFor()
    await check('csv','{}','recovery')
    step = 'valid recovery upload'
    await anotherFile().setInputFiles(fixture('fractional.csv'));await acceptMeaning(page)
    await liquid(recoveryGood)
    good = recoveryGood // Subsequent fault/race checks retain this exact recovered dataset.
    // Quick-view data uses the same safe failure path, even off the page route.
    await page.evaluate(() => localStorage.setItem('runway-harness.csv_data','{}'))
    await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href + '?theme=light#settings')
    step = 'quick-view invalid CSV recovery off route'
    await page.getByRole('button',{name:'Inventory Manager: quick view',exact:true}).click()
    await page.getByRole('dialog').getByRole('alert').waitFor({state:'visible'})
    await check('csv','{}','recovery') // quickData catches this; React must not throw.
    await page.getByRole('dialog').getByRole('button',{name:'Back to sample data',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'})
    assert.equal(await page.getByRole('dialog').count(),0)
    assert.equal(await panel.count(),0)
    assert.equal(await page.getByRole('heading',{name:'Inventory Manager settings',exact:true}).isVisible(),true)
    assert.deepEqual(await storageState(),{source:'sample',csv:'{}'})
    step = 'main sample after quick-view recovery retains corrupt CSV'
    await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href + '?theme=light')
    await sample('{}')
    step = 'reselect retained corrupt CSV'
    await chooseCsv()
    await check('csv','{}','recovery',datasetFailure)
    step = 'replace retained corrupt CSV through recovery file control'
    await anotherFile().setInputFiles(fixture('fractional.csv'));await acceptMeaning(page)
    await liquid(good)
    // An unexpected calculation exception in a single item holds it; the other survives.
    step = 'per-item exception retains other item'
    await page.evaluate(() => {
      const storage = window.runwayTest.ctx.storage, get = storage.get
      window.restoreRunwayStorage = () => { storage.get = get }
      storage.get = (key, fallback) => {
        const value = get(key, fallback)
        // Fail validation inside calculate's per-item try/catch, not while
        // spreading the held item (a throwing property getter breaks both).
        if (key === 'csv_data') Object.defineProperty(value.items[0].monthly_sales, 'some', {value(){throw Error('PRIVATE item calculation failure')}})
        return value
      }
      window.runwayTest.remount()
    })
    await check('csv',good,'Synthetic fine metre')
    await page.getByRole('button',{name:/Check item data · L ·/}).click()
    assert.match(await selected.innerText(),/Couldn't calculate:/)
    assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE'))
    assert.deepEqual(await storageState(),{source:'csv',csv:good})
    assert.equal(await selected.getByRole('heading',{name:'Synthetic liquid',exact:false}).isVisible(),true)
    assert.equal(await selected.getByRole('img').count(),0,'held item has no calculated chart')
    step = 'restore per-item fault: CSV remains selected'
    await page.evaluate(() => { window.restoreRunwayStorage(); window.runwayTest.remount() })
    await liquid(good)
    // Throw during whole-dataset calculation: no raw error text, working native recovery.
    step = 'saved dataset calculation exception'
    await page.evaluate(() => {
      const storage=window.runwayTest.ctx.storage, get=storage.get
      window.restoreRunwayStorage=()=>{storage.get=get}
      storage.get=(key,fallback)=>{
        const data=get(key,fallback)
        if(key==='csv_data') Object.defineProperty(data,'months',{get(){throw Error('PRIVATE dataset calculation failure')}})
        return data
      }
      window.runwayTest.remount()
    })
    await check('csv',good,'recovery','PRIVATE dataset calculation failure')
    await page.evaluate(() => window.restoreRunwayStorage())
    // A delayed recovery upload must not override Back to sample data.
    step = 'pending recovery upload cancelled by sample'
    await delayRead()
    await anotherFile().setInputFiles(stale);await acceptMeaning(page)
    await pendingRead()
    await check('csv',good,'recovery')
    await recovery().click(); await sample(good); await finishRead()
    await sample(good)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('runway-harness.source'))),'sample')
    assert.equal(await stored(),good)
    // Actual React descendant render failure, including cancellation of the unmounted page's read.
    step = 'pending page upload then descendant render failure'
    await chooseCsv(); await liquid(good); await delayRead()
    await upload().setInputFiles(stale);await acceptMeaning(page)
    await pendingRead()
    await liquid(good)
    await page.evaluate(() => { window.runwayHarnessRenderFailure=true })
    await page.getByRole('searchbox',{name:'Search products or SKUs'}).fill('Synthetic')
    await check('csv',good,'recovery','Synthetic render failure: PRIVATE must never be shown')
    assert.equal(await page.locator('.title-bar').getByRole('alert').count(),0,'unrelated quick-view boundary must remain healthy')
    await page.screenshot({path:'.scratch/a4-screens/a9-recovery-390.png',fullPage:true})
    await page.evaluate(() => { window.runwayHarnessRenderFailure=false })
    step = 'unmounted page read cannot replace recovered sample'
    await recovery().click(); await sample(good); await finishRead()
    await sample(good)
    assert.equal(await stored(),good)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('runway-harness.source'))),'sample')
    assert.deepEqual(uncaughtErrors,[])
    return {actualReact:true,rejectedUploads:4,rejectedRecoveryUpload:true,invalidSavedStates:2,retainedCorruptCsvRecovery:true,
      sourceSwitchRace:true,recoveryRace:true,renderUnmountRace:true,
      perItemException:true,datasetException:true,renderException:true,quickViewRecovery:true,fractionalText:true,
      exactOnHandHeadline:true,exactNowStockCell:true,exactQuickViewStock:true,
      observedErrors, uncaughtErrors, screenshots:['a9-fractional-390.png','a9-recovery-390.png','a10-fractional-now-390.png']}
  } catch (error) {
    const diagnostics = {step, error:String(error), observedErrors, uncaughtErrors}
    try {
      diagnostics.state = await storageState()
      diagnostics.visible = await page.locator('body').innerText()
      diagnostics.pendingCaughtErrors = await page.evaluate(() => window.runwayCaughtErrors)
      await page.screenshot({path:'.scratch/a4-screens/a9-recovery-failure.png',fullPage:true})
    } catch (diagnosticError) { diagnostics.diagnosticError = String(diagnosticError) }
    fs.writeFileSync('.scratch/a9-recovery-failure.json',JSON.stringify(diagnostics,null,2))
    throw Error(`Recovery step failed: ${step}`,{cause:error})
  } finally { await context.close() }
}
let browserStarted=false
;(async () => {
  fs.mkdirSync('.scratch/a4-screens', { recursive: true })
  fs.mkdirSync('.scratch/order-screens', { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--disable-background-networking', '--disable-telemetry', '--no-first-run'] })
  browserStarted=true
  const findings = []
  try {
    for (const width of [360, 390, 1440]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 1100 } })
      await context.route(/^https?:/, route => route.abort())
      await context.addInitScript(freezeOrderToday)
      try {
        const page = await context.newPage(), errors = []
        page.on('pageerror', e => errors.push(e.message))
        page.on('console', e => { if (['error', 'warning'].includes(e.type())) errors.push(e.text()) })
        await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href + `?theme=${theme}`)
        const detail = page.getByRole('region', { name: 'Selected item forecast' })
        await detail.getByRole('heading', { name: 'Supply, demand and inventory', exact: true }).waitFor()
        await page.waitForFunction(() => {
          const panel = document.querySelector('section[aria-label="Inventory items, soonest run-out first"]')
          const detail = document.querySelector('section[aria-label="Selected item forecast"]')
          const svg = detail?.querySelector('svg[role="img"]')
          return svg && Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 1
            && (innerWidth < 720 || detail.getBoundingClientRect().left > panel.getBoundingClientRect().right)
        })
        const samplePanel=page.locator('section[data-order-today]')
        assert.equal(await page.locator('details[data-advanced-settings]').evaluate(el=>el.open),false)
        const sampleCount=await samplePanel.locator('[data-order-sku]').count()
        assert.equal(sampleCount,2,'five-product synthetic sample has two current order rows')
        assert.equal(await page.locator('[data-bucket="all"]').innerText(),'All (5)')
        assert.equal(await samplePanel.getAttribute('aria-label'),`Order today (${sampleCount})`)
        assert.equal(await page.locator('[data-bucket="order"]').innerText(),`Order now (${sampleCount})`)
        assert.match(await samplePanel.innerText(),/Foam floor underlay roll · SKU UL-FOAM-GRN\s+Suggested order\s+38 m\s+Order by\s+11 Nov 2026 · in 0 days/)
        assert.match(await samplePanel.innerText(),/Runs out\s+12 Dec 2026 · in 31 days/)
        const orderGeometry=await checkOrderPlacement(samplePanel)
        await page.screenshot({path:`.scratch/order-screens/sample-${width}-${theme}-initial.png`})
        if(width===1440) assert.ok((await samplePanel.boundingBox()).y+(await samplePanel.boundingBox()).height<1100)
        await page.screenshot({path:`.scratch/order-screens/sample-${width}-${theme}.png`,fullPage:true})
        const chart = detail.getByRole('img')
        const geometry = await chart.evaluate(svg => {
          const attrs = el => ({ x: +el.getAttribute('x'), y: +el.getAttribute('y'), width: +el.getAttribute('width'), height: +el.getAttribute('height') })
          const divider = svg.querySelector('[data-now-divider]')
          const boundary = +divider.getAttribute('x1'), bottom = +divider.getAttribute('y2')
          const sold = [...svg.querySelectorAll('[data-period="sold"]')].map(attrs)
          const forecast = [...svg.querySelectorAll('[data-period="forecast"]')].map(attrs)
          const supply = [...svg.querySelectorAll('[data-period="supply"]')].map(attrs)
          const points = svg.querySelector('polyline').getAttribute('points').split(' ').map(p => p.split(',').map(Number))
          const labels = [...svg.querySelectorAll('text')].map(el => ({ text: el.textContent, ...(() => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom} })() }))
          const grid = svg.querySelector('g line')
          return { sold, forecast, supply, points, boundary, bottom, labels, ratio: (+grid.getAttribute('x2') - +grid.getAttribute('x1')) / (bottom - +divider.getAttribute('y1')), rect: attrs(svg), renderedWidth: svg.getBoundingClientRect().width }
        })
        assert.equal(geometry.sold.length, 12); assert.equal(geometry.forecast.length, 6); assert.equal(geometry.supply.length, 18)
        assert.ok(geometry.sold.every(b => b.x+b.width <= geometry.boundary))
        assert.ok(geometry.forecast.every(b => b.x >= geometry.boundary))
        assert.ok(geometry.points[0][0] < geometry.boundary)
        assert.ok(geometry.points.every(([x,y]) => x >= 0 && y <= geometry.bottom && y >= 30))
        assert.ok(geometry.supply.every(b => Math.abs(b.y+b.height-geometry.bottom) < 0.001))
        if (width === 1440) assert.ok(Math.abs(geometry.ratio - 2) < 0.01)
        if (width < 400) assert.ok(geometry.renderedWidth >= width-34, `chart width ${geometry.renderedWidth} at ${width}`)
        const monthLabels = geometry.labels.filter(l => /^[A-Z][a-z]{2} 20\d\d$/.test(l.text))
        for (let i=1; i<monthLabels.length; i++) assert.ok(monthLabels[i].left >= monthLabels[i-1].right + 2, 'month labels overlap')
        for (const l of geometry.labels) assert.ok(l.left >= 0 && l.right <= width, `clipped label ${l.text}`)
        assert.equal(await chart.locator('[data-runout]').count(), 1)
        assert.ok(await chart.locator('[data-short]').count() > 0)
        await checkChartText(chart,true)
        assert.equal(await chart.locator('[data-inventory-dot]').count(),18)
        assert.equal(await chart.getByText('Out of stock',{exact:true}).isVisible(),true)
        for (const text of ['Past demand','Deliveries','Stock on hand','Forecast demand','Dots show stock at month end.','Left of Now: what happened. Right: forecast.'])
          assert.equal(await detail.locator('figcaption').getByText(text,{exact:true}).isVisible(), true)
        assert.equal(await detail.getByText('7 m left · sells about 2.83 m a month',{exact:true}).isVisible(),true)
        assert.equal(await detail.getByText('Assumes nothing is on order.',{exact:true}).isVisible(),true)
        assert.equal(await page.getByText('Red: runs out soonest · Amber: next · Grey: later',{exact:true}).count(),0) // polish: colour legend replaced by labelled status badges with icons
        assert.equal(await page.getByRole('button',{name:'My file (CSV)',exact:true}).isVisible(),true)
        assert.equal(await page.getByText('Look ahead',{exact:true}).isVisible(),true)
        const disclosures = detail.locator('details')
        assert.deepEqual(await disclosures.evaluateAll(ds => ds.map(d=>d.open)), [false,false,false,false])
        const shot = `.scratch/a4-screens/inventory-${width}-${theme}.png`
        await page.screenshot({ path: shot, fullPage: true })
        const past = detail.locator('summary').filter({hasText:'Past sales ('})
        await past.focus(); await page.keyboard.press('Enter')
        const pastTable = detail.locator('table').filter({has:page.locator('caption:text-is("Past sales")')})
        assert.equal(await pastTable.isVisible(), true)
        assert.equal(await pastTable.getByRole('row').count(),13)
        assert.equal(await pastTable.getByRole('row').nth(1).innerText(),'Oct 2026\t34 m')
        await page.keyboard.press('Enter'); assert.equal(await pastTable.isVisible(),false)
        await detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'}).click()
        const timelineTable = detail.locator('table').filter({has:page.locator('caption:text-is("Month by month: stock, sales, deliveries")')})
        assert.equal(await timelineTable.getByRole('columnheader',{name:'Month',exact:true}).isVisible(),true)
        assert.equal(await timelineTable.getByRole('columnheader',{name:'Sold / Forecast',exact:true}).isVisible(),true)
        assert.equal(await timelineTable.getByRole('columnheader',{name:'Delivered',exact:true}).isVisible(),true)
        assert.equal(await timelineTable.getByRole('columnheader',{name:'Stock at month end',exact:true}).isVisible(),true)
        assert.equal(await timelineTable.getByRole('row').count(),20, '12 history + Now + 6 forecast + header')
        assert.equal(await timelineTable.getByRole('row').nth(1).innerText(),'Nov 2025\t0 m\t0 m\tReconstructed 93 m')
        assert.equal(await timelineTable.getByRole('row').nth(12).innerText(),'Oct 2026\t34 m\t0 m\tReconstructed 7 m')
        assert.deepEqual(await timelineTable.getByRole('row').nth(13).locator('th,td').allTextContents(),['Now','','','7 m'])
        assert.equal(await timelineTable.getByRole('row').nth(14).innerText(),'Nov 2026 · Forecast\t2.83 m\t0 m\t4.17 m')
        const timelineRegion=timelineTable.locator('xpath=ancestor::div[@role="region"]')
        assert.equal(await timelineRegion.evaluate(el=>getComputedStyle(el).overflowX),'auto')
        const scrollState=await timelineRegion.evaluate(el=>({clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}))
        assert.ok(scrollState.scrollWidth>=scrollState.clientWidth)
        if(scrollState.scrollWidth>scrollState.clientWidth){
          await timelineRegion.evaluate(el=>{el.scrollLeft=el.scrollWidth})
          assert.ok(await timelineRegion.evaluate(el=>el.scrollLeft>0),'narrow timeline scroll stays in its table region')
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
          await timelineRegion.evaluate(el=>{el.scrollLeft=0})
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
        const expandedShot = `.scratch/a4-screens/a8-timeline-${width}-${theme}.png`
        await page.screenshot({path:expandedShot,fullPage:true})
        await detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'}).click()
        assert.equal(await timelineTable.isVisible(),false)
        const timelineSummary=detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'})
        await timelineSummary.focus(); await page.keyboard.press('Space')
        assert.equal(await timelineTable.isVisible(),true)
        await page.keyboard.press('Space'); assert.equal(await timelineTable.isVisible(),false)
        assert.equal(await detail.locator('summary').getByText('How the forecast works',{exact:true}).isVisible(),true)
        await detail.locator('summary').filter({hasText:'How good is this forecast?'}).click()
        assert.equal(await detail.getByText(/^Error: \d+%$/).isVisible(),true)
        const qualityTable = detail.locator('table').filter({has:page.locator('caption:text-is("Last four months")')})
        assert.equal(await qualityTable.isVisible(),true)
        assert.equal(await qualityTable.getByRole('row').count(),5)
        await detail.locator('summary').filter({hasText:'How good is this forecast?'}).click()
        const browserPanel = page.getByRole('region',{name:'Inventory items, soonest run-out first'})
        await browserPanel.locator('summary').filter({hasText:'Underlay · 1'}).click()
        assert.equal(await browserPanel.getByRole('button',{name:/UL-FOAM-GRN/}).isVisible(),false)
        await browserPanel.locator('summary').filter({hasText:'Underlay · 1'}).click()
        await browserPanel.getByRole('button',{name:'All SKUs',exact:true}).click()
        assert.equal(await browserPanel.locator('details').count(),0)
        await browserPanel.getByRole('searchbox').fill('TRM-ALU')
        assert.equal(await browserPanel.getByRole('button',{name:/TRM-ALU-25/}).count(),1)
        await browserPanel.getByRole('button',{name:/TRM-ALU-25/}).click()
        await detail.getByRole('heading',{name:'Aluminium edge trim',exact:false}).waitFor()
        assert.equal(await detail.getByText('42 m left · sells about 7.67 m a month',{exact:true}).isVisible(),true)
        await checkChartText(chart,false)
        await browserPanel.getByRole('searchbox').fill('NO SUCH SYNTHETIC SKU')
        assert.equal(await browserPanel.getByText('No matching products.',{exact:true}).isVisible(),true)
        await browserPanel.getByRole('searchbox').fill('')
        await browserPanel.getByRole('button',{name:'By type',exact:true}).click()
        assert.equal(await browserPanel.locator('summary').count(),4)
        const shortHistory = []
        for (const zeroSales of [false,true]) {
          const fixture = {as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:[{
            sku:'SHORT',name:'Synthetic short history',unit:'units',on_hand:5,supplier_days:null,
            monthly_sales:zeroSales?[0,0,0]:[10,10,10],receipts:{},
            ...(zeroSales?{}:{historical_receipts:{'2026-08':0,'2026-09':0,'2026-10':0}}),
          }]}
          await page.evaluate(data=>{
            localStorage.setItem('runway-harness.csv_data',JSON.stringify(data))
            localStorage.setItem('runway-harness.source',JSON.stringify('csv'))
            localStorage.setItem('runway-harness.last_horizon','12')
          },fixture)
          await page.reload()
          await detail.getByRole('heading',{name:'Synthetic short history',exact:false}).waitFor()
          await page.waitForFunction(()=>{
            const svg=document.querySelector('section[aria-label="Selected item forecast"] svg[role="img"]')
            return svg && Math.abs(svg.viewBox.baseVal.width-svg.getBoundingClientRect().width)<1
          })
          assert.equal(await chart.locator('[data-period="sold"]').count(),3)
          assert.equal(await chart.locator('[data-period="forecast"]').count(),12)
          assert.equal(await detail.getByText('Add delivery history to see past inventory.',{exact:true}).count(),zeroSales?2:0)
          await detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'}).click()
          const shortTimeline=detail.locator('table').filter({has:page.locator('caption:text-is("Month by month: stock, sales, deliveries")')})
          const shortDisclosure=detail.locator('details').filter({has:page.locator('summary:text-is("Month by month: stock, sales, deliveries")')})
          assert.equal(await shortTimeline.getByRole('row').count(),17)
          if(zeroSales){
            assert.match(await shortTimeline.getByRole('row').nth(1).innerText(),/^Aug 2026\t0 units\tUnknown\tUnknown$/)
            assert.equal(await shortDisclosure.getByText('Add delivery history to see past inventory.',{exact:true}).isVisible(),true)
          } else {
            assert.equal(await shortTimeline.getByRole('row').nth(1).innerText(),'Aug 2026\t10 units\t0 units\tReconstructed 25 units')
          }
          const textRects=await checkChartText(chart,!zeroSales)
          const screenshot=`.scratch/a4-screens/a8-short-${zeroSales?'unknown':'known'}-${width}-${theme}.png`
          await page.screenshot({path:screenshot,fullPage:true})
          await detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'}).click()
          shortHistory.push({zeroSales,textRects,screenshot})
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
        assert.ok(!/undefined|NaN|\[object Object\]/.test(await page.locator('main').innerText()))
        assert.deepEqual(errors,[])
        findings.push({width,theme,screenshot:shot,barCounts:[12,18,6],ratio:geometry.ratio,keyboardDisclosures:true,searchToggleSelection:true,shortHistory,orderGeometry,overflow:false,errors})
      } finally { await context.close() }
    }
    const recovery = await checkRecovery(browser)
    const timeline = await checkTimelineMatrix(browser)
    const orderGuidance = await checkOrderGuidanceMatrix(browser)
    fs.writeFileSync('.scratch/order-screens/report.json',JSON.stringify({caption:'Local offline harness only, not real Desktop. Sample and focused synthetic screenshots captured before settings interactions with All settings collapsed. Actual today fixed to 11 Nov 2026.',sample:[360,390,1440].flatMap(width=>['light','dark'].map(theme=>`.scratch/order-screens/sample-${width}-${theme}.png`)),orderGuidance},null,2))
    console.log(JSON.stringify({label:'Offline harness, not real Desktop', findings, recovery, timeline, orderGuidance},null,2))
  } finally { await browser.close() }
})().catch(error => {
  const report={caption:'Local offline harness only; failed execution is not visual proof.',stage:browserStarted?'browser-assertions':'browser-launch',error:String(error),
    cases:[360,390,1440].flatMap(width=>['light','dark'].map(theme=>({width,theme,status:'not-verified',required:['sample','B1','TRUE-GAP','ZERO-DAY','existing recovery/timeline/order gates']})))}
  fs.writeFileSync('.scratch/order-screens/report.json',JSON.stringify(report,null,2))
  console.error(error); process.exitCode=1
})
