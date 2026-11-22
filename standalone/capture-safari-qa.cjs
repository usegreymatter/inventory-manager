// Lifecycle: living. Synthetic offline Safari regression + Chromium hit-test.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/pp'),results=[]
const check=(name,value,evidence)=>results.push({name,pass:!!value,evidence})
// Scratch-only eval bridge runs this fixed local test code, never imported/user input.
async function scoped(page,fn){return page.evaluate(code=>globalThis.safariEval('('+code+')()'),fn.toString())}
async function main(){
 fs.mkdirSync(out,{recursive:true})
 const probe=path.join(out,'v11-safari-probe.html');fs.writeFileSync(probe,fs.readFileSync(path.join(root,'standalone/inventory-manager-demo-1000.html'),'utf8').replace('</script>','globalThis.safariEval=code=>eval(code);\n</script>'))
 const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright')
 for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE||undefined}:{})})
  try{for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const key=engine+'-'+viewport.width,ctx=await browser.newContext({viewport,isMobile:viewport.width===390,hasTouch:viewport.width===390,offline:true,acceptDownloads:true})
   await ctx.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-17T09:00:00Z']))}static now(){return new D('2026-11-17T09:00:00Z').getTime()}}})
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort())
   await page.goto(pathToFileURL(probe).href);await page.waitForSelector('.work-row')
   if(viewport.width===1440){
    await page.locator('[data-view=order]').click();await page.locator('#work-scroll').evaluate(e=>e.scrollTop=900);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    const hit=await page.locator('.work-group-sticky .work-group-copy').evaluate(b=>{const r=b.getBoundingClientRect(),head=document.querySelector('.work-head').getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {clickable:b.contains(target),top:r.top,headBottom:head.bottom}})
    check(key+' sticky copy hit-test at 900px',hit.clickable&&hit.top>=hit.headBottom,hit)
    await page.screenshot({path:path.join(out,'v11-'+key+'-sticky.png')})
   }else{
    const targets=page.locator('.work-lead-note button');if(await targets.count()){const h=await targets.first().evaluate(e=>e.getBoundingClientRect().height);check(key+' Settings target >=40px',h>=40,h)}else check(key+' Settings target exists',false)
   }
   await scoped(page,()=>{wl.status='order';wl.group='status';buildList();wlOpen(filteredRows.find(r=>r.guidance.quantity>0&&!((r.item.on_order||0)>0)&&!Object.values(r.item.receipts||{}).some(v=>v>0)))})
   await page.waitForSelector('#product-page');const before=await page.locator('#product-page').getAttribute('data-sku')
   await page.getByRole('button',{name:'Mark as ordered',exact:true}).click()
   const nav=await page.locator('.product-page-nav').innerText();check(key+' ordered position remains valid',!nav.includes('0 /')&&/\d+ \/ \d+/.test(nav),nav)
   const ordered=await page.locator('#product-page').innerText();check(key+' ordered intent not confirmed receipt',ordered.includes('Ordered on this device')&&ordered.includes('(lead-time estimate)')&&!ordered.includes('Confirmed arrival')&&!ordered.includes('No order needed')&&!ordered.includes('Not needed')&&ordered.includes('Additional order'),ordered)
   if(await page.locator('#product-show-detail').getAttribute('aria-expanded')==='false')await page.locator('#product-show-detail').click()
   check(key+' detailed ledger excludes invented confirmation',!(await page.locator('#product-page').innerText()).includes('Confirmed arrival'))
   await page.screenshot({path:path.join(out,'v11-'+key+'-ordered.png')})
   const next=page.getByRole('button',{name:'Next product',exact:true});check(key+' next remains enabled',!await next.isDisabled());if(!await next.isDisabled()){await next.click();check(key+' next navigates',await page.locator('#product-page').getAttribute('data-sku')!==before);await page.getByRole('button',{name:'Previous product',exact:true}).click();check(key+' previous returns ordered item',await page.locator('#product-page').getAttribute('data-sku')===before)}
   await scoped(page,()=>localOrderSave(localOrders.records.map(r=>({...r,qty:1}))))
   const additional=await scoped(page,()=>rowMap.get(selectedSku).guidance.quantity),figures=await page.locator('.product-page-figures').innerText()
   check(key+' positive additional order keeps deadline',additional>0&&figures.includes('Additional order')&&figures.includes('Order by')&&!figures.includes('Not needed'),{additional,figures})
   const downloadPromise=page.waitForEvent('download')
   const exportResult=await scoped(page,()=>{const book=wlExcel(currentRows);return book.byteLength||book.length});check(key+' export workbook',exportResult>1000,exportResult)
   const download=await downloadPromise;check(key+' export download event',download.suggestedFilename()==='stock-runway-order.xlsx',download.suggestedFilename())
   await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.body.dataset.theme='dark'});await page.screenshot({path:path.join(out,'v11-'+key+'-dark.png')});check(key+' dark theme',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'))
   check(key+' no runtime errors',errors.length===0,errors);await ctx.close()
  }}finally{await browser.close()}
 }
 fs.writeFileSync(path.join(out,'v11-safari-regressions.json'),JSON.stringify(results,null,2)+'\n')
 console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass)},null,2));assert(results.every(r=>r.pass),'Safari regression checks failed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
