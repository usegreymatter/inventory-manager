// Lifecycle: living. Offline trusted synthetic fixture, NOT importer acceptance.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.SCALE_OUT||path.join(root,'.scratch/methods-scale'))
fs.mkdirSync(out,{recursive:true})
const rounds=Number(process.env.SCALE_RUNS||5);assert.ok(Number.isInteger(rounds)&&rounds>=3)
const generated=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import json
from forecast_lab.benchmark_methods import generate
print(json.dumps(generate(5000)))`],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024})
assert.equal(generated.status,0,generated.stderr)
const rows=JSON.parse(generated.stdout),months=Array.from({length:60},(_,i)=>{const d=new Date(Date.UTC(2021,10+i,1));return d.toISOString().slice(0,7)})
const fixture={dataset:'Synthetic5000 performance only',note:'Seed 20261118; trusted scratch fixture, not CSV importer evidence',months,as_of:'2026-10-31',items:rows.map((r,i)=>({sku:r.sku,name:'Synthetic '+r.process+' '+i,category:r.process,supplier:'Synthetic supplier '+i%20,unit:'units',monthly_sales:[...Array(60-r.observed.length).fill(0),...r.observed],on_hand:Math.round(r.observed.slice(-12).reduce((a,b)=>a+b,0)/12*(i%4)),supplier_days:14+i%30,on_order:0,receipts:{},open_receipts:[]}))}
assert.equal(new Set(fixture.items.map(i=>i.sku)).size,5000)
fs.writeFileSync(path.join(out,'synthetic5000.json'),JSON.stringify(fixture))
const sourcePath=path.resolve(process.env.FORECAST_PAGE||path.join(__dirname,'stock-runway.html')),source=fs.readFileSync(sourcePath,'utf8')
const hooks=`
window.scaleQA={renders:scaleRenders,state:()=>({count:currentRows.length,method:settings.forecast_method,held:currentRows.filter(r=>r.item.held||r.guidance.status==='needs-data').length,hold_examples:currentRows.filter(r=>r.item.held||r.guidance.status==='needs-data').slice(0,20).map(r=>({sku:r.item.sku,category:r.item.category,reason:r.guidance.reason||r.item.reason,requested:r.item.forecast_method?.requested})),requested:currentRows.reduce((o,r)=>{const k=r.item.forecast_method?.requested||'current';o[k]=(o[k]||0)+1;return o},{}),used:currentRows.reduce((o,r)=>{const k=r.item.forecast_method?.method||'current';o[k]=(o[k]||0)+1;return o},{}),sample:currentRows.slice(0,10).map(r=>({sku:r.item.sku,method:r.item.forecast_method,curve:r.item.projection.map(p=>p.demand)}))}),table:()=>render(),prepare:sku=>{removeProductPage();$('search').value=sku;wl.status='all';buildList()},close:()=>removeProductPage()};
`
const report={fixture_sha256:crypto.createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),source_sha256:crypto.createHash('sha256').update(source).digest('hex'),source:sourcePath,date:'2026-11-01T12:00:00Z',rounds,catalog:5000,classes:Object.fromEntries([...new Set(rows.map(r=>r.process))].map(k=>[k,rows.filter(r=>r.process===k).length])),runs:[],errors:[],network:[]}
function stats(v){const s=[...v].sort((a,b)=>a-b),n=s.length;return {n,median_ms:n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2,min_ms:s[0],max_ms:s[n-1]}}
async function timed(page,action){const measurement=await page.evaluate(action=>{const start=performance.now();if(action==='table')scaleQA.table();else if(action==='open'){const b=document.querySelector('.work-product');if(!b)throw Error('Missing real product button');b.click()}else{const e=document.querySelector('#setting-forecast_method');e.value=action;e.dispatchEvent(new Event('change',{bubbles:true}))}return {start,handler_ms:performance.now()-start}},action);await ready(page);return page.evaluate(async measurement=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {handler_ms:measurement.handler_ms,presented_ms:performance.now()-measurement.start}},measurement)}
// Hook installation and first rows precede full progressive analysis.
const ready=page=>page.waitForFunction(()=>document.body.dataset.analysisState==='complete',null,{timeout:180000})
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
try{for(let round=0;round<rounds;round++)for(const method of round%2?['auto','current']:['current','auto']){
const coldAnchor='function render(){return withDatasetEvaluation(renderPass)}';assert.ok(source.includes(coldAnchor));assert.ok(source.includes("forecast_method:'current', industry_preset:'none'"))
const html=source.replace(/^const SAMPLE = .*$/m,'const SAMPLE = '+JSON.stringify(fixture)+';').replace("forecast_method:'current', industry_preset:'none'",`forecast_method:'${method}', industry_preset:'none'`).replace(coldAnchor,'const scaleRenders=[];function render(){const t=performance.now();const result=withDatasetEvaluation(renderPass);scaleRenders.push(performance.now()-t);return result}').replace('</script>',hooks+'</script>')
const probe=path.join(out,`probe-${method}.html`);fs.writeFileSync(probe,html)
const context=await browser.newContext({offline:true,serviceWorkers:'block',viewport:{width:1440,height:900},reducedMotion:'reduce'})
await context.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()})
await context.addInitScript(()=>{const Real=Date;window.Date=class extends Real{constructor(...a){super(...(a.length?a:['2026-11-01T12:00:00Z']))}static now(){return new Real('2026-11-01T12:00:00Z').getTime()}}})
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
await page.goto(pathToFileURL(probe).href,{timeout:180000});await page.waitForFunction(()=>window.scaleQA,null,{timeout:180000});await ready(page)
const state=await page.evaluate(()=>scaleQA.state());assert.equal(state.count,5000);assert.equal(state.method,method);assert.deepEqual(state.requested,{[method]:5000})
const run={round,method,state,cold:await page.evaluate(()=>({first_render_ms:scaleQA.renders[0],startup_renders_ms:scaleQA.renders.slice(),load_ms:performance.now()})),opens:[]}
for(let i=0;i<10;i++){await page.evaluate(sku=>scaleQA.prepare(sku),fixture.items[i].sku);const measurement=await timed(page,'open');assert.equal(await page.locator('#product-page').count(),1);assert.equal(await page.evaluate(()=>new URLSearchParams(location.hash.slice(1)).get('product')),fixture.items[i].sku);run.opens.push({process:rows[i].process,sku:rows[i].sku,...measurement});await page.evaluate(()=>scaleQA.close())}
await page.evaluate(()=>{document.querySelector('#search').value='';scaleQA.table()});run.table=await timed(page,'table')
await page.evaluate(()=>{document.querySelector('#tools').open=true;document.querySelector('#open-settings').click()})
await timed(page,method==='auto'?'current':'auto');run.method_handler=await timed(page,method)
const after=await page.evaluate(()=>scaleQA.state());assert.deepEqual(after.requested,{[method]:5000});assert.equal(after.method,method)
report.runs.push(run);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();console.log(JSON.stringify({round,method,cold:run.cold,table:run.table,method_handler:run.method_handler,open:stats(run.opens.map(o=>o.handler_ms))}))
}
report.summary={};for(const method of ['current','auto']){const r=report.runs.filter(r=>r.method===method);report.summary[method]={cold:stats(r.map(r=>r.cold.first_render_ms)),startup:stats(r.map(r=>r.cold.load_ms)),table_handler:stats(r.map(r=>r.table.handler_ms)),table_presented:stats(r.map(r=>r.table.presented_ms)),method_handler:stats(r.map(r=>r.method_handler.handler_ms)),method_presented:stats(r.map(r=>r.method_handler.presented_ms)),product_handler:stats(r.map(r=>stats(r.opens.map(o=>o.handler_ms)).median_ms)),product_presented:stats(r.map(r=>stats(r.opens.map(o=>o.presented_ms)).median_ms)),by_class:Object.fromEntries(Object.keys(report.classes).map(k=>[k,{handler:stats(r.flatMap(r=>r.opens.filter(o=>o.process===k).map(o=>o.handler_ms))),presented:stats(r.flatMap(r=>r.opens.filter(o=>o.process===k).map(o=>o.presented_ms)))}]))}}
assert.equal(report.errors.length,0,JSON.stringify(report.errors));assert.equal(report.network.length,0);report.status='PASS';console.log(JSON.stringify(report.summary,null,2))
}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}}
main().catch(e=>{console.error(e);process.exitCode=1})
