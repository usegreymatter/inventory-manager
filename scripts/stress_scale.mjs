// Actual offline headless Chrome interaction probe; no installs or network.
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const target=path.resolve(process.argv[2]),realPaint=process.argv.includes('--real-paint'),output=path.join(path.dirname(target),realPaint?'browser-real-paint.json':process.argv.includes('--before')?'browser-before.json':'browser.json')
assert(target.includes('/.scratch/'),'Only scratch builds may be measured')
// Instrument a new scratch copy before parsing, not a post-render DOM mutation.
// The original fixture and its startup/analysis clocks remain byte-for-byte intact.
let navigationTarget=target
if(realPaint){
 const html=fs.readFileSync(target,'utf8'),anchor="cell.append(b)}else if(key==='status')"
 assert.equal(html.split(anchor).length,2,'Expected exactly one worklist product constructor')
 navigationTarget=path.join(path.dirname(target),'catalog-element-paint.html')
 fs.writeFileSync(navigationTarget,html.replace(anchor,"b.querySelector('.work-name').setAttribute('elementtiming','stress-useful-product');"+anchor))
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--disable-background-networking']})
const result={target,html_sha256:createHash('sha256').update(fs.readFileSync(target)).digest('hex'),timing_scope:{first_useful:'analysis start to first useful render rAF callback; not guaranteed painted pixels',full_analysis:'analysis start to complete state',load_first_render:'navigation start through full readiness and two rAF callbacks',max_long_task:'entire navigation plus measured interaction suite'},completed:false,skip_risk_all:process.argv.includes('--skip-risk-all'),chrome:browser.version(),viewport:{width:1440,height:900},ms:{},errors:[],blocked:[],longTasks:[]}
try{
 const context=await browser.newContext({viewport:result.viewport,acceptDownloads:false})
 const page=await context.newPage()
 page.setDefaultTimeout(1800000)
 page.on('pageerror',error=>result.errors.push(String(error)))
 await page.route(/^https?:/,route=>{result.blocked.push(route.request().url());return route.abort()})
 await page.addInitScript(()=>{
  const NativeDate=Date,fixed=NativeDate.parse('2026-01-01T12:00:00Z')
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}
  globalThis.stressLongTasks=[]
  new PerformanceObserver(list=>{for(const e of list.getEntries())stressLongTasks.push({start:e.startTime,ms:e.duration})}).observe({type:'longtask',buffered:true})
 })
 if(realPaint){
  result.timing_scope.first_useful_paint='navigation start to earliest positive Element Timing renderTime of a visible worklist product name; not shell FCP or rAF'
  result.instrumented_html_sha256=createHash('sha256').update(fs.readFileSync(navigationTarget)).digest('hex')
  await page.addInitScript(()=>{
   globalThis.stressElementPaint={supported:PerformanceObserver.supportedEntryTypes.includes('element'),entries:[]}
   if(!stressElementPaint.supported)return
   new PerformanceObserver(list=>{
    for(const e of list.getEntries()){
     if(e.identifier!=='stress-useful-product')continue
     const r=e.intersectionRect,element=e.element,row=element?.closest('.work-row')
     stressElementPaint.entries.push({renderTime:e.renderTime,startTime:e.startTime,identifier:e.identifier,text:element?.textContent,sku:row?.dataset.sku,rowText:row?.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height},observedAt:performance.now()})
    }
   }).observe({type:'element',buffered:true})
  })
 }
 const wall=performance.now()
 await page.goto(pathToFileURL(navigationTarget).href,{waitUntil:'load',timeout:1800000})
 if(realPaint){
  assert(await page.evaluate(()=>stressElementPaint.supported),'Element Timing unsupported; no paint estimate substituted')
  await page.waitForFunction(()=>stressElementPaint.entries.some(e=>e.renderTime>0&&e.rect.width>0&&e.rect.height>0&&e.sku&&e.text),null,{timeout:30000})
  result.element_paint=await page.evaluate(()=>{
   const entries=stressElementPaint.entries.filter(e=>e.renderTime>0&&e.rect.width>0&&e.rect.height>0&&e.sku&&e.text).sort((a,b)=>a.renderTime-b.renderTime)
   return {supported:stressElementPaint.supported,first:entries[0],entries}
  })
  assert(result.element_paint.first.renderTime>0,'A real positive renderTime is required')
  result.ms.first_useful_product_paint=result.element_paint.first.renderTime
  const screenshotPath=path.join(path.dirname(target),'useful-paint.png')
  await page.screenshot({path:screenshotPath,fullPage:false})
  result.screenshot={path:screenshotPath,sha256:createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex'),scope:'viewport after first Element Timing observation, before readiness wait and interactions; not a screenshot timestamp oracle'}
 }
 await page.waitForFunction(()=>document.body.dataset.stressReady==='true')
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 result.ms.load_first_render=+(performance.now()-wall).toFixed(2)
 result.state=await page.evaluate(()=>stressAPI.state())
 result.boot=await page.evaluate(()=>({...globalThis.stressBoot,first_useful_ms:Number(document.body.dataset.analysisFirstUsefulMs)||globalThis.stressBoot?.first_useful_ms||null,full_analysis_ms:Number(document.body.dataset.analysisFullMs)||globalThis.stressBoot?.full_analysis_ms||null}))
 result.paint=await page.evaluate(()=>performance.getEntriesByType('paint').map(e=>({name:e.name,start_ms:e.startTime})))
 result.boot_max_long_task_ms=await page.evaluate(()=>Math.max(0,...stressLongTasks.map(e=>e.ms)))
 if(process.argv.includes('--worklist-only')||process.argv.includes('--capture-worklist')){
 const worklist=await page.evaluate(()=>JSON.stringify(stressAPI.rows()))
 const worklistPath=path.join(path.dirname(target),'worklist.json')
 fs.writeFileSync(worklistPath,worklist)
 result.worklist={path:worklistPath,bytes:Buffer.byteLength(worklist),sha256:createHash('sha256').update(worklist).digest('hex')}
 }
 if(process.argv.includes('--worklist-only')){
  result.longTasks=await page.evaluate(()=>stressLongTasks)
  result.max_long_task_ms=Math.max(0,...result.longTasks.map(e=>e.ms))
  assert.deepEqual(result.errors,[])
  result.completed=true
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
 }else{
 result.mounted_product_rows=await page.locator('.work-row').count()
 assert(result.mounted_product_rows<100,'Worklist must keep large catalogs virtualized')
 const cdp=await context.newCDPSession(page)
 const heap=async()=>{await cdp.send('HeapProfiler.collectGarbage');return (await cdp.send('Runtime.getHeapUsage')).usedSize}
 result.heap_loaded_bytes=await heap()
 const measure=async(key,expression)=>{
  const measured=await page.evaluate(async expression=>{
   const begin=performance.now(),value=(0,eval)(expression),sync=performance.now()-begin
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
   return {ms:+(performance.now()-begin).toFixed(2),sync_ms:+sync.toFixed(2),value}
  },expression)
  result.ms[key]=measured.ms
  result.sync_ms??={};result.sync_ms[key]=measured.sync_ms
  if(measured.value!==undefined)result[key+'_value']=measured.value
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
 }
 await measure('tab_order',"stressAPI.tab('order')")
 await measure('tab_all',"stressAPI.tab('all')")
 await measure('search',"stressAPI.search('Synthetic item 42')")
 result.search_count=(await page.evaluate(()=>stressAPI.state())).visible
 assert(result.search_count>0)
 await measure('search_clear',"stressAPI.search('')")
 await measure('group_supplier',"stressAPI.group('supplier')")
 await measure('group_status',"stressAPI.group('status')")
 await measure('sort_qty',"stressAPI.sort('qty')")
 await measure('sort_product',"stressAPI.sort('product')")
 await measure('sort_urgency',"stressAPI.sort('urgency')")
 await measure('product_open',"stressAPI.product();undefined")
 assert(await page.locator('.product-page').count())
 await measure('product_close',"stressAPI.closeProduct();undefined")
 await measure('risk_product_cold',"stressAPI.risk()")
 await measure('weekly_summary',"stressAPI.summary();undefined")
 assert(await page.locator('#weekly-summary[open]').count())
 result.summary_dom_rows=await page.locator('#weekly-summary tbody tr').count()
 await measure('weekly_close',"stressAPI.closeSummary();undefined")
 await measure('excel_export',"stressAPI.excel()")
 assert(result.excel_export_value>1000)
 result.heap_after_actions_bytes=await heap()
 // Optional risk column is genuinely asynchronous: record wall and active CPU
 // separately, while a timer tracks whether batches freeze the UI.
 if(!process.argv.includes('--skip-risk-all')){
 const riskStart=performance.now()
 await page.evaluate(()=>{globalThis.stressHeartbeat={last:performance.now(),max:0,ticks:0};globalThis.stressBeat=setInterval(()=>{const now=performance.now();stressHeartbeat.max=Math.max(stressHeartbeat.max,now-stressHeartbeat.last);stressHeartbeat.last=now;stressHeartbeat.ticks++},50);stressAPI.riskAll()})
 await page.waitForFunction(()=>stressAPI.riskMetrics().columns.complete,null,{timeout:1800000,polling:200})
 result.ms.risk_all_wall=+(performance.now()-riskStart).toFixed(2)
 result.risk=await page.evaluate(()=>{clearInterval(stressBeat);return {metrics:stressAPI.riskMetrics(),heartbeat:stressHeartbeat}})
 result.ms.risk_all_active=+result.risk.metrics.columns.active_ms.toFixed(2)
 result.heap_after_risk_bytes=await heap()
 assert.equal(result.risk.metrics.columns.processed,result.state.count)
 assert.equal(result.risk.metrics.errors,0)
 }
 result.longTasks=await page.evaluate(()=>stressLongTasks)
 result.max_long_task_ms=Math.max(0,...result.longTasks.map(e=>e.ms))
 result.over_2s=Object.entries(result.ms).filter(([,v])=>v>2000).map(([k])=>k)
 result.frozen_tasks=result.longTasks.filter(e=>e.ms>2000)
 assert.deepEqual(result.errors,[])
 result.completed=true
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify({...result,longTasks:result.longTasks.length},null,2))
}
}catch(error){
 result.failure=String(error.stack||error)
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
 throw error
}finally{await browser.close()}
