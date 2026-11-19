// Lifecycle: living. Option A2 only; local file:// QA, no server/install/network.
// PLAYWRIGHT_MODULE=/absolute/path/playwright/index.js node standalone/capture-a2.cjs
// Optional CHROMIUM_EXECUTABLE must name an isolated QA browser, never normal Chrome.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const target = path.join(__dirname, 'design/option-a2.html')
const out = path.join(root, '.scratch/design')
const reportPath = path.join(out, 'a2-browser-report.json')
const CHART = '.chart-wrap svg[data-chart]'
const FROZEN_DATE = '2026-11-11T09:00:00Z'
const names = [
  'option-a2-1440x900-light', 'option-a2-1440x900-dark',
  'option-a2-1440x900-light-zoom6m', 'option-a2-1440x900-light-all',
  'option-a2-390x844-light', 'option-a2-390x844-light-tooltip',
]
const report = { status:'RUNNING', target, frozenDate:FROZEN_DATE, checks:[], stages:[],
  screenshots:[], networkRequests:[], browserErrors:[], geometry:[], gestures:[], notChecked:[] }
let browser
function check(name, condition, evidence) {
  const result = {name, pass:Boolean(condition)}
  if (evidence !== undefined) result.evidence = evidence
  report.checks.push(result)
  if (!condition) console.error(`FAIL: ${name}`)
  return result.pass
}
async function stage(name, action) {
  try { await action(); report.stages.push({name, completed:true}) }
  catch (error) {
    report.stages.push({name, completed:false, error:error.stack || String(error)})
    check(`${name}: completed without harness/interaction exception`, false, error.message)
  }
}
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.waitForTimeout(300) // Existing entry animation is <=260 ms.
}
async function state(page) {
  return page.locator(CHART).first().evaluate(el => ({
    visible:Number(el.dataset.visibleMonths), start:Number(el.dataset.windowStart), end:Number(el.dataset.windowEnd),
    raw:{...el.dataset},
  }))
}
function validWindow(label, s, total) {
  check(`${label}: finite discrete monthly window`, [s.visible,s.start,s.end].every(Number.isInteger)
    && s.visible >= Math.min(3,total) && s.visible <= total && s.start >= 0 && s.start <= total-s.visible
    && s.end <= total && s.end >= s.start
    && s.end-s.start===s.visible, s)
}
async function preset(page, value, total, label = value) {
  await page.locator(`[data-zoom="${value}"]`).first().click()
  await settle(page)
  const s = await state(page)
  if (value !== 'reset') check(`${label}: actual visible month count`, s.visible === (value === 'all' ? total : Math.min(Number(value),total)), s)
  validWindow(label,s,total)
  return s
}
// Preserve the chart heading AND its controls. Only scroll when the complete chart
// region is outside the viewport; never use locator.screenshot (it auto-scrolls).
async function frameChart(page, label) {
  const bounds = await page.locator(CHART).first().evaluate(svg => {
    const figure=svg.closest('figure') || svg.parentElement
    const controls=[...figure.querySelectorAll('[data-zoom]')]
    const panel=figure.closest('.chart-panel'), heading=panel?.querySelector('.chart-heading')
    const elements=[svg,figure.querySelector('h3'),...controls].filter(Boolean)
    if (heading) elements.push(heading)
    const rects=elements.map(el=>el.getBoundingClientRect())
    return {top:Math.min(...rects.map(r=>r.top)),bottom:Math.max(...rects.map(r=>r.bottom)),height:innerHeight,scrollY}
  })
  if (bounds.top < 8 || bounds.bottom > bounds.height-8) {
    await page.evaluate(({bounds}) => {
      // Keep top controls when a region genuinely cannot all fit. Geometry below
      // reports that defect rather than hiding it with a cropped element capture.
      window.scrollTo({top:Math.max(0,bounds.scrollY+bounds.top-12),behavior:'instant'})
    },{bounds})
    await settle(page)
  }
  const fit = await page.locator(CHART).first().evaluate(svg => {
    const r=svg.getBoundingClientRect(), figure=svg.closest('figure') || svg.parentElement
    const controls=[...figure.querySelectorAll('[data-zoom]')].map(el=>{
      const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)
      return {label:el.textContent.trim(),top:b.top,bottom:b.bottom,left:b.left,right:b.right,
        hit:hit===el || el.contains(hit)}
    })
    return {svg:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height},controls,
      viewport:{width:innerWidth,height:innerHeight},scrollY}
  })
  check(`${label}: chart painted and fully in viewport`,fit.svg.width>0 && fit.svg.height>0
    && fit.svg.top>=0 && fit.svg.bottom<=fit.viewport.height+1 && fit.svg.left>=-1 && fit.svg.right<=fit.viewport.width+1,fit)
  check(`${label}: header controls visible and hit-testable`,fit.controls.length>=5 && fit.controls.every(c=>c.top>=0 && c.bottom<=fit.viewport.height && c.left>=0 && c.right<=fit.viewport.width+1 && c.hit),fit.controls)
  return fit
}
async function geometry(page,label) {
  const result = await page.evaluate(() => {
    const rect = el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
    const visible = el => {
      for(let p=el;p;p=p.parentElement) {
        const c=getComputedStyle(p)
        if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0)return false
        if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope > summary')?.contains(el))return false
      }
      const r=el.getBoundingClientRect();return r.width>0&&r.height>0
    }
    const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1
      && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1
    const text=[...document.querySelectorAll('.chart-wrap svg[data-chart] text')].filter(visible)
      .map(el=>({text:el.textContent.trim(),class:el.getAttribute('class'),attrs:[...el.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]),box:rect(el),container:rect(el.closest('svg'))}))
      .filter(t=>t.text)
    const clipped=text.filter(t=>t.box.left<t.container.left-1 || t.box.right>t.container.right+1
      || t.box.top<t.container.top-1 || t.box.bottom>t.container.bottom+1)
    const collisions=[]
    for(let i=0;i<text.length;i++)for(let j=i+1;j<text.length;j++)if(overlaps(text[i].box,text[j].box))collisions.push({a:text[i],b:text[j]})
    const htmlLabels=[...document.querySelectorAll('.chart-heading h2,.chart-heading .big-order,.inventory-figure h3,[data-zoom]')].filter(visible)
      .map(el=>({text:el.textContent.trim(),box:rect(el)}))
    const htmlCollisions=[]
    for(let i=0;i<htmlLabels.length;i++)for(let j=i+1;j<htmlLabels.length;j++)if(overlaps(htmlLabels[i].box,htmlLabels[j].box))htmlCollisions.push({a:htmlLabels[i],b:htmlLabels[j]})
    const tooltips=[...document.querySelectorAll('.chart-tooltip')].filter(visible).map(el=>({text:el.textContent,box:rect(el)}))
    const tooltipLabelCollisions=tooltips.flatMap(t=>text.filter(v=>overlaps(t.box,v.box)).map(v=>({tooltip:t.text,label:v.text})))
    const stockLabelCollisions=[]
    for(const path of document.querySelectorAll('[data-inventory-line]')){
      const labels=[...path.closest('svg').querySelectorAll('[data-value-label]')].map(el=>({text:el.textContent,box:rect(el)})),matrix=path.getScreenCTM()
      if(labels.length)for(let d=0;d<=path.getTotalLength();d+=1){const p=path.getPointAtLength(d),x=matrix.a*p.x+matrix.c*p.y+matrix.e,y=matrix.b*p.x+matrix.d*p.y+matrix.f;for(const label of labels)if(x>=label.box.left&&x<=label.box.right&&y>=label.box.top&&y<=label.box.bottom){stockLabelCollisions.push(label.text);break}}
    }
    const duplicates=[...document.querySelectorAll('[id]')].map(el=>el.id).filter((id,i,ids)=>ids.indexOf(id)!==i)
    return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,
      textCount:text.length,clipped,collisions,htmlCollisions,tooltips,tooltipLabelCollisions,stockLabelCollisions,duplicates}
  })
  report.geometry.push({label,...result})
  check(`${label}: no horizontal page overflow`,result.pageWidth<=result.width,result)
  check(`${label}: rendered chart text inspected`,result.textCount>0,result.textCount)
  check(`${label}: chart labels fit SVG`,result.clipped.length===0,result.clipped)
  check(`${label}: no chart text overlaps (including bar/stock labels)`,result.collisions.length===0,result.collisions)
  check(`${label}: no header/control overlaps`,result.htmlCollisions.length===0,result.htmlCollisions)
  check(`${label}: no stock line through value labels`,result.stockLabelCollisions.length===0,result.stockLabelCollisions)
  check(`${label}: tooltip does not obscure chart labels`,result.tooltipLabelCollisions.length===0,result.tooltipLabelCollisions)
  check(`${label}: unique IDs`,result.duplicates.length===0,result.duplicates)
  check(`${label}: tooltip stays inside viewport`,result.tooltips.every(t=>t.box.left>=0 && t.box.right<=result.width+1 && t.box.top>=0 && t.box.bottom<=result.height+1),result.tooltips)
}
async function shot(page,name) {
  await settle(page)
  await frameChart(page,name)
  await geometry(page,name)
  const file=path.join(out,`${name}.png`)
  const before=await page.evaluate(()=>({x:scrollX,y:scrollY}))
  await page.screenshot({path:file,fullPage:false,animations:'disabled',scale:'css'})
  const after=await page.evaluate(()=>({x:scrollX,y:scrollY}))
  const bytes=fs.readFileSync(file)
  const dimensions={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}
  const expected=name.includes('390x844')?{width:390,height:844}:{width:1440,height:900}
  check(`${name}: exact PNG viewport`,dimensions.width===expected.width && dimensions.height===expected.height,dimensions)
  check(`${name}: capture does not move viewport`,before.x===after.x && before.y===after.y,{before,after})
  report.screenshots.push({name,path:file,bytes:bytes.length,...dimensions,scroll:after})
}
async function open(browser,viewport,theme,mobile=false) {
  const context=await browser.newContext({viewport,deviceScaleFactor:1,colorScheme:theme,timezoneId:'Asia/Kuwait',offline:true,hasTouch:mobile,isMobile:mobile,serviceWorkers:'block'})
  await context.route('**/*',route=>/^https?:/i.test(route.request().url())?route.abort('internetdisconnected'):route.continue())
  context.on('request',req=>{if(/^https?:/i.test(req.url()))report.networkRequests.push({url:req.url(),method:req.method()})})
  context.on('page',page=>{
    page.on('pageerror',error=>report.browserErrors.push({type:'pageerror',message:error.message}))
    page.on('console',msg=>{if(msg.type()==='error')report.browserErrors.push({type:'console',message:msg.text()})})
  })
  await context.addInitScript(fixedDate=>{
    const RealDate=Date,fixed=new RealDate(fixedDate).getTime()
    globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}
  },FROZEN_DATE)
  const page=await context.newPage()
  page.setDefaultTimeout(6000)
  await page.goto(pathToFileURL(target).href,{waitUntil:'load'})
  await page.locator(CHART).first().waitFor({state:'visible'})
  await settle(page)
  check(`${viewport.width}-${theme}: sample provenance`,/Sample data/.test(await page.locator('#snapshot').textContent()))
  check(`${viewport.width}-${theme}: system theme`,await page.evaluate(theme=>getComputedStyle(document.documentElement).colorScheme.includes(theme),theme))
  return {page,context}
}
async function controlKeyboard(page,label) {
  const controls=page.locator('[data-zoom]')
  check(`${label}: five preset/reset controls`,await controls.count()===5)
  for(const value of ['6','12','24','all','reset']) {
    const control=page.locator(`[data-zoom="${value}"]`).first()
    check(`${label}: ${value} enabled/focusable`,await control.evaluate(el=>!el.disabled && el.tabIndex>=0))
    await control.focus()
    check(`${label}: ${value} receives keyboard focus`,await control.evaluate(el=>document.activeElement===el))
    await page.keyboard.press('Enter')
  }
  // Real Tab traversal proves controls are in the keyboard sequence, not merely focusable by script.
  await page.locator('[data-zoom="6"]').first().focus()
  const reached=new Set(['6'])
  for(let i=0;i<12;i++) {
    await page.keyboard.press('Tab')
    const value=await page.evaluate(()=>document.activeElement?.getAttribute('data-zoom'))
    if(value)reached.add(value)
  }
  check(`${label}: all presets/reset reachable by Tab`,['6','12','24','all','reset'].every(v=>reached.has(v)),[...reached])
}
async function drag(page,dx) {
  const b=await page.locator(CHART).first().boundingBox()
  const x=dx>0?b.x+b.width*.18:b.x+b.width*.82,y=b.y+b.height*.50
  await page.mouse.move(x,y);await page.mouse.down()
  await page.mouse.move(x+dx*b.width,y,{steps:12});await page.mouse.up();await settle(page)
}
// Preset clicks move the native mouse onto the toolbar, outside the wheel
// listener. Reacquire and hit-test the chart before every real wheel gesture;
// observe delivery rather than treating a fixed settling delay as input proof.
async function nativeWheel(page, dx, dy) {
  await page.mouse.move(0,0)
  await frameChart(page,`native wheel ${dx},${dy}`)
  const point=await page.locator(CHART).first().evaluate(svg=>{
    const r=svg.getBoundingClientRect(),x=r.x+r.width*.55,y=r.y+r.height*.55
    const wrap=svg.closest('.chart-wrap'),hit=document.elementFromPoint(x,y)
    window.a2NativeWheelSeen=0
    wrap.addEventListener('wheel',()=>window.a2NativeWheelSeen++,{once:true,capture:true})
    return {x,y,hit:!!hit&&wrap.contains(hit)}
  })
  if(!check(`native wheel ${dx},${dy}: chart target hit-testable`,point.hit,point))throw Error('Native wheel chart target unavailable')
  await page.mouse.move(point.x,point.y)
  await page.mouse.wheel(dx,dy)
  await page.waitForFunction(()=>window.a2NativeWheelSeen>0)
  await settle(page)
}
async function desktopInteractions(page,total,initial) {
  await controlKeyboard(page,'desktop')
  for(const value of ['6','12','24','all']) {
    await preset(page,value,total,`desktop ${value}`)
    await geometry(page,`desktop preset ${value}`)
  }
  await preset(page,'6',total)
  await frameChart(page,'desktop interactions')
  const six=await state(page),b=await page.locator(CHART).first().boundingBox()
  await page.mouse.move(b.x+b.width*.55,b.y+b.height*.55)
  await nativeWheel(page,500,0)
  check('horizontal-only wheel leaves monthly window unchanged',JSON.stringify(await state(page))===JSON.stringify(six),{before:six,after:await state(page)})
  for(const ctrlKey of [false,true]) {
    const evidence=await page.locator(CHART).first().evaluate((svg,ctrlKey)=>{
      const wrap=svg.closest('.chart-wrap'),grid=[...svg.querySelectorAll('line')].find(el=>el.getAttribute('stroke-width')==='1.5')
      const rect=svg.getBoundingClientRect(),anchor=.8
      const clientX=rect.left+Number(grid.getAttribute('x1'))+(Number(grid.getAttribute('x2'))-Number(grid.getAttribute('x1')))*anchor
      const read=()=>{const el=wrap.querySelector('svg');return{count:Number(el.dataset.visibleMonths),start:Number(el.dataset.windowStart)}}
      const before=read(),wheel=()=>wrap.dispatchEvent(new WheelEvent('wheel',{deltaY:-.25,clientX,ctrlKey,bubbles:true,cancelable:true}))
      wheel();const first=read()
      for(let i=0;i<200;i++)wheel()
      return {before,first,after:read(),anchor,ctrlKey}
    },ctrlKey)
    check(`${ctrlKey?'ctrl pinch':'wheel'}: one tiny delta does not jump monthly zoom`,evidence.first.count===evidence.before.count,evidence)
    check(`${ctrlKey?'ctrl pinch':'wheel'}: accumulated tiny deltas change monthly zoom`,evidence.after.count<evidence.before.count,evidence)
    check(`${ctrlKey?'ctrl pinch':'wheel'}: pointer month preserved within monthly snap`,Math.abs(evidence.before.start+evidence.before.count*evidence.anchor-evidence.after.start-evidence.after.count*evidence.anchor)<=.5,evidence)
    validWindow(`${ctrlKey?'ctrl pinch':'wheel'}: accumulated tiny delta clamp`,await state(page),total)
    await preset(page,'6',total)
  }
  await nativeWheel(page,0,500)
  const zoomedOut=await state(page)
  check('wheel down increases visible months',zoomedOut.visible>six.visible || six.visible===total,{before:six,after:zoomedOut})
  validWindow('wheel zoom out',zoomedOut,total)
  await nativeWheel(page,0,-500)
  const zoomedIn=await state(page)
  check('wheel up decreases visible months',zoomedIn.visible<zoomedOut.visible || zoomedOut.visible===1,{before:zoomedOut,after:zoomedIn})
  validWindow('wheel zoom in',zoomedIn,total)
  // Large wheel deltas must never produce fractional or out-of-domain windows.
  for(const delta of [-5000,5000]) {
    await nativeWheel(page,0,delta)
    const bounded=await state(page)
    validWindow(`wheel clamp ${delta}`,bounded,total)
    check(`wheel ${delta} reaches exact zoom bound`,bounded.visible===(delta<0?3:total),bounded)
    const prevented=await page.locator(CHART).first().evaluate((svg,deltaY)=>[false,true].map(ctrlKey=>{
      const event=new WheelEvent('wheel',{deltaY,ctrlKey,bubbles:true,cancelable:true})
      svg.dispatchEvent(event);return event.defaultPrevented
    }),delta)
    check(`wheel ${delta} at bound releases page scroll and prevents ctrl browser zoom`,!prevented[0]&&prevented[1],prevented)
  }
  await preset(page,'6',total)
  const beforeDrag=await state(page)
  for(let i=0;i<8;i++)await drag(page,-.62)
  const right=await state(page)
  validWindow('drag right clamp',right,total)
  check('leftward pointer drag reaches final month boundary',right.start===total-right.visible,{before:beforeDrag,after:right})
  for(let i=0;i<8;i++)await drag(page,.62)
  const left=await state(page)
  validWindow('drag left clamp',left,total)
  check('rightward pointer drag reaches first month boundary',left.start===0,left)
  check('pointer drag actually pans',total<=left.visible || right.start!==left.start,{left,right})
  // Focus before baseline: moving focus alone is not interaction proof.
  await page.locator(CHART).first().focus()
  let before=await state(page)
  await page.keyboard.press('+');await settle(page)
  let after=await state(page)
  check('keyboard + zooms in',after.visible<before.visible || before.visible===1,{before,after})
  validWindow('keyboard +',after,total)
  before=after;await page.keyboard.press('-');await settle(page);after=await state(page)
  check('keyboard - zooms out',after.visible>before.visible || before.visible===total,{before,after})
  validWindow('keyboard -',after,total)
  await preset(page,'6',total)
  for(let i=0;i<8;i++)await drag(page,.62)
  await page.locator(CHART).first().focus()
  before=await state(page);await page.keyboard.press('ArrowRight');await settle(page);after=await state(page)
  check('keyboard ArrowRight pans by a discrete month',total<=before.visible || after.start===before.start+1,{before,after})
  await page.keyboard.press('ArrowLeft');await settle(page)
  check('keyboard ArrowLeft reverses pan',(await state(page)).start===before.start,await state(page))
  await page.keyboard.press('ArrowLeft');await settle(page)
  check('keyboard left boundary clamps',(await state(page)).start===0,await state(page))
  const reset=await preset(page,'reset',total)
  check('Reset restores initial window',reset.visible===initial.visible && reset.start===initial.start && reset.end===initial.end,{initial,reset})
}
async function receiptsTooltip(page,sample,label,mobile=false) {
  // Pick a real built-in sample item through its button; no fabricated fixture.
  const available=await page.locator('button[data-sku]').evaluateAll(els=>els.map(el=>el.dataset.sku))
  const item=sample.items.find(i=>available.includes(i.sku) && Object.values(i.historical_receipts||{}).some(q=>q>0))
  if(!check(`${label}: selectable SAMPLE item has receipts`,Boolean(item),available))throw Error('No selectable sample receipt item')
  // Find by exact dataset in JS only to resolve its index; activate with real input.
  const index=await page.locator('button[data-sku]').evaluateAll((els,sku)=>els.findIndex(el=>el.dataset.sku===sku),item.sku)
  await page.locator('button[data-sku]').nth(index).click();await settle(page)
  await page.locator('[data-zoom="all"]').first().click();await settle(page)
  await frameChart(page,`${label} tooltip`)
  const markers=page.locator(`${CHART} circle[data-delivery-marker]`)
  check(`${label}: nonzero receipt markers exist`,await markers.count()>0,await markers.count())
  const marker=markers.first()
  const attrs=await marker.evaluate(el=>({dataset:{...el.dataset},label:el.getAttribute('aria-label'),text:el.querySelector('title')?.textContent}))
  const metadata=[attrs.dataset.month,attrs.dataset.date,attrs.dataset.deliveryDate,attrs.label,attrs.text,attrs.dataset.deliveryMarker].filter(Boolean).join(' ')
  const month=Object.keys(item.historical_receipts).find(month=>metadata.includes(month))
    || Object.keys(item.historical_receipts).filter(m=>item.historical_receipts[m]>0)[0]
  const quantity=item.historical_receipts[month]
  async function verify(method) {
    const tooltip=page.locator('.chart-tooltip:visible').first()
    await tooltip.waitFor({state:'visible'})
    const text=(await tooltip.textContent()).replace(/\s+/g,' ').trim()
    const quantityText=await tooltip.locator('span').first().textContent()
    const shownQuantity=Number(quantityText.match(/^[\d,]+(?:\.\d+)?/)?.[0].replaceAll(',',''))
    const date=new Date(`${month}-01T00:00:00Z`)
    const monthText=date.toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'})
    const year=month.slice(0,4)
    check(`${label}: ${method} tooltip identifies delivery`,/deliver|receipt/i.test(text),text)
    check(`${label}: ${method} tooltip matches SAMPLE quantity ${quantity}`,shownQuantity===quantity,{sku:item.sku,month,quantity,text,attrs})
    check(`${label}: ${method} tooltip includes receipt date`,text.includes(month) || (text.includes(monthText)&&text.includes(year)),{month,text})
    check(`${label}: ${method} tooltip discloses monthly date precision`,text.includes('Monthly total · exact date unavailable'),text)
    return text
  }
  await marker.focus();await settle(page);await verify('focus')
  await page.keyboard.press('Escape');await page.mouse.move(0,0)
  const box=await marker.boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down();await settle(page);await verify('pointerdown');await page.mouse.up()
  await marker.click();await settle(page);await verify('click')
  if(mobile) {
    await page.keyboard.press('Escape')
    await marker.tap();await settle(page);await verify('touch tap')
  }
  await geometry(page,`${label} delivery tooltip`)
  return {sku:item.sku,month,quantity}
}
async function touchGestures(page,total) {
  const cdp=await page.context().newCDPSession(page)
  try {
    await preset(page,'6',total)
    await frameChart(page,'touch gesture')
    const b=await page.locator(CHART).first().boundingBox(),cx=b.x+b.width*.52,cy=b.y+b.height*.5
    const points=(distance)=>[{x:cx-distance,y:cy,id:1},{x:cx+distance,y:cy,id:2}]
    const before=await state(page)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(65)})
    for(const d of [60,50,40,30,22])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(d)})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(page)
    const pinchIn=await state(page)
    validWindow('CDP touch pinch in',pinchIn,total)
    check('CDP pinch in zooms out',pinchIn.visible>before.visible || before.visible===total,{before,after:pinchIn})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(22)})
    for(const d of [30,40,50,65,80])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(d)})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(page)
    const pinchOut=await state(page)
    validWindow('CDP touch pinch out',pinchOut,total)
    check('CDP pinch out zooms in',pinchOut.visible<pinchIn.visible || pinchIn.visible===1,{before:pinchIn,after:pinchOut})
    await preset(page,'6',total)
    const start=await state(page)
    const direction=start.start<total-start.visible ? -1 : 1
    const x=b.x+b.width*(direction<0?.8:.2)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:cy,id:1}]})
    for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+direction*b.width*.55*i/10,y:cy,id:1}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(page)
    const end=await state(page)
    validWindow('CDP touch swipe',end,total)
    check('CDP single-finger swipe pans chart',total<=start.visible || start.start!==end.start,{before:start,after:end})
    report.gestures.push({method:'CDP Input.dispatchTouchEvent',before,pinchIn,pinchOut,swipe:{start,end}})
  } finally {await cdp.detach()}
}
function sampleCore() {
  const plugin=fs.readFileSync(path.join(root,'desktop/plugin.js'),'utf8')
  const context=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
  const start=plugin.indexOf('const SAMPLE ='),end=plugin.indexOf('const pageStyle =')
  if(start<0||end<=start)throw Error('Plugin core extraction anchors missing')
  vm.runInContext(plugin.slice(start,end).replaceAll('export ','')+'\nglobalThis.api={SAMPLE,evaluateDataset,DEFAULT_ORDER_SETTINGS}',context)
  const core=context.api
  const rows=core.evaluateDataset(core.SAMPLE,6,core.DEFAULT_ORDER_SETTINGS)
  const projectionLengths=[...new Set(rows.filter(r=>r.projection?.length).map(r=>r.projection.length))]
  if(projectionLengths.length!==1)throw Error(`Ambiguous SAMPLE projection length: ${projectionLengths}`)
  return {sample:core.SAMPLE,total:core.SAMPLE.months.length+projectionLengths[0]}
}
async function main() {
  if(process.argv.includes('--help')) {
    console.log('Usage: PLAYWRIGHT_MODULE=/absolute/path/playwright/index.js [CHROMIUM_EXECUTABLE=/isolated/browser] node standalone/capture-a2.cjs\nRequires generated standalone/design/option-a2.html. Writes only .scratch/design/ PNGs and a2-browser-report.json. No install, build, server, or network. Exit 0 only when every required check and all six captures pass.')
    return
  }
  fs.mkdirSync(out,{recursive:true})
  try {
    if(!fs.existsSync(target))throw Error('Option A2 is not generated yet; ask the main worker to build it, then rerun. No browser checks or captures ran.')
    report.sourceSha256=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    const modulePath=process.env.PLAYWRIGHT_MODULE
    if(!modulePath)throw Error('Set PLAYWRIGHT_MODULE to the existing Playwright module (same resolution contract as standalone/capture.cjs). No installation is attempted.')
    const executablePath=process.env.CHROMIUM_EXECUTABLE || path.join(os.homedir(),'.local/bin/qa-chrome')
    if(executablePath.includes('/Google Chrome.app/'))throw Error('Refusing normal Google Chrome; use an isolated QA executable.')
    if(!fs.existsSync(executablePath))throw Error(`Isolated browser not found: ${executablePath}`)
    const {chromium}=require(modulePath),{sample,total}=sampleCore()
    report.expectedTotalMonths=total
    report.playwrightModule=require.resolve(modulePath)
    report.executablePath=executablePath
    browser=await chromium.launch({headless:true,executablePath})
    report.browserVersion=browser.version()
    let desktop,dark,mobile
    await stage('desktop light captures and interaction QA',async()=>{
      desktop=await open(browser,{width:1440,height:900},'light')
      const {page}=desktop,initial=await state(page)
      report.initialDesktopWindow=initial
      validWindow('desktop initial',initial,total)
      await shot(page,names[0])
      await preset(page,'6',total);await shot(page,names[2])
      await preset(page,'all',total);await shot(page,names[3])
      await desktopInteractions(page,total,initial)
    })
    await stage('desktop receipt marker tooltip QA',async()=>{
      if(!desktop)throw Error('Desktop unavailable')
      await receiptsTooltip(desktop.page,sample,'desktop')
    })
    if(desktop)await desktop.context.close()
    await stage('desktop dark capture',async()=>{
      dark=await open(browser,{width:1440,height:900},'dark')
      await shot(dark.page,names[1])
    })
    if(dark)await dark.context.close()
    await stage('mobile light capture',async()=>{
      mobile=await open(browser,{width:390,height:844},'light',true)
      await shot(mobile.page,names[4])
      for(const value of ['6','12','24','all'])await preset(mobile.page,value,total,`mobile ${value}`)
    })
    await stage('mobile touch gestures',async()=>{
      if(!mobile)throw Error('Mobile unavailable')
      await touchGestures(mobile.page,total)
    })
    await stage('mobile delivery tooltip capture',async()=>{
      if(!mobile)throw Error('Mobile unavailable')
      report.mobileReceipt=await receiptsTooltip(mobile.page,sample,'mobile',true)
      await shot(mobile.page,names[5])
    })
    if(mobile)await mobile.context.close()
    check('zero HTTP(S) requests attempted',report.networkRequests.length===0,report.networkRequests)
    check('zero console errors and pageerrors',report.browserErrors.length===0,report.browserErrors)
    check('all six exact captures produced in this run',report.screenshots.length===names.length
      && names.every(n=>report.screenshots.some(s=>s.name===n)),report.screenshots.map(s=>s.name))
    report.finalSourceSha256=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    check('candidate unchanged during run',report.finalSourceSha256===report.sourceSha256)
    report.notChecked.push('Safari, Firefox, physical iPhone, hosted deployment, and visual/aesthetic review')
  } catch(error) {
    report.fatal=error.stack || String(error)
    check('preflight/browser harness completed',false,error.message)
  } finally {
    if(browser)await browser.close().catch(error=>check('browser cleanup',false,error.message))
    const failed=report.checks.filter(c=>!c.pass)
    report.status=failed.length?'FAIL':'PASS'
    report.counts={passed:report.checks.length-failed.length,failed:failed.length,total:report.checks.length,screenshots:report.screenshots.length}
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify({status:report.status,...report.counts,report:reportPath}))
    if(failed.length)process.exitCode=1
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
