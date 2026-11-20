const {acceptMeaning}=require('./qa-input-meaning.cjs')
// Lifecycle: living. Disposable offline Chromium proof for A3 only. No install/server.
'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/design'),target=path.join(__dirname,'design/option-a3.html')
const report={lifecycle:'evidence',status:'RUNNING',checks:[],screenshots:[],network:[],errors:[],geometry:[],perf:{},not_checked:['Human visual review of screenshots','Safari/Firefox','Physical touch device','Hosted or live ERP','Independent controller review']}
const phaseOut=path.join(root,'.scratch/phase1')
const names=['option-a3-1440x900.png','option-a3-1440x900-search.png','option-a3-1440x900-zoom6m.png','option-a3-390x844.png','option-a3-390x844-swipe.png','option-a3-390x844-tooltip.png']
let browser
function check(name,pass,evidence){report.checks.push({name,pass:Boolean(pass),...(evidence===undefined?{}:{evidence})});if(!pass)console.error('FAIL: '+name)}
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
async function selected(page){return page.locator('body').getAttribute('data-selected-sku')}
async function shot(page,name){await settle(page);await page.screenshot({path:path.join(out,name),fullPage:false});report.screenshots.push(name)}
async function geometry(page,name){
  const g=await page.evaluate(()=>{
    const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
    const svg=document.querySelector('svg[data-chart]'),chart=svg?box(svg):null
    const text=[...document.querySelectorAll('svg[data-chart] text')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent,...box(e)}))
    const values=svg?[...svg.querySelectorAll('[data-value-label]')].map(e=>{
      const bar=svg.querySelector(`[data-period][data-month="${e.dataset.month}"]`)
      return {month:e.dataset.month,text:e.textContent,...box(e),barTop:bar?box(bar).y:null}
    }):[]
    const path=svg?.querySelector('[data-inventory-line]'),intersections=[]
    let pathSamples=0
    if(path&&values.length){
      // Sample actual rendered stock geometry at <=1 SVG unit (1 CSS pixel in
      // this renderer), including every endpoint. Test expanded glyph boxes
      // to account for line stroke/antialiasing, not just baseline positions.
      const length=path.getTotalLength(),steps=Math.ceil(length),matrix=path.getScreenCTM()
      for(let i=0;i<=steps;i++){
        const p=path.getPointAtLength(steps?length*i/steps:0),screen=new DOMPoint(p.x,p.y).matrixTransform(matrix);pathSamples++
        for(const value of values)if(screen.x>=value.x-3&&screen.x<=value.right+3&&screen.y>=value.y-3&&screen.y<=value.bottom+3&&!intersections.includes(value.month))intersections.push(value.month)
      }
    }
    const figure=svg?.closest('figure'),card=figure?.closest('.chart-card'),section=card?.closest('.chart-section'),legend=figure?.querySelector('.legend')
    return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,chart,card:card?box(card):null,section:section?box(section):null,legend:legend?box(legend):null,labels:text,values,stockLabelIntersections:intersections,pathSamples,tooltip:(()=>{const el=document.querySelector('.chart-tooltip');return el&&!el.hidden?box(el):null})(),bad:/undefined|NaN|\[object Object\]/.test(document.body.innerText)}

  })
  report.geometry.push({name,...g});check(name+': no page overflow',g.scroll<=g.width,g)
  check(name+': clean rendered text',!g.bad)
  if(g.chart){check(name+': whole chart in viewport',g.chart.x>=0&&g.chart.y>=0&&g.chart.right<=g.width&&g.chart.bottom<=g.height,g.chart);check(name+': chart labels inside SVG',g.labels.every(t=>t.x>=g.chart.x-1&&t.right<=g.chart.right+1&&t.y>=g.chart.y-1&&t.bottom<=g.chart.bottom+1),g.labels)}
  if(g.card)check(name+': whole card and legend in viewport',g.card.bottom<=g.height&&g.legend?.bottom<=g.height,{card:g.card,legend:g.legend})
  if(g.width===1440&&g.height===900&&g.section)check(name+': desktop section fits window (<=900)',g.section.bottom<=900,g.section)
  if(g.width===390&&g.height===844&&g.section)check(name+': mobile section including warnings fits with 8px clearance',g.section.bottom<=836&&g.section.bottom<=g.height,g.section)
  if(g.values.length){
    check(name+': rendered value labels above their bars',g.values.every(v=>v.barTop!==null&&v.bottom<v.barTop),g.values)
    check(name+': stock path clears rendered value labels',g.pathSamples>0&&g.stockLabelIntersections.length===0,{samples:g.pathSamples,intersections:g.stockLabelIntersections})
  }
  if(g.tooltip)check(name+': tooltip outside chart and within viewport',g.tooltip.y>=g.chart.bottom-1&&g.tooltip.right<=g.width&&g.tooltip.x>=0&&g.tooltip.bottom<=g.height,{chart:g.chart,tooltip:g.tooltip})
}
async function warningPanels(page,name){
  const warnings=page.locator('.warning-detail'),count=await warnings.count()
  for(let i=0;i<count;i++){
    const warning=warnings.nth(i),summary=warning.locator('summary')
    await summary.tap()
    try{
      const bounds=await warning.evaluate(el=>{
        const panel=el.querySelector('p'),r=panel.getBoundingClientRect()
        return {open:el.open,text:panel.textContent,left:r.left,right:r.right,width:r.width,height:r.height,viewport:innerWidth,scroll:document.documentElement.scrollWidth}
      })
      check(`${name}: warning ${i+1} panel stays in viewport`,bounds.open&&bounds.text.trim().length>0&&bounds.width>0&&bounds.height>0&&bounds.left>=0&&bounds.right<=bounds.viewport&&bounds.scroll<=bounds.viewport,bounds)
    }finally{
      if(await warning.evaluate(el=>el.open))await summary.tap()
    }
    check(`${name}: warning ${i+1} closed before capture`,!await warning.evaluate(el=>el.open))
  }
  return count
}
async function allSampleWarningPanels(page){
  const initial=await selected(page),skus=await page.locator('.sku-button').evaluateAll(es=>es.map(e=>e.dataset.sku))
  let tested=0
  try{
    for(const sku of skus){
      await page.evaluate(s=>{location.hash='sku='+encodeURIComponent(s)},sku)
      await page.waitForFunction(s=>document.body.dataset.selectedSku===s,sku);await settle(page)
      tested+=await warningPanels(page,`mobile ${sku}`)
    }
    check('mobile all sample warning panels exercised',skus.length===5&&tested>0,{skus,panels:tested})
  }finally{
    await page.evaluate(s=>{location.hash='sku='+encodeURIComponent(s)},initial)
    await page.waitForFunction(s=>document.body.dataset.selectedSku===s,initial);await settle(page)
  }
}
async function open(viewport,mobile=false,url=pathToFileURL(target).href){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,colorScheme:'dark',reducedMotion:'reduce',hasTouch:mobile,isMobile:mobile})
  await context.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-12T09:00:00Z']))}static now(){return new D('2026-11-12T09:00:00Z').getTime()}}})
  await context.route(/^https?:/,route=>{report.network.push(route.request().url());return route.abort()})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())})
  await page.goto(url);await page.waitForFunction(()=>document.body.dataset.selectedSku);await settle(page)
  return {context,page}
}
async function swipe(page,delta){
  const cdp=await page.context().newCDPSession(page)
  try{
    const r=await page.locator('svg[data-chart]').boundingBox(),x=r.x+r.width*(delta<0?.8:.2),y=r.y+r.height*.55
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]})
    for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+delta*i/8,y,id:1}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(page)
  }finally{await cdp.detach()}
}
async function visibleWords(page){return page.evaluate(()=>{
  const entries=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)
  const visibleBoxes=(element,rects)=>{
    for(let p=element;p;p=p.parentElement){
      if(p.tagName==='DETAILS'&&!p.open){const summary=p.querySelector(':scope > summary');if(!summary?.contains(element))return []}
    }
    if(getComputedStyle(element).visibility==='hidden'||getComputedStyle(element).display==='none')return []
    return rects.filter(r=>{
      let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom)
      for(let p=element;p;p=p.parentElement){
        const s=getComputedStyle(p),b=p.getBoundingClientRect()
        if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}
        if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}
      }
      return right>left&&bottom>top
    }).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))
  }
  while(walker.nextNode()){
    const n=walker.currentNode,e=n.parentElement;if(!e||e.closest('script,style,noscript,svg title,svg desc,[hidden]'))continue
    const words=[]
    for(const match of n.textContent.matchAll(/[\p{L}\p{N}]+(?:[.,'’\/-][\p{L}\p{N}]+)*/gu)){
      const range=document.createRange();range.setStart(n,match.index);range.setEnd(n,match.index+match[0].length)
      const boxes=visibleBoxes(e,[...range.getClientRects()]);if(boxes.length)words.push({token:match[0],boxes})
    }
    if(words.length)entries.push({text:n.textContent.trim(),count:words.length,svg:Boolean(e.closest('svg')),words})
  }
  for(const e of document.querySelectorAll('input[placeholder]')){
    if(e.value)continue
    const boxes=visibleBoxes(e,[e.getBoundingClientRect()]),tokens=e.placeholder.match(/[\p{L}\p{N}]+/gu)||[]
    if(boxes.length&&tokens.length)entries.push({text:e.placeholder,count:tokens.length,placeholder:true,svg:false,boxes})
  }
  return {definition:'Resting full desktop viewport, including header and sidebar. Alphanumeric tokens include numbers, units, visible key hints, search placeholder and visible SVG labels; internal punctuation joins tokens. Each text token must have a nonzero Range box intersecting viewport and every clipping ancestor. Excludes collapsed/hidden text and SVG title/desc metadata. A partially clipped visible token counts once; icons without alphanumerics do not count.',count:entries.reduce((a,e)=>a+e.count,0),non_svg_count:entries.filter(e=>!e.svg).reduce((a,e)=>a+e.count,0),entries}
})}
async function main(){
 fs.mkdirSync(out,{recursive:true});fs.mkdirSync(phaseOut,{recursive:true})
 try{
  const modulePath=process.env.PLAYWRIGHT_MODULE||'playwright'
  const executablePath=process.env.CHROMIUM_EXECUTABLE||undefined
  if(executablePath.includes('/Google Chrome.app/'))throw Error('Use isolated QA Chromium')
  const {chromium}=require(modulePath)
  report.browser={name:'A3 disposable offline QA',executablePath,profile:'Playwright temporary isolated context',frozenDate:'2026-11-12T09:00:00Z'}
  report.harness_sha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')
  report.source_sha256=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  browser=await chromium.launch({headless:true,executablePath});report.browser.version=browser.version()
  const desktop=await open({width:1440,height:900}),{page}=desktop
  const skus=await page.locator('.sku-button').evaluateAll(es=>es.map(e=>e.dataset.sku));report.sampleCount=skus.length
  check('all sample SKUs in sidebar',skus.length===5,skus)
  check('white default despite dark system',await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(255, 255, 255)'))
  await shot(page,names[0]);report.visible_word_count=await visibleWords(page);await geometry(page,'desktop resting')

  // Phase 1: exact viewport captures, waterfall conservation, native keyboard/focus,
  // and fixed main-screen fit. The drawer is not an extra main-screen panel.
  const phaseShot=async(p,name)=>{await settle(p);await p.screenshot({path:path.join(phaseOut,name),fullPage:false});report.screenshots.push('../phase1/'+name)}
  await phaseShot(page,'ui-1440x900.png')
  const trigger=page.locator('button.big-number'),quantity=Number((await trigger.textContent()).replace(/[^0-9.]/g,''))
  await trigger.focus();await page.keyboard.press('Enter')
  check('quantity Enter opens native why dialog',await page.locator('#why-dialog').evaluate(d=>d.open))
  const steps=await page.locator('.waterfall-row').evaluateAll(es=>es.map(e=>({key:e.dataset.key,qty:Number(e.dataset.qty)})))
  check('rendered waterfall conserves guidance quantity',steps.length>=4&&steps.at(-1).qty===quantity&&steps.slice(0,-1).reduce((a,s)=>a+s.qty,0)===quantity,steps)
  await phaseShot(page,'ui-1440x900-why.png')
  const heldSku=await selected(page);await page.keyboard.press('j');check('modal blocks product shortcuts',await selected(page)===heldSku)
  await page.keyboard.press('Tab');check('native dialog contains keyboard focus',await page.evaluate(()=>document.activeElement.closest('#why-dialog')!==null))
  await page.keyboard.press('Escape');check('Escape closes and restores quantity focus',await page.locator('#why-dialog').evaluate(d=>!d.open)&&await trigger.evaluate(e=>document.activeElement===e))
  for(const viewport of [{width:1366,height:768},{width:1536,height:864},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);await settle(page)
    const fit=await page.evaluate(()=>({pageHeight:document.documentElement.scrollHeight,height:innerHeight,pageWidth:document.documentElement.scrollWidth,width:innerWidth,section:document.querySelector('.chart-section').getBoundingClientRect().bottom}))
    check(`PC fit ${viewport.width}x${viewport.height}`,fit.pageHeight<=fit.height&&fit.pageWidth<=fit.width&&fit.section<=fit.height,fit)
  }
  await page.setViewportSize({width:1440,height:900});await settle(page)
  // Keep a DOM identity sentinel to prove selection does not rebuild the list.
  await page.evaluate(()=>window.a3FirstButton=document.querySelector('.sku-button'))
  const first=await selected(page)
  await page.locator('h1').click();await page.keyboard.press('ArrowDown');check('real ArrowDown changes SKU',await selected(page)!==first)
  await page.keyboard.press('ArrowUp');check('real ArrowUp reverses SKU',await selected(page)===first)
  await page.keyboard.press('j');check('real j changes SKU',await selected(page)!==first)
  await page.keyboard.press('k');check('real k reverses SKU',await selected(page)===first)
  check('selection preserves sidebar nodes',await page.evaluate(()=>window.a3FirstButton===document.querySelector('.sku-button')))
  await page.locator('#next-sku').click();check('next button changes SKU',await selected(page)!==first)
  const second=await selected(page);await page.locator('#prev-sku').click();check('previous button reverses SKU',await selected(page)===first)
  await page.locator('#search').fill('silicone');await settle(page);await shot(page,names[1]);await geometry(page,'desktop search')
  const filtered=await page.locator('.sku-button').evaluateAll(es=>es.map(e=>e.dataset.sku));check('search filters actual rows',filtered.length===2&&filtered.every(s=>s.startsWith('SEAL')),filtered)
  await page.locator('#next-sku').click();check('filtered next stays in results',filtered.includes(await selected(page)))
  check('filtered end disables next',await page.locator('#next-sku').isDisabled())
  await page.locator('#search').fill('no-match-fixture');const held=await selected(page)
  check('empty search retains chart, disables navigation',(await page.locator('.sku-button').count())===0&&await page.locator('#prev-sku').isDisabled()&&await page.locator('#next-sku').isDisabled()&&Boolean(held))
  await page.locator('#search').fill('');check('clearing search preserves selected SKU',await selected(page)===held)
  await page.evaluate(s=>location.hash='sku='+encodeURIComponent(s),second);await page.waitForFunction(s=>document.body.dataset.selectedSku===s,second);check('hashchange selects SKU',await selected(page)===second)
  await page.reload();await page.waitForFunction(s=>document.body.dataset.selectedSku===s,second);check('refresh restores hash SKU',await selected(page)===second)
  await page.goto('about:blank');await page.goto(pathToFileURL(target).href+'#sku='+encodeURIComponent(first));await page.waitForFunction(s=>document.body.dataset.selectedSku===s,first);check('fresh deep link restores SKU',await selected(page)===first)
  await page.locator('[data-zoom="6"]').click();await shot(page,names[2]);await geometry(page,'desktop 6M')
  check('6M actually changes visible monthly window',await page.locator('svg[data-chart]').getAttribute('data-visible-months')==='6')
  const above=await page.locator('svg[data-chart]').evaluate(svg=>{
    const values=[...svg.querySelectorAll('[data-value-label]')]
    return values.length===6&&values.every(t=>{
      const bar=svg.querySelector(`[data-period][data-month="${t.dataset.month}"]`)
      return bar&&t.getBoundingClientRect().bottom<bar.getBoundingClientRect().top
    })
  })
  check('6M all six value labels above demand bars',above)
  for(const v of ['12','24','all']){await page.locator(`[data-zoom="${v}"]`).click();check(v+' zoom active',await page.locator(`[data-zoom="${v}"]`).getAttribute('aria-pressed')==='true')}
  check('no supply bars',await page.locator('[data-period=supply]').count()===0)
  // Operational controls use real existing CSV and baseline PO builder.
  await page.locator('#tools>summary').click();await page.locator('#copy-po').click()
  await page.waitForFunction(()=>Boolean(document.getElementById('copy-status').textContent.trim()))
  check('PO accessible through collapsed tools',await page.locator('#copy-status').textContent()!=='')
  await page.locator('#settings>summary').click();await page.locator('#cover-months').fill('3');check('settings recompute remains available',await page.locator('#cover-months').inputValue()==='3'&&await page.locator('#settings-error').isHidden())
  check('buffer defaults to 0 (policy v2) inside collapsed tools/settings',await page.locator('#buffer-days').inputValue()==='0')
  await page.locator('#buffer-days').fill('0')
  check('zero buffer persists explicitly',await page.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway.standalone.order-settings.v1')).buffer_days)===0)
  await page.locator('#buffer-days').fill('1.5')
  check('fractional buffer is rejected without replacing last valid setting',await page.locator('#buffer-days').getAttribute('aria-invalid')==='true'&&await page.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway.standalone.order-settings.v1')).buffer_days)===0)
  await page.locator('#buffer-days').fill('21')
  await shot(page,'phase1-buffer-settings.png')
  await page.reload();await page.waitForSelector('svg[data-chart]')
  await page.locator('#tools>summary').click();await page.locator('#settings>summary').click()
  check('buffer hydrates after reload',await page.locator('#buffer-days').inputValue()==='21')
  await page.locator('#reset-settings').click()
  check('reset restores default buffer',await page.locator('#buffer-days').inputValue()==='0')
  await page.locator('#tools>summary').click()
  const mobile=await open({width:390,height:844},true),mp=mobile.page
  await allSampleWarningPanels(mp)
  await shot(mp,names[3]);await geometry(mp,'mobile resting')
  await mp.locator('button.big-number').tap();await phaseShot(mp,'ui-390x844-why.png')
  const sheet=await mp.locator('#why-dialog').evaluate(d=>{const r=d.getBoundingClientRect();return {open:d.open,x:r.x,right:r.right,bottom:r.bottom,top:r.top,width:innerWidth,height:innerHeight}})
  check('phone why is bounded bottom sheet',sheet.open&&sheet.x>=0&&sheet.right<=sheet.width&&Math.abs(sheet.bottom-sheet.height)<=1&&sheet.top>0,sheet)
  await mp.locator('#why-dialog .sheet-close').tap();check('phone Close dismisses why',await mp.locator('#why-dialog').evaluate(d=>!d.open))
  check('mobile product list collapsed',await mp.locator('#sku-list').isHidden())
  const mbefore=await selected(mp);await swipe(mp,-180);check('CDP horizontal touch swipe changes SKU',await selected(mp)!==mbefore,{before:mbefore,after:await selected(mp)})
  await shot(mp,names[4]);await geometry(mp,'mobile swipe')
  await swipe(mp,180);check('CDP reverse touch swipe reverses SKU',await selected(mp)===mbefore)
  await mp.locator('#next-sku').tap();await mp.locator('#prev-sku').tap();check('mobile chevrons navigate',await selected(mp)===mbefore)
  await mp.locator('#browse-toggle').tap();check('mobile product list expands',await mp.locator('#sku-list').isVisible())
  await mp.locator('#search').fill('silicone');check('mobile search shows matches',await mp.locator('.sku-button').count()===2)
  await mp.locator('.sku-button').first().tap();check('mobile selection collapses list',await mp.locator('#sku-list').isHidden())
  await mp.locator('#search').fill('');await mp.locator('#browse-toggle').tap()
  await mp.locator('[data-zoom="all"]').tap();const marker=mp.locator('[data-delivery-marker]').first();await marker.tap();await settle(mp)
  check('real delivery tap exposes monthly detail',await mp.locator('.chart-tooltip').isVisible()&&/Monthly total · exact date unavailable/.test(await mp.locator('.chart-tooltip').textContent()))
  const markerQuantity=Number(await marker.getAttribute('data-quantity'));check('tooltip actual receipt quantity',await mp.locator('.chart-tooltip').textContent().then(t=>t.includes(markerQuantity.toLocaleString('en-US'))))
  await warningPanels(mp,'mobile tooltip')
  await shot(mp,names[5]);await geometry(mp,'mobile tooltip')
  await mobile.context.close();await desktop.context.close()
  // Synthetic initial-load fixture changes only SAMPLE in a scratch copy. Product
  // render measurement begins inside render(), including core rows and SVG/DOM.
  const html=fs.readFileSync(target,'utf8'),sample=JSON.parse(html.match(/^const SAMPLE = (.+)$/m)[1])
  const synthetic={...sample,dataset:'Synthetic 500 SKU QA',items:Array.from({length:500},(_,i)=>({...sample.items[i%sample.items.length],sku:'SYN-'+String(i).padStart(4,'0'),name:'Synthetic product '+String(i).padStart(4,'0')}))}
  const perfPath=path.join(out,'a3-perf-500.html');fs.writeFileSync(perfPath,html.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(synthetic)))
  const perf=await open({width:1440,height:900},false,pathToFileURL(perfPath).href)
  report.perf.initial_ms=Number(await perf.page.locator('body').getAttribute('data-render-ms'));report.perf.definition='500 synthetic SKUs, fresh file load; render() measures core evaluation, grouped list creation, selected SVG creation and forced layout; browser startup excluded. Switch measures selectItem() including SVG draw and layout. Warm and uncached selections included.'
  check('500 SKU initial render <500ms',report.perf.initial_ms<500,report.perf.initial_ms);check('500 SKU rows rendered',await perf.page.locator('.sku-button').count()===500)
  report.perf.switch_ms=[]
  for(let i=0;i<20;i++){await perf.page.locator('#next-sku').click();report.perf.switch_ms.push(Number(await perf.page.locator('body').getAttribute('data-switch-ms')))}
  report.perf.max_switch_ms=Math.max(...report.perf.switch_ms);check('500 SKU switch <50ms',report.perf.max_switch_ms<50,report.perf)
  await perf.page.locator('#search').fill('SYN-0499');check('500 SKU search exact SKU',await perf.page.locator('.sku-button').count()===1&&await selected(perf.page)==='SYN-0499')
  await perf.context.close()

  // Health-only synthetic fixture: partial month + excessive stock + pack/MOQ/max
  // conflict. No imported personal data and no changes to forecast formulae.
  const healthSample={...sample,dataset:'Synthetic health QA',note:'Synthetic QA data, not real stock.',partial_last_month:true,items:sample.items.map((item,i)=>({...item,sku:'SYN-HEALTH-'+i,name:'Synthetic product '+i,...(i===0?{on_hand:1000000,pack_size:6,minimum_order:11,max_stock:11}:{})}))}
  const healthPath=path.join(out,'a3-health.html');fs.writeFileSync(healthPath,html.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(healthSample)))
  const health=await open({width:1440,height:900},false,pathToFileURL(healthPath).href),hp=health.page
  check('health chip compact warning count',await hp.locator('#health-chip').textContent()==='⚠ 3')
  check('warning dot attached to affected SKU',await hp.locator('.sku-button[data-sku="SYN-HEALTH-0"] .health-dot').count()===1)
  await hp.locator('#health-chip').focus();await hp.keyboard.press('Enter')
  check('health chip keyboard opens compact list',await hp.locator('#health-dialog').evaluate(d=>d.open)&&await hp.locator('#health-list li').count()===3)
  await phaseShot(hp,'ui-1440x900-health.png')
  check('health labels max three words',await hp.locator('#health-list li>span:last-child').evaluateAll(es=>es.every(e=>e.textContent.trim().split(/\s+/).length<=3)))
  await hp.keyboard.press('Escape');check('health Escape restores chip focus',await hp.locator('#health-dialog').evaluate(d=>!d.open)&&await hp.locator('#health-chip').evaluate(e=>document.activeElement===e))
  await hp.setViewportSize({width:390,height:844});await hp.locator('#health-chip').click()
  check('phone health within viewport',await hp.locator('#health-dialog').evaluate(d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth}))
  await health.context.close()
  // Phase 2: cleaned history + explicit customer orders + manual change, with a
  // second otherwise-identical SKU held by a late PO. Fixtures remain offline.
  const phase2Out=path.join(root,'.scratch/phase2');fs.mkdirSync(phase2Out,{recursive:true})
  const manual=JSON.parse(fs.readFileSync(path.join(root,'tests/golden/manual-inputs.json'),'utf8'))
  const cleaned=manual.cases.find(c=>c.item.sku==='MANUAL-CLEANED'),ready=structuredClone(cleaned.item)
  ready.planning_facts.warehouses=['MAIN']
  ready.planning_facts.customer_orders=[{order_line_id:'SYN-ORDER',sku:ready.sku,warehouse:'MAIN',quantity:20,delivery_date:'2026-11-20',status:'confirmed',forecast_included:false}]
  ready.planning_facts.stock_states=[{sku:ready.sku,warehouse:'MAIN',damaged:0,reserved:0,quarantine:0,returns:0}]
  const late=JSON.parse(JSON.stringify(ready).replaceAll('MANUAL-CLEANED','LATE-PO'))
  late.planning_facts.incoming_pos=[{po_line_id:'SYN-LATE',sku:late.sku,warehouse:'MAIN',supplier:'Synthetic',remaining_qty:20,due_date:'2026-11-01',status:'confirmed'}]
  const whySample={...sample,as_of:manual.as_of,months:cleaned.months,dataset:'Synthetic phase2 QA',note:'Synthetic QA data, not real stock.',items:[ready,late]}
  const whyPath=path.join(phase2Out,'why-phase2.html');fs.writeFileSync(whyPath,html.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(whySample)))
  const why=await open({width:1440,height:900},false,pathToFileURL(whyPath).href+'#sku='+ready.sku),wp=why.page
  const whyQty=Number((await wp.locator('button.big-number').textContent()).replace(/[^0-9.]/g,''))
  await wp.locator('button.big-number').click()
  const phase2Rows=await wp.locator('.waterfall-row').evaluateAll(es=>es.map(e=>({key:e.dataset.key,qty:Number(e.dataset.qty),label:e.querySelector('.waterfall-label>span')?.textContent,unit:e.querySelector('.waterfall-number>small')?.textContent})))
  check('phase2 why shows core adjustment rows',['committed_orders','manual_change','stockout_correction','projects_excluded'].every(key=>phase2Rows.some(r=>r.key===key&&r.qty!==0)),phase2Rows)
  check('phase2 why exact sum equals order quantity',phase2Rows.length>1&&phase2Rows.at(-1).qty===whyQty&&phase2Rows.slice(0,-1).reduce((n,r)=>n+r.qty,0)===whyQty,{whyQty,rows:phase2Rows})
  check('phase2 why compact labels and units',phase2Rows.every(r=>r.label&&r.label.trim().split(/\s+/).length<=3&&r.unit==='box'),phase2Rows)
  await settle(wp);await wp.screenshot({path:path.join(phase2Out,'why-phase2.png'),fullPage:false});report.screenshots.push('../phase2/why-phase2.png')
  await wp.keyboard.press('Escape');await wp.evaluate(s=>location.hash='sku='+s,late.sku);await wp.waitForFunction(s=>document.body.dataset.selectedSku===s,late.sku)
  await wp.locator('button.big-number').focus();await wp.keyboard.press('Enter')
  check('phase2 late PO opens one hold row without number',await wp.locator('#why-dialog').evaluate(d=>d.open)&&await wp.locator('.waterfall-row').count()===1&&await wp.locator('.waterfall-row').getAttribute('data-key')==='late_po_hold'&&await wp.locator('.waterfall-number').count()===0&&await wp.locator('.waterfall-row').getAttribute('data-qty')===null)
  check('phase2 hold label and unit',await wp.locator('.waterfall-row').textContent()==='Late PO holdbox')
  await wp.keyboard.press('Escape');await why.context.close()
  // Phase 3: no extra main-screen content, empirical range behind second tap.
  const phase3Out=path.join(root,'.scratch/phase3');fs.mkdirSync(phase3Out,{recursive:true})
  const forecastInput=JSON.parse(fs.readFileSync(path.join(root,'tests/golden/phase3-inputs.json'),'utf8'))
  const fc=forecastInput.cases.find(c=>c.item.sku==='TREND'),forecastItem={...fc.item,on_hand:10,calendar_forecast:true}
  const forecastSample={...sample,as_of:forecastInput.as_of,months:fc.months,dataset:'Synthetic forecast QA',note:'Synthetic QA data, not real stock.',items:[forecastItem,...[1,2,3].map(i=>({...forecastItem,sku:"POOL-"+i}))]}
  const forecastPath=path.join(phase3Out,'why-forecast.html');fs.writeFileSync(forecastPath,html.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(forecastSample)))
  const forecasts=await open({width:1440,height:900},false,pathToFileURL(forecastPath).href),fp=forecasts.page
  check('forecast details absent from main screen',await fp.locator('.forecast-method').count()===0&&await fp.locator('.forecast-range').count()===0)
  const fq=Number((await fp.locator('button.big-number').textContent()).replace(/[^0-9.]/g,''))
  await fp.locator('button.big-number').click()
  check('forecast method row at most three words',await fp.locator('.forecast-method').textContent().then(t=>t.startsWith('Method: ')&&t.trim().split(/\s+/).length<=3))
  check('forecast calendar note compact',await fp.locator('.forecast-calendar').textContent()==='Approx dates')
  check('forecast tested month row',await fp.locator('.forecast-tested').textContent()==='Tested: 12 mo')
  check('forecast quantities collapsed behind tap',!await fp.locator('.forecast-range').evaluate(e=>e.open)&&!await fp.locator('[data-scenario=recommended]').isVisible())
  await fp.locator('.forecast-range>summary').click()
  check('forecast recommended equals main quantity',await fp.locator('[data-scenario=recommended] strong').textContent().then(t=>Number(t.replace(/[^0-9.]/g,''))===fq))
  check('forecast scenario labels at most three words',await fp.locator('.forecast-scenario>span').evaluateAll(es=>es.length===3&&es.every(e=>e.textContent.trim().split(/\s+/).length<=3)))
  check('forecast rough range labelled',await fp.locator('.forecast-range').textContent().then(t=>t.includes('Rough range')&&t.includes('samples')))
  await settle(fp);await fp.screenshot({path:path.join(phase3Out,'why-forecast.png'),fullPage:false});report.screenshots.push('../phase3/why-forecast.png')
  await fp.setViewportSize({width:390,height:844});await settle(fp)
  check('forecast drawer phone bounded',await fp.locator('#why-dialog').evaluate(d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth}))
  await forecasts.context.close()
  const shortSample={...forecastSample,months:fc.months.slice(-24),items:[{...forecastItem,monthly_sales:forecastItem.monthly_sales.slice(-24)}]}
  const shortPath=path.join(phase3Out,'why-short.html');fs.writeFileSync(shortPath,html.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(shortSample)))
  const short=await open({width:390,height:844},false,pathToFileURL(shortPath).href)
  await short.page.locator('button.big-number').click()
  check('zero tested count row hidden',await short.page.locator('.forecast-tested').count()===0)
  await short.context.close()
  // Phase 3b: opt-in archive/report behind Tools; real twelve-run replay below.
  const phase3bOut=path.join(root,'.scratch/phase3b');fs.mkdirSync(phase3bOut,{recursive:true})
  const vm=require('node:vm'),learningVM=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
  const coreSource=fs.readFileSync(path.join(root,'desktop/plugin.js'),'utf8')
  vm.runInContext(coreSource.slice(coreSource.indexOf('const SAMPLE ='),coreSource.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.learn={forecastDiary,prepareLearning,monthAfter}',learningVM)
  // An early spike keeps this correction/undo fixture on the legacy erratic
  // branch; the smooth-average fixture correctly rejects its old correction.
  let diary=[],learningData
  for(let t=0;t<7;t++){
    const last=learningVM.learn.monthAfter('2026-01',t),n=36+t,months=Array.from({length:n},(_,i)=>learningVM.learn.monthAfter(last,i-n+1)),[y,m]=last.split('-').map(Number)
    learningData={as_of:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),months,items:[{sku:'SYN-LEARNING',name:'Synthetic learning',unit:'box',on_hand:0,supplier_days:14,monthly_sales:Array.from({length:n},(_,i)=>i===0?10000:100*1.01**i),receipts:{}}]}
    if(t<6)diary.push(...JSON.parse(JSON.stringify(learningVM.learn.forecastDiary(learningVM.learn.prepareLearning(learningData,diary,{learning_enabled:true})))))
  }
  const learningPath=path.join(phase3bOut,'learning.html');fs.writeFileSync(learningPath,html.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(learningData)))
  const learning=await open({width:1440,height:900},false,pathToFileURL(learningPath).href),lp=learning.page
  check('learning defaults off without storage writes',await lp.evaluate(()=>localStorage.getItem('stock-runway.forecast-diary.v1')===null&&localStorage.getItem('stock-runway.learning.settings.v1')===null))
  check('report card absent from resting screen',!await lp.locator('#accuracy-report').isVisible()&&!await lp.locator('#accuracy-panel').evaluate(e=>e.open))
  await lp.evaluate(d=>{localStorage.setItem('stock-runway.forecast-diary.v1',JSON.stringify(d));localStorage.setItem('stock-runway.learning.settings.v1',JSON.stringify({archive_enabled:true,learning_enabled:true}))},diary)
  await lp.reload();await lp.waitForFunction(()=>document.body.dataset.selectedSku)
  await lp.locator('#tools>summary').click();await lp.locator('#accuracy-panel>summary').click()
  check('report card shows real matured accuracy and change',await lp.locator('#accuracy-report').textContent().then(t=>t.includes('Accuracy')&&t.includes('Monthly change')&&t.includes('6 matured months')))
  check('report card contains applied correction and undo',await lp.locator('[data-undo-correction="SYN-LEARNING"]').count()===1)
  const saved=await lp.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway.forecast-diary.v1')))
  check('archive appended once and retained prior rows',saved.length===7&&JSON.stringify(saved.slice(0,6))===JSON.stringify(diary))
  await settle(lp);await lp.screenshot({path:path.join(phase3bOut,'report-card.png'),fullPage:false});report.screenshots.push('../phase3b/report-card.png')
  await lp.locator('[data-undo-correction="SYN-LEARNING"]').click()
  check('undo persists SKU off switch without erasing archive',await lp.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway.learning.settings.v1')).learning_disabled_skus.includes('SYN-LEARNING')&&JSON.parse(localStorage.getItem('stock-runway.forecast-diary.v1')).length===7))
  await lp.reload();await lp.waitForFunction(()=>document.body.dataset.selectedSku)
  check('undo survives reload',await lp.locator('[data-undo-correction="SYN-LEARNING"]').count()===0)
  await lp.setViewportSize({width:390,height:844});await lp.locator('#tools>summary').click();await lp.locator('#accuracy-panel>summary').click()
  check('phone report does not widen screen',await lp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await learning.context.close()
  // Owner proposals: both actions are real taps, persisted before application.
  const proposalData={...learningData,as_of:'2026-10-31',months:Array.from({length:60},(_,i)=>learningVM.learn.monthAfter('2026-10',i-59)),items:['SYN-APPROVE','SYN-DISMISS'].map(sku=>({sku,name:'Synthetic proposal',unit:'box',on_hand:0,supplier_days:14,monthly_sales:Array.from({length:60},(_,i)=>100+i*10),receipts:{}}))}
  const proposalDiary=proposalData.items.flatMap(item=>proposalData.months.slice(-6).map(m=>({version:1,sku:item.sku,as_of:learningVM.learn.monthAfter(m,-1),method:'champion',scale:10,forecast:Array.from({length:3},(_,h)=>({month:learningVM.learn.monthAfter(m,h),p50:600,p80:620,p95:630}))})))
  const proposalPath=path.join(phase3bOut,'proposals.html');fs.writeFileSync(proposalPath,html.replace(/^const SAMPLE = .+$/m,'const SAMPLE = '+JSON.stringify(proposalData)))
  const proposals=await open({width:1440,height:900},false,pathToFileURL(proposalPath).href),pp=proposals.page
  await pp.evaluate(d=>{localStorage.setItem('stock-runway.forecast-diary.v1',JSON.stringify(d));localStorage.setItem('stock-runway.learning.settings.v1',JSON.stringify({learning_enabled:true}))},proposalDiary)
  await pp.reload();await pp.waitForFunction(()=>document.body.dataset.selectedSku)
  await pp.locator('#tools>summary').click();await pp.locator('#accuracy-panel>summary').click()
  check('pending proposals each have tap decisions',await pp.locator('[data-approve-proposal]').count()===2&&await pp.locator('[data-dismiss-proposal]').count()===2)
  check('pending report uses plain Needs OK state',await pp.locator('#accuracy-report').innerText().then(text=>text.includes('Needs OK')&&!text.includes('0.0%')))
  check('decision labels at most three words',await pp.locator('[data-approve-proposal],[data-dismiss-proposal]').evaluateAll(es=>es.every(e=>e.textContent.trim().split(/\s+/).length<=3)))
  await pp.locator('#accuracy-panel').scrollIntoViewIfNeeded();await settle(pp)
  await pp.locator('#accuracy-panel').screenshot({path:path.join(phase3bOut,'report-card.png')})
  await pp.setViewportSize({width:390,height:844});await settle(pp)
  check('phone proposals do not clip text or controls',await pp.locator('#accuracy-report').evaluate(e=>e.scrollWidth<=e.clientWidth&&document.documentElement.scrollWidth<=innerWidth))
  check('phone decision actions sit below proposal text',await pp.locator('.proposal-actions').evaluateAll(es=>es.every(e=>{const a=e.getBoundingClientRect(),t=e.previousElementSibling.getBoundingClientRect();return a.top>=t.bottom&&[...e.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44)})))
  await pp.locator('#accuracy-panel').screenshot({path:path.join(phase3bOut,'report-card-phone.png')})
  await pp.locator('[data-dismiss-proposal]').last().click()
  check('dismiss logged and removes one pending row',await pp.locator('[data-approve-proposal]').count()===1&&await pp.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway.learning-log.v1')).some(e=>e.kind==='owner_decision'&&e.state==='dismissed')))
  await pp.locator('[data-approve-proposal]').click()
  check('approve logged and gate applies method',await pp.locator('[data-approve-proposal]').count()===0&&await pp.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway.learning-log.v1')).some(e=>e.kind==='method_switch'&&e.state==='applied'&&e.reason==='Owner approved')))
  await pp.reload();await pp.waitForFunction(()=>document.body.dataset.selectedSku)
  check('decisions survive reload',await pp.locator('[data-approve-proposal]').count()===0&&await pp.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway.learning-log.v1')).filter(e=>e.kind==='owner_decision').length===2))
  await proposals.context.close()
  // Existing synthetic CSV path exercises actual import and needs-data handling.
  const imports=await open({width:1440,height:900}),ip=imports.page
  await ip.locator('#tools>summary').click();await ip.locator('#file-panel>summary').click()
  const fixture=path.join(root,'docs/erp-examples/sap-business-one.csv')
  const csvFiles=fs.readdirSync(path.join(root,'docs/erp-examples')).filter(n=>n.endsWith('.csv'))
  await ip.locator('#csv-file').setInputFiles(fs.existsSync(fixture)?fixture:path.join(root,'docs/erp-examples',csvFiles[0]));await acceptMeaning(ip);await ip.waitForFunction(()=>document.querySelector('#snapshot').textContent.startsWith('Local CSV'))
  check('synthetic ERP fixture import available',/Using/.test(await ip.locator('#source-status').textContent()))
  await ip.locator('#sample').click();check('sample restoration after import',await ip.locator('.sku-button').count()===5)
  await imports.context.close()
  check('zero file:// HTTP(S) requests',report.network.length===0,report.network);check('zero browser errors',report.errors.length===0,report.errors)
  check('four phase1 screenshots saved',['ui-1440x900.png','ui-1440x900-why.png','ui-1440x900-health.png','ui-390x844-why.png'].every(n=>report.screenshots.includes('../phase1/'+n)))
  check('six exact screenshots saved',names.every(n=>report.screenshots.includes(n)))
  report.final_source_sha256=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  check('candidate unchanged during capture',report.final_source_sha256===report.source_sha256)
 }catch(e){report.fatal=e.stack;check('harness completed',false,e.message)}
 finally{
  if(browser)await browser.close()
  report.counts={passed:report.checks.filter(c=>c.pass).length,failed:report.checks.filter(c=>!c.pass).length};report.status=report.counts.failed?'FAIL':'PASS'
  fs.writeFileSync(path.join(out,'a3-browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.counts,perf:report.perf,report:'.scratch/design/a3-browser-report.json'}));if(report.counts.failed)process.exitCode=1
 }
}
main().catch(e=>{console.error(e);process.exitCode=1})
