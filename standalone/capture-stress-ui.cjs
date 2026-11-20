const {confirmMeaning}=require('./qa-input-meaning.cjs')
// Lifecycle: living. Local source-only UI stress; no installs/network/live records.
// TMPDIR=$PWD/.scratch PLAYWRIGHT_MODULE=/.../playwright/index.js CHROMIUM_EXECUTABLE=/.../qa-chrome node standalone/capture-stress-ui.cjs
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/pp'),report={scope:'Scratch-only current-source build; synthetic local data, no tracked HTML rebuild.',checks:[],errors:[],network:[],screenshots:[],limitations:['No axe-core installed under the permitted node_modules root; manual DOM/contrast checks, not a WCAG certification.','Chromium only; no real Safari, screen reader or mail app.','200% CSS zoom plus 720px reflow proxy; not browser-toolbar zoom.','Print emulation/PDF, not a physical printer.']}
const check=(name,pass,evidence)=>{report.checks.push({name,pass:!!pass,...(evidence===undefined?{}:{evidence})});assert.ok(pass,name+(evidence===undefined?'':': '+JSON.stringify(evidence)))}
const hostile='<img src=x onerror="globalThis.__hostileExecuted=true"> Commercial waterproofing membrane — أعمال العزل'
const months=Array.from({length:12},(_,n)=>new Date(Date.UTC(2025,10+n,1)).toISOString().slice(0,7))
const names=[hostile,'Aleksandra Wiśniewska-Kowalczyk industrial sealant cartridge — weatherproof, frost-resistant '+hostile,'Jo','مادة لاصقة مقاومة للماء — عبوة كبيرة','Ceramic tile trim / brushed aluminium, 12.5 mm × 2.5 m']
const rows=[['Item Code','Item Name','UoM','Qty On Hand','Lead Time','Supplier','Stock On Order',...months],...names.map((name,n)=>['UI-'+(n+1),name,'roll',5,14,'Fictional Supplies <svg onload="globalThis.__hostileExecuted=true">',0,...months.map(()=>100)])]
const csv='Synthetic stock export 2026\n'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n'
const upload={name:'synthetic-ui-stress.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}
const bridge=`\nwindow.stressUI={get state(){return {count:data.items.length,source:sourceName,today:currentToday,orders:localOrders.records,key:localOrders.key,viewKey:wl.key,blocked:localOrders.blocked,error:localOrders.error,quantities:currentRows.map(r=>[r.item.sku,r.guidance.quantity])}},get keys(){return [wl.key,localOrders.key,gmDatasetSettingsKey,supplierMinimums.key]},refresh(){render()}};\n`
async function keyTo(p,locator,key='Enter'){
 const target=locator.first();await target.waitFor({state:'visible'})
 for(let n=0;n<240;n++){if(await target.evaluate(e=>e===document.activeElement)){await p.keyboard.press(key);return}await p.keyboard.press('Tab')}
 throw Error('Keyboard could not reach '+await target.evaluate(e=>e.outerHTML.slice(0,200)))
}
async function trap(p,selector,label){
 const r=await p.locator(selector).evaluate(e=>({label:e.getAttribute('aria-labelledby')||e.getAttribute('aria-label'),native:e.tagName==='DIALOG',modal:e.matches(':modal')}))
 check(label+' named modal',!!r.label&&(r.native?r.modal:true),r)
 for(const key of ['Tab','Shift+Tab']){for(let n=0;n<16;n++){await p.keyboard.press(key);const focus=await p.locator(selector).evaluate(e=>({inside:e.contains(document.activeElement),tag:document.activeElement?.tagName,id:document.activeElement?.id}));check(label+' '+key+' containment '+n,focus.inside,focus)}}
}
async function noInjection(p,label){check(label+' hostile data remains text',await p.evaluate(()=>!globalThis.__hostileExecuted&&!document.querySelector('img[src="x"],svg[onload], [onerror]')))}
async function geometry(p,label,selector='#smart-import'){
 const g=await p.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:e.scrollWidth,client:e.clientWidth,page:document.documentElement.scrollWidth}})
 check(label+' no page/dialog overflow',g.x>=0&&g.y>=0&&g.right<=g.width+1&&g.bottom<=g.height+1&&g.scroll<=g.client+1&&g.page<=g.width,g)
}
async function tail(p,label){
 const g=await p.locator('#smart-import').evaluate(d=>{for(const e of d.querySelectorAll('details'))e.open=true;const b=d.querySelector('.smart-import-content');b.scrollTop=b.scrollHeight;const last=b.lastElementChild,r=last.getBoundingClientRect(),f=d.querySelector('.smart-import-actions').getBoundingClientRect(),br=b.getBoundingClientRect();return {lastBottom:r.bottom,footerTop:f.top,gap:f.top-r.bottom,remaining:b.scrollHeight-b.clientHeight-b.scrollTop,bodyBottom:br.bottom,padding:getComputedStyle(b).paddingBottom}})
 check(label+' last report row clears footer',g.remaining<=1&&g.gap>=24&&g.lastBottom<=g.bodyBottom,g)
 const hits=await p.locator('#smart-import .smart-import-actions button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}))
 check(label+' footer hit targets',hits.length===3&&hits.every(e=>e.height>=44&&e.hit),hits)
}
async function openReview(p){await p.locator('#csv-file').setInputFiles(upload);await p.locator('#smart-import').waitFor({state:'visible'});await confirmMeaning(p)}
async function keyboardOpenReview(p){
 await keyTo(p,p.locator('#tools>summary'));await keyTo(p,p.locator('#file-panel>summary'))
 const chooser=p.waitForEvent('filechooser');await keyTo(p,p.locator('#csv-file'));await (await chooser).setFiles(upload);await p.locator('#smart-import').waitFor({state:'visible'});await confirmMeaning(p)
 check('keyboard file chooser opened import review',true)
}
async function screenshot(p,name){const file=path.join(out,name);await p.screenshot({path:file});report.screenshots.push(file)}
async function newPage(browser,probe,mode='normal',viewport={width:1440,height:900}){
 const ctx=await browser.newContext({viewport,timezoneId:'UTC',reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'})
 await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()})
 if(mode!=='normal')await ctx.addInitScript(mode=>{
  if(mode==='disabled'){Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}});return}
  const proto=Storage.prototype,read=proto.getItem
  if(mode==='full')proto.setItem=function(){throw new DOMException('full','QuotaExceededError')}
  if(mode==='corrupt')proto.getItem=function(key){return key.startsWith('stock-runway')?'{not-json':read.call(this,key)}
  if(mode==='shape')proto.getItem=function(key){return key.startsWith('stock-runway.worklist')?JSON.stringify({customOrder:17,views:[null]}):read.call(this,key)}
 },mode)
 const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(mode+': '+e.message));await p.clock.setFixedTime(new Date('2026-11-17T09:00:00Z'));await p.goto(pathToFileURL(probe).href);await p.waitForFunction(()=>window.stressUI)
 return {ctx,p}
}
async function main(){
 fs.mkdirSync(out,{recursive:true})
 const built=path.join(out,'stress-ui-source.html'),build=spawnSync('/usr/bin/python3',['standalone/build.py','--out',built],{cwd:root,encoding:'utf8'})
 assert.equal(build.status,0,build.stderr);report.build=build.stdout.trim()
 report.sourceBuildSha256=createHash('sha256').update(fs.readFileSync(built)).digest('hex')
 const probe=path.join(out,'stress-ui-probe.html');fs.writeFileSync(probe,fs.readFileSync(built,'utf8').replace('</script>',bridge+'</script>'))
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
 try{
  for(const width of [1440,390,320]){
   const {ctx,p}=await newPage(browser,probe,'normal',{width,height:width===1440?900:844});await openReview(p)
   check(width+' explicit edit label',await p.locator('#smart-import-change').textContent()==='Edit mappings')
   check(width+' high confidence reasons quiet but available',await p.locator('.smart-confidence.high').evaluateAll(es=>es.length>0&&es.every(e=>e.title&&!e.querySelector('small')&&e.getAttribute('aria-label'))))
   check(width+' low confidence reasons remain visible',await p.locator('.smart-confidence.low small').evaluateAll(es=>es.length>0&&es.every(e=>e.checkVisibility()&&e.textContent)))
   if(width<600)check(width+' selected mapping readable outside narrow native select',await p.locator('.smart-mapping-value').evaluateAll(es=>es.length>0&&es.every(e=>e.checkVisibility()&&e.textContent===e.previousElementSibling.title)))
   await geometry(p,width+' review');if(width!==320)await screenshot(p,'smart-import-polished-'+width+'.png')
   await tail(p,width+' expanded review');await noInjection(p,width+' import preview');await trap(p,'#smart-import',width+' import')
   await keyTo(p,p.locator('#smart-import-change'));check(width+' edit focuses mapping',await p.evaluate(()=>document.activeElement.matches('#smart-import select')))
   const select=p.locator('#smart-import select[data-index="3"]');await keyTo(p,select,'Home');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter')
   check(width+' redraw preserves mapping focus',await select.evaluate(e=>e===document.activeElement))
   await p.keyboard.press('Escape');await p.locator('#smart-import').waitFor({state:'hidden'});check(width+' Escape preserves previous data',(await p.evaluate(()=>stressUI.state)).source==='sample');await ctx.close()
  }
  const {ctx,p}=await newPage(browser,probe);await keyboardOpenReview(p)
  await p.evaluate(()=>document.body.style.zoom='2');report.cssZoomObservation=await p.locator('#smart-import').evaluate(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,note:'CSS body zoom doubles dvh dimensions; not browser zoom. Reflow proxy below is the browser-layout acceptance check.'}});await p.evaluate(()=>document.body.style.zoom='');await p.setViewportSize({width:720,height:450});await geometry(p,'200% desktop reflow proxy');await tail(p,'200% desktop reflow proxy');await p.setViewportSize({width:1440,height:900})
  const contrast=await p.evaluate(()=>{const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]},ratio=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05),bg=getComputedStyle(document.querySelector('#smart-import')).backgroundColor;return ['.smart-import-note','.smart-confidence','#smart-import-use'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return {selector:s,ratio:ratio(lum(c.color),lum(s==='#smart-import-use'?c.backgroundColor:bg))}})})
  check('manual text contrast >=4.5:1',contrast.every(c=>c.ratio>=4.5),contrast)
  await keyTo(p,p.locator('#smart-import-use'));await p.waitForFunction(()=>document.body.dataset.analysisState==='complete'&&stressUI.state.source==='synthetic-ui-stress.csv');check('keyboard import accepted five products',(await p.evaluate(()=>stressUI.state)).count===5)
  await noInjection(p,'worklist');await keyTo(p,p.locator('.work-product').first());await p.locator('#product-page').waitFor({state:'visible'});check('product displays literal hostile name',(await p.locator('.product-page-heading h1').textContent()).includes('<img'));await noInjection(p,'product');await keyTo(p,p.locator('#product-show-detail'));check('keyboard Show detail reveals product settings',await p.getByRole('button',{name:'Change settings for this product',exact:true}).isVisible());await trap(p,'#product-page','product page')
  await keyTo(p,p.getByRole('button',{name:'Change settings for this product',exact:true}));await trap(p,'#settings-sheet','nested product settings');check('settings inputs have accessible labels',await p.locator('#settings-sheet input,#settings-sheet select').evaluateAll(es=>es.filter(e=>e.checkVisibility()).every(e=>e.labels?.length||e.getAttribute('aria-label'))));await p.keyboard.press('Escape');await p.locator('#settings-sheet').waitFor({state:'hidden'});check('settings Escape returns focus to product settings action',await p.evaluate(()=>document.activeElement.textContent==='Change settings for this product'))
  await keyTo(p,p.getByRole('button',{name:'Draft email',exact:true}));await p.locator('#order-email-dialog').waitFor({state:'visible'});check('email draft uses literal hostile name',(await p.locator('#order-email-body').inputValue()).includes(hostile));await noInjection(p,'email');await trap(p,'#order-email-dialog','email')
  check('email mark gated before copy',await p.getByRole('button',{name:'Mark these as ordered',exact:true}).isDisabled());await keyTo(p,p.getByRole('button',{name:'Copy',exact:true}));await keyTo(p,p.getByRole('button',{name:'Mark these as ordered',exact:true}));check('keyboard marks one device order',(await p.evaluate(()=>stressUI.state)).orders.length===1)
  const [dl]=await Promise.all([p.waitForEvent('download'),keyTo(p,p.locator('#order-email-dialog').getByRole('button',{name:'Download Excel',exact:true}))]);await dl.saveAs(path.join(out,'stress-ui-email.xlsx'));check('keyboard Excel download real XLSX',fs.readFileSync(path.join(out,'stress-ui-email.xlsx')).subarray(0,2).toString()==='PK')
  await p.keyboard.press('Escape');await p.locator('#order-email-dialog').waitFor({state:'detached'});check('email Escape returns to enabled product control',await p.evaluate(()=>document.activeElement.closest('#product-page')&&!document.activeElement.disabled&&document.activeElement.matches('.product-draft-email,#product-page-close')));await p.keyboard.press('Escape');await p.locator('#product-page').waitFor({state:'detached'})
  await keyTo(p,p.locator('#work-view>summary'));await keyTo(p,p.getByRole('button',{name:'Weekly summary',exact:true}));await trap(p,'#weekly-summary','weekly summary');check('summary has literal hostile text',(await p.locator('#weekly-summary').textContent()).includes('<img'));await noInjection(p,'summary')
  await p.emulateMedia({media:'print'});const print=await p.evaluate(()=>({body:[...document.body.children].filter(e=>e.tagName!=='SCRIPT'&&getComputedStyle(e).display!=='none').map(e=>e.id),actions:getComputedStyle(document.querySelector('.weekly-summary-actions')).display,text:document.querySelector('.weekly-summary-report').textContent}));check('print only summary with controls hidden',print.body.length===1&&print.body[0]==='weekly-summary'&&print.actions==='none',print.body);check('print literal hostile name',print.text.includes('<img'));await noInjection(p,'print');await p.pdf({path:path.join(out,'stress-ui-summary.pdf'),format:'A4'});check('real print PDF produced',fs.statSync(path.join(out,'stress-ui-summary.pdf')).size>1000);await p.emulateMedia({media:'screen'});await p.keyboard.press('Escape')
  for(const [time,day] of [['2026-11-30T23:59:59Z','2026-11-30'],['2026-12-01T00:00:01Z','2026-12-01'],['2026-12-31T23:59:59Z','2026-12-31'],['2027-01-01T00:00:01Z','2027-01-01'],['2028-02-28T23:59:59Z','2028-02-28'],['2028-02-29T00:00:01Z','2028-02-29'],['2028-03-01T00:00:01Z','2028-03-01']]){await p.clock.setFixedTime(new Date(time));await p.evaluate(()=>window.dispatchEvent(new Event('focus')));check('clock boundary '+day,(await p.evaluate(()=>stressUI.state)).today===day)}
  check('reduced motion preference active',await p.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));check('reduced motion no running animations',await p.evaluate(()=>document.getAnimations().every(a=>a.playState!=='running')));await ctx.close()
  for(const mode of ['disabled','full','corrupt','shape']){
   const {ctx,p}=await newPage(browser,probe,mode);check(mode+' startup renders worklist',await p.locator('.work-product').count()>0);await openReview(p);await keyTo(p,p.locator('#smart-import-use'));await p.waitForFunction(()=>document.body.dataset.analysisState==='complete'&&stressUI.state.source==='synthetic-ui-stress.csv');check(mode+' import survives storage fault',(await p.evaluate(()=>stressUI.state)).count===5)
   await keyTo(p,p.locator('.work-product').first());await keyTo(p,p.getByRole('button',{name:'Draft email',exact:true}));await keyTo(p,p.getByRole('button',{name:'Copy',exact:true}));await keyTo(p,p.getByRole('button',{name:'Mark these as ordered',exact:true}));const s=await p.evaluate(()=>stressUI.state);check(mode+' no false persisted order',mode==='shape'?s.orders.length===1:s.orders.length===0,s);if(mode!=='shape')check(mode+' storage error announced inside active email dialog',(await p.locator('#order-email-dialog [role=status]').textContent())===s.error&&!!s.error);await ctx.close()
  }
  for(const [day,expected] of [['2026-12-31','2027-01-14'],['2028-02-15','2028-02-29'],['2028-02-29','2028-03-14'],['2027-02-15','2027-03-01']]){
   const {ctx,p}=await newPage(browser,probe);await p.clock.setFixedTime(new Date(day+'T09:00:00Z'));const d=new Date(day+'T09:00:00Z'),periods=Array.from({length:12},(_,n)=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-12+n,1)).toISOString().slice(0,7)),r=[['Item Code','Item Name','UoM','Qty On Hand','Lead Time','Supplier',...periods],['CALENDAR','Synthetic calendar fixture','roll',5,14,'Fictional Supply',...periods.map(()=>100)]]
   await p.locator('#csv-file').setInputFiles({name:'calendar.csv',mimeType:'text/csv',buffer:Buffer.from('Synthetic calendar export\n'+r.map(x=>x.join(',')).join('\n'))});await p.locator('#smart-import').waitFor({state:'visible'});await confirmMeaning(p);await keyTo(p,p.locator('#smart-import-use'));await p.waitForFunction(()=>document.body.dataset.analysisState==='complete'&&stressUI.state.source==='calendar.csv');await keyTo(p,p.locator('.work-product').first());await keyTo(p,p.getByRole('button',{name:'Draft email',exact:true}));await keyTo(p,p.getByRole('button',{name:'Copy',exact:true}));await keyTo(p,p.getByRole('button',{name:'Mark these as ordered',exact:true}));const orders=(await p.evaluate(()=>stressUI.state)).orders;check('calendar order '+day+' + 14 days = '+expected,orders.length===1&&orders[0].ordered_on===day&&orders[0].expected_on===expected,orders);await ctx.close()
  }
  check('no page errors',report.errors.length===0,report.errors);check('no network requests',report.network.length===0,report.network);report.status='PASS'
 }catch(error){report.status='FAIL';report.failure=error.stack;throw error}finally{fs.writeFileSync(path.join(out,'stress-ui-report.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots,report:path.join(out,'stress-ui-report.json')},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
