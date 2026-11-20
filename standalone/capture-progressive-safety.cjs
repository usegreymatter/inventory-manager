// Lifecycle: living. Offline browser regression; scratch builds only, no tracked HTML writes.
// Trusted synthetic catalogs exercise scheduling, not CSV import acceptance or forecast accuracy.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.PROGRESSIVE_OUT||path.join(root,'.scratch/progressive-safety'))
fs.mkdirSync(out,{recursive:true})
const report={checks:[],errors:[],network:[],not_checked:['Live inventory','CSV import acceptance','Safari / real phone','Forecast maths (unchanged)']}
function check(name,value){report.checks.push({name,pass:!!value});console.log(JSON.stringify({check:name,pass:!!value}));assert.ok(value,name)}
const fixture={dataset:'Synthetic progressive safety',note:'Trusted synthetic scheduler regression only',months:['2026-05','2026-06','2026-07','2026-08','2026-09','2026-10'],as_of:'2026-10-31',items:Array.from({length:1001},(_,n)=>({sku:'QA-'+String(n).padStart(4,'0'),name:n===1000?'Late order':'Healthy '+n,unit:'units',supplier:'Test supplier',category:'Test category',monthly_sales:[10,10,10,10,10,10],on_hand:n===1000?0:10000,supplier_days:14,on_order:0,receipts:{},open_receipts:[]}))}
function build(name,data){const target=path.join(out,name+'.html'),args=['standalone/build.py','--template','option-gm-b','--out',target];if(data){const f=path.join(out,name+'.json');fs.writeFileSync(f,JSON.stringify(data));args.push('--data',f)}const r=spawnSync(process.env.PYTHON||'/usr/bin/python3',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return fs.readFileSync(target,'utf8')}
const source=build('large',fixture),small=build('small'),scheduler=fs.readFileSync(path.join(__dirname,'design/progressive-gm-b.js'),'utf8')
assert.ok(source.includes(scheduler))
// The control is the original synchronous startup: all three initial render
// sites and hash restoration execute in their original order, no scheduler.
const synchronous=source.replace(scheduler,'').replace('gmBInitialRestorePending=analysisIncomplete=data.items.length>1000','gmBInitialRestorePending=analysisIncomplete=false').replaceAll('data.items.length<=1000','true')
const hook=`
window.qa={queue:[],calls:[],clipboard:[],downloads:[],fail:false,
 state:()=>({count:currentRows.length,ready:evaluationSnapshot?.ready,incomplete:analysisIncomplete,job:!!analysisJob,status:wl.status,view:wlSnapshot(),hash:location.hash,restoreHash:gmBRestoreHash,selected:selectedSku,drawer:wl.drawer,product:productPage.overlay?.dataset.sku||null,filtered:filteredRows.map(r=>r.item.sku),rows:currentRows.map(r=>[r.item.sku,r.bucket,r.guidance.quantity]),sync:window.qaSyncFull||0}),
 advance:(n=1)=>{while(n--&&qa.queue.length)qa.queue.shift()()},
 restart:()=>{evaluationSnapshot=null;render()},
 direct:async()=>{const rows=currentRows.slice(0,1);wlOpen(rows[0]);openProductPage(rows[0]);selectItem(rows[0]);openWhy(rows[0]);weeklySummaryOpen();await wlCopy(rows);wlDraftEmail(rows);wlExport(rows);wlExcel(rows);wlDownload('unsafe','unsafe.csv','text/csv');const saved=localOrderSave([{sku:rows[0]?.item.sku,qty:1,unit:'units',ordered_on:'2026-11-01',expected_on:'2026-11-15',supplier:'Test supplier',note:''}]);return {saved,po:purchaseOrderText(rows,currentToday),text:wlOrderText(rows),csv:wlCsv(rows)}},
 storage:()=>JSON.stringify({...localStorage}),blocked:()=>!$('order-email-dialog')&&!$('weekly-summary')&&!productPage.overlay&&!wl.drawer,
 menu:()=>{$('tools').open=true;$('copy-po').disabled=false;$('copy-po').click();$('download-excel')?.click()},
 publish:()=>{wlCopy(currentRows.slice(0,1));wlExport(currentRows.slice(0,1))},staleWhy:()=>{evaluationSnapshot=null;openWhy(currentRows[0])},prepare:()=>{wl.status='all';buildList()},failNext:()=>{qa.fail=true;qa.advance()},recover:()=>{qa.fail=false;qa.restart()},
};
const qaRows=standaloneRows;standaloneRows=function(...args){qa.calls.push(args[0].items.length);if(qa.fail)throw Error('QA forced analysis failure');return qaRows(...args)};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>qa.clipboard.push(text)}});
const qaURL=URL.createObjectURL;URL.createObjectURL=function(blob){qa.downloads.push(blob.size);return qaURL.call(this,blob)};
`
function instrument(html,{queued=false,sync=false}={}){html=html.replace('function renderPass(){','function renderPass(){window.qaSyncFull=(window.qaSyncFull||0)+Number(!evaluationSnapshot.ready);');if(queued)html=html.replace('performance.now()-start<40','performance.now()-start<0');const extra=hook.replace('job:!!analysisJob',sync?'job:false':'job:!!analysisJob')+(queued?'\nanalysisYield=fn=>qa.queue.push(fn);':'');return html.replace('</script>',extra+'</script>')}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
async function open(html,name,hash='',queued=false,sync=false){const file=path.join(out,name+'.html');fs.writeFileSync(file,instrument(html,{queued,sync}));const ctx=await browser.newContext({offline:true,serviceWorkers:'block',viewport:{width:1440,height:900},reducedMotion:'reduce'});await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()});await ctx.addInitScript(()=>{const Real=Date;window.Date=class extends Real{constructor(...a){super(...(a.length?a:['2026-11-01T12:00:00Z']))}static now(){return new Real('2026-11-01T12:00:00Z').getTime()}}});const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto(pathToFileURL(file).href+hash);await p.waitForFunction(()=>window.qa);if(queued)await p.waitForFunction(()=>qa.queue.length>0);return {ctx,p}}
try{
 // Small sample never acquires a second deferred boot render or loses its URL.
 const s=await open(small,'small-probe');check('small initial catalog synchronously ready',await s.p.evaluate(()=>qa.state().ready&&qa.state().count===5));check('small default tab remains Order now',await s.p.evaluate(()=>qa.state().status==='order'));await s.ctx.close()
 const threshold=await open(build('threshold',{...fixture,items:fixture.items.slice(0,1000)}),'threshold-probe')
 check('exactly 1000 rows retain synchronous startup and All default',await threshold.p.evaluate(()=>qa.state().ready&&qa.state().count===1000&&!qa.state().job&&qa.state().status==='all'));await threshold.ctx.close()
 // A real first batch is published; all unsafe actions must be blocked without
 // waiting for subsequent batches. X selection intentionally remains usable.
 const orders={...fixture,items:fixture.items.map(i=>({...i,on_hand:0}))},orderSource=build('orders',orders)
 const a=await open(orderSource,'partial-controls','',true),p=a.p
 await p.evaluate(()=>qa.advance());check('first batch is incomplete and useful',await p.evaluate(()=>qa.state().count===1&&!qa.state().ready&&qa.state().incomplete))
 await p.locator('#work-scroll').focus();await p.keyboard.press('x');check('keyboard X selects partial row',await p.locator('.work-bulk').isVisible())
 const before=await p.evaluate(()=>qa.storage())
 await p.keyboard.press('Enter');check('keyboard Enter cannot open partial details',await p.locator('#product-page').count()===0)
 await p.locator('.work-row [data-column=hand]').first().click();await p.locator('.work-product').first().click();check('whole-row and product clicks cannot open partial details',await p.locator('#product-page').count()===0)
 for(const text of ['Copy order','Draft email','Export CSV','Mark as ordered'])await p.locator('.work-bulk').getByRole('button',{name:text,exact:true}).click()
 await p.locator('.work-group-copy').first().click()
 await p.locator('#work-view>summary').click();await p.getByRole('button',{name:'Weekly summary',exact:true}).click()
 check('real weekly-summary menu is guarded',await p.locator('#weekly-summary').count()===0)
 await p.evaluate(()=>qa.menu())
 const blocked=await p.evaluate(()=>qa.direct());check('direct order text/save boundaries fail closed',blocked.saved===false&&blocked.po===''&&blocked.text===''&&blocked.csv==='')
 check('partial UI/direct actions cannot copy/download/persist',await p.evaluate(before=>qa.clipboard.length===0&&qa.downloads.length===0&&qa.storage()===before&&qa.blocked(),before))
 check('partial actions cannot trigger a synchronous full evaluation',await p.evaluate(()=>qa.state().sync===0&&Math.max(...qa.calls)===1&&qa.state().count===1))
 await p.screenshot({path:path.join(out,'partial-guard.png')})
 await p.evaluate(()=>qa.failNext());check('forced batch failure retains incomplete state after job ends',await p.evaluate(()=>document.body.dataset.analysisState==='error'&&qa.state().incomplete&&!qa.state().job))
 await p.locator('#work-scroll').focus();await p.keyboard.press('Enter');await p.evaluate(()=>qa.direct())
 check('error cannot publish orders or invoke full sync evaluation',await p.evaluate(before=>qa.clipboard.length===0&&qa.downloads.length===0&&qa.storage()===before&&qa.state().sync===0&&qa.blocked(),before))
 await p.screenshot({path:path.join(out,'error-guard.png')})
 await p.evaluate(()=>{qa.recover();qa.advance(2000)})
 check('successful retry releases persistent guard',await p.evaluate(()=>qa.state().ready&&!qa.state().incomplete&&qa.state().count===1001))
 await p.evaluate(()=>qa.publish());check('copy/export work only after complete',await p.evaluate(()=>qa.clipboard.length===1&&qa.downloads.length===1))
 await p.evaluate(()=>qa.staleWhy());check('Why invalidation starts yielding job instead of full sync fallback',await p.evaluate(()=>qa.state().incomplete&&qa.state().job&&!qa.state().ready&&qa.state().sync===0));await a.ctx.close()
 const state={status:'healthy',q:'Healthy 4',group:'supplier',sort:'product',dir:-1,columns:['product','hand'],mode:'custom',suppliers:[],categories:[]}
 const hashes=['','#view=healthy','#status=ok','#q=Late','#state='+encodeURIComponent(JSON.stringify(state)),'#product=QA-1000','#sku=QA-1000&detail=1','#product=missing']
 for(let n=0;n<hashes.length;n++){
   const hash=hashes[n],r=await open(synchronous,'sync-'+n,hash,false,true),expected=await r.p.evaluate(()=>qa.state());await r.ctx.close()
   const q=await open(source,'queued-'+n,hash,true);check('hash '+n+' preserved while catalog incomplete',await q.p.evaluate(hash=>location.hash===hash,hash));await q.p.evaluate(()=>qa.advance(2000));const actual=await q.p.evaluate(()=>qa.state())
   for(const key of ['count','status','view','hash','selected','drawer','product','filtered','rows'])assert.deepEqual(actual[key],expected[key],'completed parity '+hash+' / '+key)
   check('completed full catalog/hash parity '+n,actual.ready&&!actual.incomplete&&actual.sync===0)
   if(!hash)check('late order determines default tab, not healthy first batch',actual.status==='order'&&actual.filtered.includes('QA-1000'))
   await q.ctx.close()
 }
 const changed=await open(source,'changed-hash','#view=healthy',true)
 await changed.p.evaluate(()=>{location.hash='#product=QA-1000'});await changed.p.waitForFunction(()=>qa.state().restoreHash==='#product=QA-1000')
 await changed.p.evaluate(()=>qa.advance(2000))
 check('hash changed during initial analysis restores only after full ready',await changed.p.evaluate(()=>qa.state().ready&&qa.state().product==='QA-1000'&&location.hash==='#product=QA-1000'&&qa.state().sync===0));await changed.ctx.close()
 // Exercise unmodified timer scheduling too, not only the deterministic queue.
 const natural=await open(source,'natural');await natural.p.waitForFunction(()=>document.body.dataset.analysisState==='complete',{timeout:120000});check('real timer scheduler completes without full sync fallback',await natural.p.evaluate(()=>qa.state().count===1001&&qa.state().sync===0&&qa.state().status==='order'));await natural.p.screenshot({path:path.join(out,'complete.png')});await natural.ctx.close()
 check('no browser page errors',report.errors.length===0);check('no network requests',report.network.length===0);report.status='PASS'
}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2))}
main().catch(e=>{console.error(e);process.exitCode=1})
