// Lifecycle: living. Local display-risk proof; requires the parent's merged build.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/pp')
const report={screenshots:[],checks:[],errors:[],network:[],not_checked:['Owner design approval','Real iPhone / Safari','Arabic UI','Live inventory','Forecast calibration; these are model estimates']}
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert.ok(value,name)}
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
function makeHarness(source){
 assert.ok(source.includes('function productRiskPanel')&&source.includes('StockRunwayRisk'),'Rebuild with the shared risk model, chart cloud and risk UI before capture-risk.cjs. This script never rebuilds.')
 const hook=`
window.riskCapture={
 open(){
  const row=currentRows.find(r=>riskReady(r)&&r.guidance.quantity>0&&riskSpec(r));if(!row)throw Error('No eligible sample product');
  riskCache.delete(row);const start=performance.now(),result=productRisk(row),ms=performance.now()-start;
  if(!result)throw Error('Shared simulateRisk is unavailable or invalid');openProductPage(row);
  return {sku:row.item.sku,result,ms,quantity:row.guidance.quantity,original:JSON.stringify([row.item.projection,row.guidance,settings,localOrders.records])};
 },
 snapshot(){const row=rowMap.get(selectedSku);return {quantity:row.guidance.quantity,original:JSON.stringify([row.item.projection,row.guidance,settings,localOrders.records]),metrics:window.riskMetrics}},
 held(){const row=currentRows.find(r=>r.item.held||r.guidance.status==='needs-data');if(!row)return null;openProductPage(row);return row.item.sku},
 scale(){
  removeProductPage();wlCloseDrawer();wlSetMode('simple');wl.columns=WL_SIMPLE_COLUMNS.slice();riskScheduleColumns();
  const seeds=currentRows.filter(r=>riskReady(r)&&riskSpec(r));if(!seeds.length)throw Error('No eligible scale seeds');
  currentRows=Array.from({length:1000},(_,n)=>{const seed=seeds[n%seeds.length];return {...seed,item:{...seed.item,sku:'RISK-SCALE-'+String(n).padStart(4,'0')}}});
  rowMap=new Map(currentRows.map(r=>[r.item.sku,r]));wl.source=null;wl.status='all';wl.group='none';wl.sort='urgency';wl.collapsed.clear();wlSetMode('detailed');
  return {total:currentRows.length,callsBefore:window.riskMetrics.computed,description:'Synthetic catalogue cloned from evaluated offline sample rows; all 1000 SKUs run the real shared simulation, not cached copies.'};
 }
};`
 assert.ok(source.includes('</script>'),'No inline module found')
 return source.replace('</script>',hook+'\n</script>')
}
async function shot(page,name){
 await settle(page);const file=path.join(out,name+'.png');await page.screenshot({path:file});report.screenshots.push(file)
 const geometry=await page.evaluate(()=>{const p=document.querySelector('#product-page');return {viewport:innerWidth,page:document.documentElement.scrollWidth,product:p?.clientWidth,productScroll:p?.scrollWidth}})
 check(name+' no horizontal overflow',geometry.page<=geometry.viewport&&(!geometry.product||geometry.productScroll<=geometry.product))
}
async function chartInView(page){await page.locator('#product-page').evaluate(p=>{const chart=p.querySelector('.product-page-chart');p.scrollTop=chart.offsetTop-110});await settle(page)}
async function hoverForecast(page,touch=false){
 const point=await page.locator('#product-page .chart-wrap svg').evaluate(svg=>{
  const bar=svg.querySelector('[data-period=forecast]'),grid=svg.querySelector('[data-gridline]');if(!bar||!grid)return null
  const lines=[...svg.querySelectorAll('[data-gridline]')],ys=lines.map(e=>Number(e.getAttribute('y1'))),x=Number(bar.getAttribute('x'))+Number(bar.getAttribute('width'))/2,y=(Math.min(...ys)+Math.max(...ys))/2,p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y}
 });check('forecast hover target exists',point);if(touch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.move(point.x,point.y);await page.waitForSelector('#product-page .chart-tooltip:not([hidden])')
 const text=await page.locator('#product-page .chart-tooltip:not([hidden])').innerText();check('tooltip shows expected / likely / wide',/expected/i.test(text)&&/likely/i.test(text)&&/wide/i.test(text));return text
}
async function main(){
 fs.mkdirSync(out,{recursive:true});const input=process.env.RISK_HTML?path.resolve(process.env.RISK_HTML):path.join(__dirname,'inventory-manager.html'),probe=path.join(out,'risk-probe.html');fs.writeFileSync(probe,makeHarness(fs.readFileSync(input,'utf8')))
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
 try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const ctx=await browser.newContext({viewport,deviceScaleFactor:1,colorScheme:'light',reducedMotion:'reduce',isMobile:viewport.width===390,hasTouch:viewport.width===390})
   await ctx.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-11-17T09:00:00Z']))}static now(){return new D('2026-11-17T09:00:00Z').getTime()}};localStorage.setItem('stock-runway.product-view','page')})
   await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()});const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(viewport.width+': '+e.message))
   await page.goto(pathToFileURL(probe).href);await page.waitForFunction(()=>window.riskCapture);const opened=await page.evaluate(()=>window.riskCapture.open());report.products=report.products||[];report.products.push({width:viewport.width,...opened})
   check(viewport.width+' cold product risk under 100ms',opened.ms<100);check(viewport.width+' real 1000 paths',opened.result.paths===1000);await page.locator('#product-show-detail').click()
   const line=page.locator('#product-page .product-risk-line'),slider=page.getByRole('slider',{name:'Order amount',exact:true})
   check(viewport.width+' quiet risk line',/^Chance of running out: \d+% before the order arrives · \d+% after ordering$/.test(await line.textContent()))
   check(viewport.width+' slider range and default',await slider.getAttribute('min')==='-50'&&await slider.getAttribute('max')==='100'&&await slider.inputValue()==='0')
   await chartInView(page)
   const cloud=page.locator('#product-page svg [data-prediction-band],#product-page svg [data-forecast-band],#product-page svg [data-cloud],#product-page svg [data-forecast-cloud],#product-page svg [data-band]')
   check(viewport.width+' prediction cloud present',await cloud.count()>0)
   check(viewport.width+' prediction cloud visibly drawn',await cloud.evaluateAll(es=>es.some(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>0&&s.fill!=='none'})))
   check(viewport.width+' likely range ledger column',await page.locator('#product-page .product-ledger th').allTextContents().then(xs=>xs.includes('Likely range')))
   check(viewport.width+' labels <=12px and no event text collisions',await page.locator('#product-page .chart-wrap svg').evaluate(svg=>{
    const es=[...svg.querySelectorAll('[data-today-label],[data-runout-label],[data-order-by-label],[data-suggested-arrival-label]')],boxes=es.map(e=>e.getBoundingClientRect());
    return [...svg.querySelectorAll('text')].every(e=>parseFloat(getComputedStyle(e).fontSize)<=12)&&boxes.every((a,i)=>boxes.slice(i+1).every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));
   }))
   await shot(page,'cloud-'+viewport.width)
   if(viewport.width===1440){report.tooltip=await hoverForecast(page);await shot(page,'cloud-tooltip-1440');await page.mouse.move(0,0)}
   if(viewport.width===390){
    await chartInView(page);await hoverForecast(page,true);
    check('390 tap retains expected / likely / wide tooltip',await page.locator('#product-page .chart-tooltip:not([hidden])').textContent().then(t=>/Expected .*likely .*wide/.test(t)));
    if(await page.locator('#focus-close').count())await page.locator('#focus-close').click();
   }
   report.debounce=report.debounce||[];
   const latency=await page.evaluate(()=>new Promise(resolve=>{const slider=document.querySelector('#product-risk-amount'),line=document.querySelector('.product-risk-line'),start=performance.now(),observer=new MutationObserver(()=>{observer.disconnect();resolve(performance.now()-start)});observer.observe(line,{attributes:true,attributeFilter:['data-after']});slider.value='-50';slider.dispatchEvent(new Event('input',{bubbles:true}));}));
   report.debounce.push({width:viewport.width,ms:latency});// Headless timings on a shared machine measured 75–145 ms (1,000 simulated paths); budget matches the demo's 200 ms interaction bar.
   check(viewport.width+' debounced live risk under 200ms',latency<200)
   // Keyboard is the real range interaction: default 0 -> Home -50 -> End +100.
   await slider.focus();await page.keyboard.press('Tab');check(viewport.width+' Tab exits slider inside report',await page.evaluate(()=>document.querySelector('#product-page').contains(document.activeElement)&&document.activeElement.id!=='product-risk-amount'));await page.keyboard.press('Shift+Tab');check(viewport.width+' Shift+Tab returns to slider',await slider.evaluate(e=>document.activeElement===e))
   await page.keyboard.press('Home');await page.waitForTimeout(80);check(viewport.width+' keyboard reaches −50%',await slider.inputValue()==='-50');const low=Number(await line.getAttribute('data-after'))
   await page.keyboard.press('End');await page.waitForTimeout(80);check(viewport.width+' keyboard reaches +100%',await slider.inputValue()==='100');const high=Number(await line.getAttribute('data-after'))
   check(viewport.width+' bigger scenario reduces or equals after-order risk',high<=opened.result.after&&opened.result.after<=low);check(viewport.width+' before-order risk unchanged',Number(await line.getAttribute('data-before'))===opened.result.before)
   const snapshot=await page.evaluate(()=>window.riskCapture.snapshot());check(viewport.width+' suggested quantity and planning inputs unchanged',snapshot.quantity===opened.quantity&&snapshot.original===opened.original)
   report.slider=report.slider||[];report.slider.push({width:viewport.width,minus50:low,plus100:high})
   if(viewport.width===1440){await page.locator('#product-page').evaluate(p=>{p.scrollTop=p.querySelector('.product-risk').offsetTop-100});await shot(page,'risk-slider-1440')}
   const held=await page.evaluate(()=>window.riskCapture.held());if(held)check(viewport.width+' needs-data product risk withheld',await page.locator('#product-page .product-risk').count()===0)
   if(viewport.width===1440){
    report.scale=await page.evaluate(()=>window.riskCapture.scale());await page.waitForFunction(()=>window.riskMetrics.columns.total===1000&&window.riskMetrics.columns.complete,{},{timeout:60000});report.scale.metrics=await page.evaluate(()=>window.riskMetrics.columns);report.scale.simulationCalls=await page.evaluate(()=>window.riskMetrics.computed)-report.scale.callsBefore
    check('all 1000 real column simulations completed',report.scale.metrics.computed===1000&&report.scale.metrics.withheld===0&&report.scale.simulationCalls===1000);check('1000 column risk active computation under 1500ms',report.scale.metrics.active_ms<1500)
    check('Run-out risk column available',await page.locator('.work-head [data-column=risk]').count()===1)
    await page.locator('#work-view>summary').click();await page.locator('[data-density=simple]').click();check('Simple includes risk chip column',await page.locator('.work-head [data-column=risk]').count()===1&&await page.locator('.work-row [data-column=risk] .decision-risk-chip').count()>0);check('Simple risk chips use Low/Medium/High labels',await page.locator('.work-row [data-column=risk] .decision-risk-chip').evaluateAll(es=>es.every(e=>['Low','Medium','High'].includes(e.textContent)&&e.getAttribute('aria-label')===e.textContent+' risk')))
   }
   await ctx.close()
  }
  check('no page errors',report.errors.length===0);check('no network requests',report.network.length===0)
 }finally{await browser.close();fs.writeFileSync(path.join(out,'risk-report.json'),JSON.stringify(report,null,2)+'\n')}
 console.log(JSON.stringify(report,null,2));return report
}
module.exports={makeHarness,main}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
