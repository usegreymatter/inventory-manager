const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const root=process.cwd(),out=path.join(root,'.scratch/v12-perf.html');
fs.writeFileSync(out,fs.readFileSync('standalone/inventory-manager-demo-1000.html','utf8').replace('</script>','\nwindow.v12Perf={rows:()=>currentRows.length,method:()=>settings.forecast_method,picked:()=>currentRows.filter(r=>r.item.forecast_method).length};\n</script>'));
(async()=>{const results=[];for(const method of ['current','recommended'])for(let run=0;run<3;run++){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
 const context=await browser.newContext({offline:true,viewport:{width:1440,height:900}});
 await context.addInitScript(m=>{localStorage.clear();const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){return key.startsWith('stock-runway.standalone.order-settings.')?JSON.stringify({forecast_method:m}):get.call(this,key)};const Real=Date;window.Date=class extends Real{constructor(...a){super(...(a.length?a:['2026-11-11T12:00:00Z']))}static now(){return new Real('2026-11-11T12:00:00Z').getTime()}}},method);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const start=performance.now();await page.goto(pathToFileURL(out).href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.v12Perf?.rows()===1000);const elapsed=performance.now()-start;
 const value=await page.evaluate(()=>({method:v12Perf.method(),picked:v12Perf.picked(),dom_ms:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd}));assert.equal(value.method,method);assert.deepEqual(errors,[]);if(method==='recommended')assert.equal(value.picked,980);results.push({method,run,cold_load_ms:+elapsed.toFixed(2),...value});await browser.close();
 }
 const median=xs=>xs.sort((a,b)=>a-b)[1];const report={definition:'Fresh Chromium process/context for each navigation; offline demo-1000 file, 1440px, frozen 2026-11-11; navigation start until DOMContentLoaded and 1000 evaluated rows. No task-owned capture batch was running; host-wide load was not controlled.',runs:results,median_ms:Object.fromEntries(['current','recommended'].map(m=>[m,median(results.filter(r=>r.method===m).map(r=>r.cold_load_ms))]))};fs.writeFileSync('.scratch/v12-perf.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));})().catch(e=>{console.error(e);process.exit(1)});
