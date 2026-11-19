// Offline cold-open/full-row parity probe. Run against a frozen pre-change HTML
// and a newly built HTML; all fixtures and receipts must live in .scratch.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE)
const [before,after,dataset,method='current',output='.scratch/pp/cold-parity']=process.argv.slice(2)
for(const p of [before,after,output])assert(path.resolve(p).includes('/.scratch/'))
const fixture=JSON.parse(fs.readFileSync(dataset,'utf8')),results=[]
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--disable-background-networking']})
try{
 for(const [label,input]of [['before',before],['after',after]]){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[]
  await page.route(/^https?:/,r=>r.abort())
  page.on('pageerror',e=>errors.push(String(e)))
  await page.addInitScript(()=>{const D=Date,t=D.parse('2026-01-01T12:00:00Z');globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:[t]))}static now(){return t}};globalThis.coldLong=[];new PerformanceObserver(l=>coldLong.push(...l.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true})})
  let html=fs.readFileSync(input,'utf8').replace(/const STANDALONE_DEMO_DATA=[^\n]*\n/,'const STANDALONE_DEMO_DATA='+JSON.stringify(fixture).replaceAll('<','\\u003c')+'\n')
  html=html.replace('initializeSheets();initializeLearning();syncSettings();',`localStorage.setItem(gmSettingsKey(data),JSON.stringify({...DEFAULT_ORDER_SETTINGS,forecast_method:${JSON.stringify(method)}}));initializeSheets();initializeLearning();syncSettings();`)
  html=html.replace('</script>',`globalThis.coldAPI={rows:()=>JSON.stringify(currentRows),ready:()=>currentRows.length===data.items.length&&(!document.body.dataset.analysisState||document.body.dataset.analysisState==='complete')};</script>`)
  const target=path.resolve(output+'-'+label+'.html');fs.writeFileSync(target,html)
  await page.goto(pathToFileURL(target).href,{waitUntil:'load',timeout:1800000})
  await page.waitForFunction(()=>coldAPI.ready(),null,{timeout:1800000})
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  const rows=await page.evaluate(()=>coldAPI.rows());fs.writeFileSync(output+'-'+label+'.json',rows)
  const timing=await page.evaluate(()=>({first_useful_ms:Number(document.body.dataset.analysisFirstUsefulAt)||performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint')?.startTime||performance.now(),full_ms:Number(document.body.dataset.analysisFullAt)||performance.now(),tasks:coldLong}))
  assert.deepEqual(errors,[]);results.push({label,count:fixture.items.length,method,...timing,errors})
  await context.close()
 }
 assert.equal(fs.readFileSync(output+'-before.json','utf8'),fs.readFileSync(output+'-after.json','utf8'),'Complete computed worklist JSON must remain byte-identical')
 fs.writeFileSync(output+'-receipt.json',JSON.stringify({identical:true,results},null,2)+'\n');console.log(JSON.stringify(results.map(({tasks,...r})=>({...r,max_task_ms:Math.max(0,...tasks.map(t=>t.ms))}))))
}finally{await browser.close()}
