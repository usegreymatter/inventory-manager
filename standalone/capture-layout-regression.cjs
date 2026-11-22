// Lifecycle: living. QA-P1-001 / QA-P2-002: offline layout regression.
// PLAYWRIGHT_MODULE=... CHROMIUM_EXECUTABLE=... QA_FIXTURE_DIR=... node standalone/capture-layout-regression.cjs
// Fixture directory must contain the existing synthetic all.csv, cost.csv and profit.csv.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
const playwright=require(process.env.PLAYWRIGHT_MODULE),root=path.resolve(__dirname,'..');
const fixtures=process.env.QA_FIXTURE_DIR;
if(!fixtures)throw Error('QA_FIXTURE_DIR must name the existing synthetic browser-QA fixture folder');
for(const fixture of ['all','cost','profit'])if(!fs.existsSync(path.join(fixtures,fixture+'.csv')))throw Error('Missing synthetic fixture '+fixture);
const out=path.join(root,'.scratch/layout-regression',process.env.QA_RUN||'latest');fs.mkdirSync(out,{recursive:true});
const built=path.join(out,'sample.html');
execFileSync(process.env.PYTHON||'python3',['standalone/build.py','--out',built],{cwd:root});
const report={checks:[],scenarios:[],errors:[],network:[],engines:{},skipped:[],max_process_rss_kb:0};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(scenario,name,pass,actual)=>report.checks.push({scenario,name,pass:!!pass,actual});
function memory(){
 const rows=execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));
 const owned=new Set([process.pid]);let added=true;while(added){added=false;for(const [pid,ppid]of rows)if(owned.has(ppid)&&!owned.has(pid)){owned.add(pid);added=true}}
 const max=Math.max(0,...rows.filter(([pid])=>owned.has(pid)).map(r=>r[2]));report.max_process_rss_kb=Math.max(report.max_process_rss_kb,max);
 if(max>=2097152)throw Error('Owned process exceeded 2 GB RSS: '+max);
}
async function importCsv(page,fixture){
 await page.locator('#csv-file').setInputFiles(path.join(fixtures,fixture+'.csv'));
 await page.locator('#meaning-units').check();
 if(await page.locator('#meaning-show-anyway').count())await page.locator('#meaning-show-anyway').check();
 await page.locator('#smart-import-use').click();await page.locator('#import-check[open]').waitFor();
 if(await page.locator('#import-expiry-ack').count())await page.locator('#import-expiry-ack').check();
 await page.locator('#import-check-confirm').click();await page.locator('[data-view=all]').click();
}
async function costColumns(page){
 await page.locator('#work-view>summary').click();await page.locator('[data-density=custom]').click();
 await page.locator('#column-customize>summary').click();
 for(const key of ['money_tied_up','incoming_value','margin_unit','margin_pct','expiry_value_at_risk'])await page.locator('#column-customize [data-key='+key+'] input').check();
 await page.locator('#work-view>summary').click();
}
async function profit(page,enabled){
 if(!await page.locator('#tools').evaluate(e=>e.open))await page.locator('#tools>summary').click();
 await page.locator('#open-settings').click();const advanced=page.locator('#settings-sheet summary').filter({hasText:'Advanced'});
 if(!await advanced.evaluate(e=>e.parentElement.open))await advanced.click();
 await page.locator('#setting-profit_suggestion').setChecked(enabled);await page.locator('#settings-sheet>header button').click();
}
async function geometry(page){return page.locator('#work-scroll').evaluate(e=>({clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,rect:e.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth-innerWidth,mounted:document.querySelectorAll('.work-row').length}));}
(async()=>{
 for(const engine of (process.env.QA_ENGINES||'chromium,webkit').split(',')){
  const type=playwright[engine];let browser;
  if(engine==='webkit'&&!fs.existsSync(type.executablePath())){report.skipped.push('WebKit binary not installed');continue}
  try{
   browser=await type.launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--disable-background-networking','--disable-component-update','--js-flags=--max-old-space-size=1024']}:{})});
   report.engines[engine]=browser.version();
   for(const width of [390,1440])for(const theme of ['light','dark'])for(const fixture of ['all','cost','profit']){
    const scenario=[engine,width,theme,fixture].join('-'),context=await browser.newContext({offline:true,viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'});
    await context.route(/^https?:/i,r=>{report.network.push(r.request().url());return r.abort()});
    const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    // Optional attribution only: retain browser warnings rather than filtering them.
    if(process.env.QA_TRACE_OBSERVERS)await page.addInitScript(()=>{
     const Native=ResizeObserver;window.qaObservers=[];window.ResizeObserver=class extends Native{constructor(callback){const stack=new Error().stack;super((entries,observer)=>{window.qaObservers.push({stack,entries:entries.map(e=>({id:e.target.id,cls:e.target.className,w:e.contentRect.width,h:e.contentRect.height}))});if(window.qaObservers.length>40)window.qaObservers.shift();callback(entries,observer)})}};
    });
    try{
     await page.clock.setFixedTime(new Date('2026-11-01T12:00:00+03:00'));
     await page.goto(pathToFileURL(built).href);await importCsv(page,fixture);
     if(fixture==='cost')await costColumns(page);
     if(fixture==='profit'){await profit(page,true);await page.waitForTimeout(150);await profit(page,false);await profit(page,true)}
     await page.waitForTimeout(800);let geom=await geometry(page);
     check(scenario,'worklist retains at least two phone rows of height',geom.clientHeight>=208,geom);
     check(scenario,'no horizontal page overflow',geom.overflow<=1,geom.overflow);
     if(fixture==='all')check(scenario,'clearance remains visible',await page.locator('#shelf-clearance').isVisible());
     if(fixture==='all'&&width===390){
      // Wheel the shell's padding, not a nested clearance card/table. This must
      // expose the products without scripting a scroll position or a forced click.
      await page.mouse.move(width-4,650);await page.mouse.wheel(0,1000);await page.waitForTimeout(200);
      const shell=await page.locator('#worklist').evaluate(e=>({top:e.scrollTop,table:document.querySelector('#work-scroll').getBoundingClientRect().toJSON()}));
      check(scenario,'native outer scroll exposes worklist',shell.top>0&&shell.table.top<page.viewportSize().height-100,shell);
     }
     if(geom.clientHeight>=208){
      // Native pointer navigation must reach each product, including via outer scrolling.
      for(const sku of ['CAP','LOT','PLAIN']){
       await page.locator('.work-row[data-sku='+sku+'] .work-product').evaluate(e=>e.scrollIntoView({block:'center'}));
       // Let the existing scroll-driven virtualizer settle before the pointer tap.
       await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
       await page.locator('.work-row[data-sku='+sku+'] .work-product').click();
       check(scenario,'pointer opens '+sku,await page.locator('#product-page').getAttribute('data-sku')===sku);
       await page.locator('#product-page-close').click();await page.locator('#product-page').waitFor({state:'detached'});
      }
      await page.locator('#work-scroll').scrollIntoViewIfNeeded();
      await page.locator('#work-scroll').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
      check(scenario,'keyboard opens product',await page.locator('#product-page').count()===1);
      await page.locator('#product-page-close').click();await page.locator('#product-page').waitFor({state:'detached'});
      // Width and height changes must preserve virtual row sizing without observer feedback.
      await page.setViewportSize({width:width===390?1440:390,height:700});await page.waitForTimeout(100);
      await page.setViewportSize({width,height:900});await page.waitForTimeout(300);
      geom=await geometry(page);check(scenario,'usable after resize',geom.clientHeight>=208,geom);
      check(scenario,'virtual rows stay bounded',geom.mounted<=20,geom.mounted);
      await page.locator('#work-scroll').scrollIntoViewIfNeeded();
     }
     await page.screenshot({path:path.join(out,scenario+'.png')});
     if(process.env.QA_TRACE_OBSERVERS)fs.writeFileSync(path.join(out,scenario+'-observers.json'),JSON.stringify(await page.evaluate(()=>window.qaObservers),null,2));
     await page.waitForTimeout(200);check(scenario,'no page/console errors',errors.length===0,errors);report.errors.push(...errors.map(message=>({scenario,message})));
     report.scenarios.push({scenario,geometry:geom});
    }catch(e){check(scenario,'scenario completes',false,String(e))}finally{memory();await context.close();save();console.log(scenario+' failures='+report.checks.filter(c=>c.scenario===scenario&&!c.pass).length)}
   }
  }finally{await browser?.close();save()}
 }
 check('overall','no network requests',report.network.length===0,report.network);
 check('overall','sampled processes below 2 GB RSS',report.max_process_rss_kb<2097152,report.max_process_rss_kb);
 report.failed=report.checks.filter(c=>!c.pass).length;save();console.log(JSON.stringify({checks:report.checks.length,failed:report.failed,scenarios:report.scenarios.length,report:path.join(out,'report.json')}));
 if(report.failed)process.exitCode=1;
})().catch(e=>{console.error(e);save();process.exitCode=1});
