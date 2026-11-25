// Offline, synthetic-only acceptance. Uses an already installed Playwright, never downloads.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const pw=require(process.env.PLAYWRIGHT_MODULE),root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/prelaunch'),key='inventory-manager.device-data.v1'
fs.mkdirSync(out,{recursive:true})
const pageHash=()=>require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'standalone/inventory-manager.html'))).digest('hex'),page_sha256=pageHash()
const inputs=process.env.STRESS_INPUTS
const csv='sku,name,unit,on_hand,on_order,supplier_days,2020-08,2020-09,2020-10\nSYNTHETIC-ONLY,Synthetic pilot product,pieces,25,0,7,30,30,30\n'
async function ready(page){await page.locator('#first-run').waitFor();await page.waitForTimeout(100)}
async function accept(page){
 if(await page.locator('#smart-import').isVisible()){
  await page.locator('#meaning-units').check()
  if(await page.locator('#meaning-show-anyway').isVisible())await page.locator('#meaning-show-anyway').check()
  await page.locator('#smart-import-use').click()
 }
 await page.waitForFunction(()=>document.querySelector('#import-check').open||!document.querySelector('#remember-device').closest('label').hidden)
 if(await page.locator('#import-check').isVisible())await page.locator('#import-check-confirm').click()
 await page.locator('#smart-import').waitFor({state:'hidden'});await page.locator('#remember-device').waitFor()
}
async function ownFile(page){await page.locator('#csv-file').setInputFiles({name:'synthetic-pilot.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>document.querySelector('#smart-import').open||!document.querySelector('#remember-device').closest('label').hidden);await accept(page)}
async function capture(page,file){await page.screenshot({path:path.join(out,file)});return path.join(out,file)}
;(async()=>{
 const results=[]
 for(const browserName of ['chromium','webkit']){
  const browser=await pw[browserName].launch(browserName==='chromium'?{headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{headless:true})
  try{for(const width of [1440,390])for(const theme of ['light','dark']){
   const ctx=await browser.newContext({viewport:{width,height:width===390?844:1000},isMobile:width===390,hasTouch:width===390,colorScheme:theme})
   const page=await ctx.newPage(),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
   await ctx.route('**/*',route=>{if(!route.request().url().startsWith('file:')){network.push(route.request().url());return route.abort()}return route.continue()})
   const url=pathToFileURL(path.join(root,'standalone/inventory-manager.html')).href
   await page.goto(url);await ready(page)
   await page.evaluate(()=>localStorage.clear());await page.reload();await ready(page)
   const prefix=`${browserName}-${width}-${theme}`,screenshots=[]
   assert.equal(await page.locator('#remember-device').isVisible(),false)
   screenshots.push(await capture(page,prefix+'-sample.png'))
   const summaryShot=path.join(out,prefix+'-summary.png');await page.locator('#work-summary').screenshot({path:summaryShot});screenshots.push(summaryShot)
   assert.match(await page.locator('#work-urgency-note').innerText(),/Order now uses the “Order now within N days” setting/)
   assert.doesNotMatch(await page.locator('#work-summary').innerText(),/Order lines/)
   assert.ok(await page.locator('#work-scroll').evaluate(el=>el.clientHeight)>150)
   if(browserName==='chromium'&&width===1440){
    // Crop at the final synthetic product row, not the viewport's empty table area.
    const bottom=await page.locator('.work-row').evaluateAll(rows=>Math.max(...rows.map(row=>row.getBoundingClientRect().bottom)))
    const file=path.join(root,`docs/img/worklist-${theme}.png`)
    await page.screenshot({path:file,clip:{x:0,y:0,width,height:Math.ceil(bottom+24)}})
    assert.ok(fs.statSync(file).size<120*1024,'README screenshot size budget');screenshots.push(file)
   }
   await ownFile(page);assert.equal(await page.locator('#remember-device').isChecked(),false)
   assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null)
   assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('SYNTHETIC-ONLY')||value.includes('Synthetic pilot product'))),false)
   await page.reload();await ready(page);assert.match(await page.locator('.first-run-actions').innerText(),/Sample data/)
   await ownFile(page);await page.locator('#remember-device').check()
   const savedSnapshot=await page.evaluate(k=>localStorage.getItem(k),key);assert.match(savedSnapshot,/SYNTHETIC-ONLY/)
   // A showroom/demo page must never reveal the remembered own-file snapshot.
   await page.goto(pathToFileURL(path.join(root,'standalone/inventory-manager-demo-1000.html')).href);await ready(page)
   assert.match(await page.locator('#snapshot').innerText(),/Synthetic demo data/)
   assert.equal((await page.locator('body').innerText()).includes('SYNTHETIC-ONLY'),false)
   assert.equal(await page.locator('#remember-device').isVisible(),false)
   assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),savedSnapshot)
   screenshots.push(await capture(page,prefix+'-demo-isolated.png'))
   await page.goto(url);await ready(page)
   assert.match(await page.locator('.first-run-actions').innerText(),/Restored from this device · imported/)
   assert.match(await page.locator('#sales-age-warning').innerText(),/Sales data is .* days old/)
   assert.equal(await page.locator('#remember-device').isChecked(),true)
   assert.equal(await page.locator('#forget-device-data').isVisible(),true)
   screenshots.push(await capture(page,prefix+'-restored.png'))
   await page.locator('#forget-device-data').click();assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null)
   await page.reload();await ready(page);assert.match(await page.locator('.first-run-actions').innerText(),/Sample data/)
   if(width===1440&&theme==='light'){
    await ownFile(page)
    await page.evaluate(k=>{window.realStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===k)throw Error('Synthetic quota denial');return window.realStorageSet.call(this,name,value)}},key)
    await page.locator('#remember-device').click();assert.equal(await page.locator('#remember-device').isChecked(),false)
    assert.match(await page.locator('#device-data-notice').innerText(),/Could not save/);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null)
    await page.reload();await ready(page)
    const big={bundle_version:'1.0',decision_date:'2026-11-01',as_of:'2020-10-31',months:['2020-08','2020-09','2020-10'],note:'x'.repeat(2*1024*1024),items:[{sku:'BIG-SYNTHETIC',name:'Synthetic size-limit test',unit:'pieces',on_hand:25,on_order:0,supplier_days:7,monthly_sales:[30,30,30]}]}
    await page.locator('#csv-file').setInputFiles({name:'synthetic-too-big.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(big))});await accept(page)
    await page.locator('#remember-device').click();assert.equal(await page.locator('#remember-device').isChecked(),false)
    assert.match(await page.locator('#device-data-notice').innerText(),/too big/);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null)
    await page.reload();await ready(page)
   }
   if(width===390&&inputs){
    for(const [file,name]of [['x02b-hidden-old-sheet-first.xlsx','hidden'],['sheets/x02d-two-visible-same-month-copy.xlsx','combine']]){
     await page.locator('#csv-file').setInputFiles(path.join(inputs,file));await page.locator('#smart-import').waitFor()
     const target=name==='hidden'?page.locator('.smart-import-hidden-sheet'):page.locator('#smart-import-combine')
     await target.scrollIntoViewIfNeeded()
     if(name==='hidden'){
      const text=await target.innerText();assert.match(text,/Ignored hidden sheet:/)
      assert.equal((await page.locator('#smart-import').innerText()).split(text).length-1,1,'hidden warning rendered once')
     }
     else for(const id of ['#smart-import-combine','#meaning-units']){
      const g=await page.locator(id).evaluate(el=>{const a=el.getBoundingClientRect(),b=el.nextElementSibling.getBoundingClientRect();return {dy:Math.abs(a.top-b.top),right:b.right,width:innerWidth}})
      assert.ok(g.dy<=3&&g.right<=g.width,JSON.stringify(g))
     }
     await target.scrollIntoViewIfNeeded();screenshots.push(await capture(page,prefix+'-'+name+'.png'))
     const preview=page.locator('#smart-import-preview');await preview.scrollIntoViewIfNeeded()
     const geometry=await preview.evaluate(el=>{const r=el.getBoundingClientRect(),a=document.querySelector('.smart-import-actions').getBoundingClientRect(),b=document.querySelector('.smart-import-content');return {bottom:r.bottom,actionTop:a.top,padding:parseFloat(getComputedStyle(b).paddingBottom)}})
     assert.ok(geometry.bottom<=geometry.actionTop&&geometry.padding>=100,JSON.stringify(geometry))
     screenshots.push(await capture(page,prefix+'-'+name+'-preview.png'));await page.locator('#smart-import-cancel').click()
    }
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   assert.deepEqual(errors,[]);assert.deepEqual(network,[])
   assert.equal(pageHash(),page_sha256);results.push({browserName,width,theme,page_sha256,errors,network,screenshots,pass:true});await ctx.close()
  }}finally{await browser.close()}
 }
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
})().catch(e=>{console.error(e);process.exitCode=1})
