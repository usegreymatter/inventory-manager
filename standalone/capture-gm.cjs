// Lifecycle: living. Offline sample-only GreyMatter visual/numeric verification.
'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/brand')
const variants=['option-a3','option-gm-a','option-gm-b','option-gm-c']
const report={status:'RUNNING',sources:[],harness_sha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),checks:[],screenshots:[],errors:[],network:[],geometry:[],numeric:[],raw_number_differences:[],not_checked:['Arabic: A3 has no Arabic/language toggle; RTL CSS and Tajawal are prepared, not a translated app.','Real iPhone/Safari/Firefox','Owner aesthetic approval','Raw visible numeric token identity: required full-year/relative/direct-date labels add tokens; calculated quantities and full numeric series are compared separately.']}
const hash=s=>crypto.createHash('sha256').update(s).digest('hex')
function check(name,pass,evidence){report.checks.push({name,pass:Boolean(pass),evidence});if(!pass)console.error('FAIL '+name)}
async function settle(page){await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
async function numeric(page){return page.evaluate(()=>{
  const numbers=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)
  while(walker.nextNode()){
    const n=walker.currentNode,e=n.parentElement;if(!e||e.closest('script,style,noscript,svg title,svg desc,[hidden]'))continue
    if(getComputedStyle(e).visibility==='hidden'||getComputedStyle(e).display==='none')continue
    let hidden=false
    for(let p=e;p;p=p.parentElement){if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope>summary')?.contains(e)){hidden=true;break}}
    if(hidden)continue
    for(const m of n.textContent.matchAll(/\d+(?:[,.]\d+)*/g)){
      const range=document.createRange();range.setStart(n,m.index);range.setEnd(n,m.index+m[0].length)
      const shown=[...range.getClientRects()].some(r=>{
        let l=Math.max(0,r.left),right=Math.min(innerWidth,r.right),t=Math.max(0,r.top),b=Math.min(innerHeight,r.bottom)
        for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p),box=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){l=Math.max(l,box.left);right=Math.min(right,box.right)}if(/auto|scroll|hidden|clip/.test(s.overflowY)){t=Math.max(t,box.top);b=Math.min(b,box.bottom)}}
        return right>l&&b>t
      })
      if(shown)numbers.push({token:m[0],text:n.textContent.trim(),element:e.id||e.getAttribute('data-month')||e.classList.value||e.tagName})
    }
  }
  return numbers
})}
async function geometry(page,variant,size){
 const g=await page.evaluate(()=>{
  const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
  const owner=document.querySelector('#product-page')||document.body,svg=owner.querySelector('svg[data-chart]'),texts=[...owner.querySelectorAll('*')].filter(e=>e.getClientRects().length&&!e.closest('script,style,[hidden]')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&(!e.closest('details:not([open])')||e.closest('summary')))
  const bounds=box(svg),labels=[...svg.querySelectorAll('text')].map(e=>({text:e.textContent,...box(e)}))
  return{position:{page:scrollY,main:document.querySelector('#main')?.scrollTop||0},width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,chart:bounds,section:box(document.querySelector('#product-page .chart-wrap')||document.querySelector('.chart-section')),labels,small:texts.filter(e=>parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({text:e.textContent,size:getComputedStyle(e).fontSize})),gridlines:svg.querySelectorAll('[data-gridline]').length||svg.querySelectorAll(':scope>line:not([data-now-divider]):not([data-gm-leader])').length,quantity:getComputedStyle(document.querySelector('.big-number')).fontSize,bodyFont:getComputedStyle(document.documentElement).fontFamily}
 })
 report.geometry.push({variant,size,...g});check(`${variant} ${size} no overflow`,g.scroll<=g.width,g.scroll)
 if(variant!=='option-a3'){
  check(`${variant} ${size} font floor`,g.small.length===0,g.small)
  check(`${variant} ${size} gridline budget`,g.gridlines<=(variant==='option-gm-b'?4:3),g.gridlines)
  check(`${variant} ${size} chart fits`,g.chart.bottom<=g.height&&g.chart.x>=0&&g.chart.right<=g.width,g.chart)
  check(`${variant} ${size} footer fits`,variant==='option-gm-b'?g.section.right<=g.width:g.section.bottom<=g.height-8,g.section)
  check(`${variant} ${size} labels inside chart`,g.labels.every(t=>t.x>=g.chart.x-1&&t.right<=g.chart.right+1&&t.y>=g.chart.y-1&&t.bottom<=g.chart.bottom+1),g.labels)
 }
}
async function main(){
 fs.mkdirSync(out,{recursive:true})
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
 const executablePath=process.env.CHROMIUM_EXECUTABLE||undefined
 const browser=await chromium.launch({headless:true,executablePath})
 report.browser={version:browser.version(),executablePath,frozenDate:'2026-11-12T09:00:00Z',offline:true}
 const baselineNumeric=new Map(),baselineSemantic=new Map(),baselineSeries=new Map()
 try{
 for(const variant of variants){
  const sourcePath=variant==='option-gm-b'?path.join(__dirname,'stock-runway.html'):path.join(__dirname,'design',variant+'.html'),html=fs.readFileSync(sourcePath,'utf8')
  report.sources.push({variant,path:sourcePath,sha256:hash(html),bytes:Buffer.byteLength(html)})
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const size=`${viewport.width}x${viewport.height}`,context=await browser.newContext({offline:true,serviceWorkers:'block',viewport,deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:'light',isMobile:viewport.width===390,hasTouch:viewport.width===390})
   await context.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-12T09:00:00Z']))}static now(){return new D('2026-11-12T09:00:00Z').getTime()}}})
   await context.route(/^https?:/,route=>{report.network.push(route.request().url());return route.abort()})
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push({variant,size,error:String(e)}))
   await page.goto(pathToFileURL(sourcePath).href+(variant==='option-gm-b'?'#product=SEAL-WHT-300':''));await page.waitForSelector(variant==='option-gm-b'?'#product-page svg[data-chart]':'svg[data-chart]');if(variant==='option-gm-b')await page.locator('#product-page .chart-wrap').scrollIntoViewIfNeeded();if(viewport.width===390&&variant!=='option-gm-b')await page.locator('.chart-section').evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));await settle(page)
   const shot=path.join(out,`${variant}-${size}-en.png`);await page.screenshot({path:shot,fullPage:false});report.screenshots.push(shot)
   await geometry(page,variant,size)
   const skus=await page.locator('.sku-button').evaluateAll(es=>es.map(e=>e.dataset.sku))
   for(const sku of skus){
    await page.evaluate(({sku,variant})=>location.hash=(variant==='option-gm-b'?'product=':'sku=')+encodeURIComponent(sku),{sku,variant});await page.waitForFunction(s=>document.body.dataset.selectedSku===s,sku)
    for(const zoom of ['6','12','24','all']){
     await page.locator(`${variant==='option-gm-b'?'#product-page ':''}[data-zoom="${zoom}"]`).click();await settle(page)
     const key=`${size}:${sku}:${zoom}`,numbers=await numeric(page)
     report.numeric.push({variant,key,numbers})
     // Exact DOM data-value attributes cover every rendered demand/stock/receipt number.
     const series=await page.locator(variant==='option-gm-b'?'#product-page svg[data-chart]':'svg[data-chart]').evaluate(svg=>[...svg.querySelectorAll('[data-value]')].map(e=>({kind:e.hasAttribute('data-period')?e.getAttribute('data-period'):e.hasAttribute('data-delivery-marker')?'delivery':'stock',month:e.getAttribute('data-month'),value:e.getAttribute('data-value'),quantity:e.getAttribute('data-quantity')})))
     const quantity=await page.locator('.big-number').textContent()
     if(variant==='option-a3'){baselineNumeric.set(key,numbers);baselineSemantic.set(key,quantity);baselineSeries.set(key,series)}
     else{
      check(`${variant} ${key} quantity identical`,quantity===baselineSemantic.get(key),quantity)
      check(`${variant} ${key} all rendered numeric series identical`,JSON.stringify(series)===JSON.stringify(baselineSeries.get(key)),series.length)
      const before=baselineNumeric.get(key),tokens=numbers.map(n=>n.token),prior=before.map(n=>n.token)
      if(JSON.stringify(tokens)!==JSON.stringify(prior))report.raw_number_differences.push({variant,key,before:prior,after:tokens})
     }
    }
   }
   // A dying/no-sales sample is not an actionable copy fixture. Select the
   // intermittent order-now product explicitly before exercising copy and Why.
   await page.evaluate(v=>location.hash=(v==='option-gm-b'?'product=':'sku=')+'UL-FOAM-GRN',variant);await page.waitForFunction(()=>document.body.dataset.selectedSku==='UL-FOAM-GRN');await settle(page)
   // Exercise actual retained interactions, not screenshot-only DOM.
   if(variant!=='option-a3'){
    if(variant==='option-gm-b'&&viewport.width===390){await page.locator('#product-page .product-order-action').getByRole('button',{name:'Copy order',exact:true}).click();await page.waitForFunction(()=>/copied|copy/i.test(document.querySelector('#product-page .product-order-action [role=status]')?.textContent||''));check(`${variant} ${size} product copy feedback`,await page.locator('#product-page .product-order-action [role=status]').textContent().then(t=>/copied|copy/i.test(t)))}else{if(variant==='option-gm-b')await page.getByRole('button',{name:'Side panel view',exact:true}).click();await page.locator('.big-number').click();check(`${variant} ${size} why dialog opens`,await page.locator('#why-dialog').evaluate(d=>d.open));await page.keyboard.press('Escape')}
    if(variant==='option-gm-b'&&viewport.width===390){await page.locator('#product-page-close').click();await page.locator('#product-page').waitFor({state:'detached'})}
    await page.locator('#tools>summary').click();await page.locator('#copy-po').click();await page.waitForFunction(()=>Boolean(document.getElementById('copy-status').textContent.trim()));check(`${variant} ${size} copy feedback`,Boolean((await page.locator('#copy-status').textContent()).trim()));await page.locator('#tools>summary').click()
    if(viewport.width===390&&variant!=='option-gm-b'){await page.locator('#browse-toggle').click();check(`${variant} phone list expands`,await page.locator('#sku-list').isVisible());await page.locator('.sku-button').first().click();check(`${variant} phone list collapses`,await page.locator('#sku-list').isHidden())}
   }
   await context.close()
  }
  // Expose the module-local evaluation only in an ignored probe copy, never shipped.
  const probe=path.join(out,variant+'-probe.html'),code='\nwindow.gmNumericProof=JSON.parse(JSON.stringify(currentRows));\n'
  fs.writeFileSync(probe,html.replace('</script>',code+'</script>'))
  const ctx=await browser.newContext({offline:true,serviceWorkers:'block'});await ctx.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-12T09:00:00Z']))}static now(){return new D('2026-11-12T09:00:00Z').getTime()}}})
  await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()})
  const p=await ctx.newPage();await p.goto(pathToFileURL(probe).href);await p.waitForFunction(()=>window.gmNumericProof)
  const rows=await p.evaluate(()=>window.gmNumericProof);fs.writeFileSync(path.join(out,variant+'-calculated-numbers.json'),JSON.stringify(rows,null,2)+'\n')
  if(variant==='option-a3')report.baseline_calculations=hash(JSON.stringify(rows));else check(`${variant} complete calculated rows identical`,hash(JSON.stringify(rows))===report.baseline_calculations,hash(JSON.stringify(rows)))
  await ctx.close()
 }
 check('no runtime errors',report.errors.length===0,report.errors);check('no network requests',report.network.length===0,report.network)
 }finally{
  await browser.close();report.status=report.checks.every(c=>c.pass)?'PASS':'FAIL'
  fs.writeFileSync(path.join(out,'brand-browser-report.json'),JSON.stringify(report,null,2)+'\n')
 }
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass).map(c=>c.name),screenshots:report.screenshots,raw_number_difference_states:report.raw_number_differences.length,errors:report.errors},null,2))
 if(report.status!=='PASS')process.exitCode=1
}
main().catch(e=>{console.error(e);process.exitCode=1})
