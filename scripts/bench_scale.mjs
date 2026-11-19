// Offline scale probe. Python companion generates deterministic input files.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const input=path.resolve(process.argv[2]||path.join(root,'.scratch/scale/data.json'))
const data=JSON.parse(fs.readFileSync(input,'utf8'))
const diary=JSON.parse(fs.readFileSync(path.join(path.dirname(input),'seed-diary.json'),'utf8'))
const source=fs.readFileSync(path.join(root,'desktop/plugin.js'),'utf8'),ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={evaluateDataset,orderGuidance,orderBucket,withEvaluationPass,learningEvents,learningReport,forecastDiary,prepareLearning}',ctx)
const api=ctx.api,settings={default_delivery_days:14,months_of_cover:2},today='2026-01-01'
const result={size:data.items.length,months:data.months.length,node:process.version,ms:{}}
const measure=(key,fn)=>{const start=performance.now();const value=fn();result.ms[key]=+(performance.now()-start).toFixed(2);return value}
measure('evaluate+orderGuidance',()=>api.withEvaluationPass(()=>{
 const rows=api.evaluateDataset(data,6,settings,today)
 for(const item of rows)api.orderGuidance(item,today,settings,data.as_of)
 assert.equal(rows.length,data.items.length)
}))
measure('diary+learn-full',()=>api.withEvaluationPass(()=>{
 const ls={learning_enabled:true},log=api.learningEvents(data,diary,ls)
 const prepared=api.prepareLearning(data,diary,ls),rows=api.evaluateDataset(prepared,6,settings,today)
 for(const item of rows){api.orderGuidance(item,today,settings,data.as_of);api.orderBucket(item,today,settings,data.as_of)}
 api.learningReport(data,diary,ls,log);api.forecastDiary(prepared)
}))
if(process.argv.includes('--browser')){
 const require=createRequire(import.meta.url)
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
  page.on('pageerror',e=>errors.push(String(e)))
  if(process.argv.includes('--learning'))await page.addInitScript(({diary})=>{
    localStorage.setItem('stock-runway.learning.settings.v1',JSON.stringify({archive_enabled:true,learning_enabled:true}))
    localStorage.setItem('stock-runway.forecast-diary.v1',JSON.stringify(diary))
  },{diary})
  await page.route(/^https?:/,route=>route.abort())
  // Instrument the pure selection implementation, not memoized API lookups.
  const html=fs.readFileSync(path.join(root,'standalone/design/option-a3.html'),'utf8').replace('function selectForecast(item,lastMonth,history=baseAdoptedDemandHistory(item,lastMonth)){','function selectForecast(item,lastMonth,history=baseAdoptedDemandHistory(item,lastMonth)){globalThis.scaleSelectionCalls=(globalThis.scaleSelectionCalls||0)+1;').replace('initializeSheets();initializeLearning();syncSettings(); render()', 'globalThis.scaleRender=render;initializeSheets();initializeLearning();syncSettings(); render()')
  const target=path.join(root,'.scratch/scale-browser.html');fs.writeFileSync(target,html)
  await page.goto(pathToFileURL(target).href)
  const csv=fs.readFileSync(path.join(path.dirname(input),'stock.csv'),'utf8')
  await page.evaluate(()=>{globalThis.scaleSelectionCalls=0})
  const start=performance.now()
  await page.locator('#csv-file').setInputFiles({name:'scale.csv',mimeType:'text/csv',buffer:Buffer.from(csv)})
  await page.waitForFunction(n=>document.querySelectorAll('.sku-button').length===n,data.items.length)
  result.ms['a3-load-wall']=+(performance.now()-start).toFixed(2)
  result.ms['a3-render']=+(await page.locator('body').getAttribute('data-render-ms'))
  result.selectionCalls=await page.evaluate(()=>globalThis.scaleSelectionCalls)
  const before=result.selectionCalls
  const checkOnce=(actual,message)=>{if(process.argv.includes('--assert-once'))assert.equal(actual,before,message)}
  await page.locator('.sku-button').nth(1).click()
  result.ms['a3-product-switch']=+(await page.locator('body').getAttribute('data-switch-ms'))
  assert.equal(await page.evaluate(()=>globalThis.scaleSelectionCalls),before,'product switch must not recompute selections')
  // Repeated render and drawer use the same snapshot memo, never select again.
  await page.evaluate(()=>globalThis.scaleRender())
  checkOnce(await page.evaluate(()=>globalThis.scaleSelectionCalls),'repeat render must reuse snapshot')
  await page.locator('.big-number').click()
  checkOnce(await page.evaluate(()=>globalThis.scaleSelectionCalls),'drawer must reuse snapshot')
  if(process.argv.includes('--assert-once'))assert.equal(result.selectionCalls,data.items.length,'one selection per SKU per A3 load')
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
}
console.log(JSON.stringify(result,null,2))
