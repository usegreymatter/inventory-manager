// F1: real offline import -> always-visible warnings; no controls reopened.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE)
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/warning-visibility');fs.mkdirSync(out,{recursive:true})
const fixture=path.join(root,'tests/fixtures/review-import/v_reserved_one_sheet.xlsx')
const report={checks:[],errors:[],network:[]},malicious='<img src=x onerror="window.warningXss=1"> & <script>window.warningXss=2</script>'
const html=fs.readFileSync(process.env.STOCK_RUNWAY_HTML||path.join(root,'standalone/stock-runway.html'),'utf8'),probe=path.join(out,'probe.html')
// Test-only seam for adversarial warning strings and warning-free source controls.
fs.writeFileSync(probe,html.replace('</script>',`\nwindow.warningQA={get:()=>data,show:parsed=>{data=parsed;render();stockImportStatus({parsed,smart:false},{name:'synthetic.json'})}};\n</script>`))
function check(label,value){report.checks.push({label,pass:!!value});assert.ok(value,label)}
const csv=(name,rows)=>({name,mimeType:'text/csv',buffer:Buffer.from(rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n'))})
const header=['sku','name','unit','on_hand','supplier_days','Warehouse','on_order','2026-07','2026-08','2026-09','supplier','unit_cost']
const row=(sku,name='Synthetic item',location='East',supplier='One',cost='1')=>[sku,name,'pcs','10','14',location,'0','30','30','30',supplier,cost]
const cases=[
 {name:'reserved workbook',file:fixture,reserved:true,warning:/no reserved column|Reserved stock missing/i},
 {name:'duplicate rows',file:csv('duplicate-warning.csv',[header,row('DUP','Synthetic item',''),row('DUP','Synthetic item','')]),warning:/repeated|duplicate/i},
 {name:'metadata conflict',file:csv('metadata-warning.csv',[header,row('META'),row('META','Other name','West','Two','2')]),warning:/Metadata differences/i},
]
;(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:1000},offline:true,reducedMotion:'reduce'});await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()});const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(pathToFileURL(probe).href);await page.waitForFunction(()=>window.warningQA)
  const absent=async label=>{check(label+' no banner',await page.locator('#input-meaning-results').count()===0);check(label+' no marker',await page.locator('[data-input-warning-marker]').count()===0);check(label+' no item warnings',await page.locator('[data-item-input-warnings]').count()===0)}
  await absent(width+' built-in sample')
  const sample=await page.evaluate(()=>JSON.parse(JSON.stringify(warningQA.get())))
  async function load(c){
   await page.locator('#csv-file').setInputFiles(c.file)
   await page.waitForFunction(()=>document.querySelector('#smart-import[open],#import-check[open]'))
   if(await page.locator('#smart-import').isVisible()){
    if(c.reserved)await page.locator('#meaning-stock').selectOption('reserved')
    await page.locator('#meaning-units').check()
    if(await page.locator('#meaning-show-anyway').isVisible())await page.locator('#meaning-show-anyway').check()
    await page.locator('#smart-import-use').click()
   }
   await page.waitForFunction(()=>!document.querySelector('#smart-import[open]'))
   if(await page.locator('#import-check').isVisible())await page.locator('#import-check-confirm').click()
   await page.waitForFunction(()=>!document.querySelector('dialog[open]')&&document.body.dataset.analysisState!=='running')
   await page.locator('.work-row[data-sku]').first().waitFor()
  }
  for(const c of cases.filter(c=>!process.env.WARNING_CASE||c.name===process.env.WARNING_CASE)){
   await page.evaluate(()=>localStorage.removeItem('stock-runway.product-view'))
   await load(c)
   const banner=page.locator('#input-meaning-results'),label=width+' '+c.name
   check(label+' controls stay collapsed',await page.locator('#tools').evaluate(e=>!e.open)&&await page.locator('#file-panel').evaluate(e=>!e.open))
   check(label+' banner visible without reopening controls',await banner.isVisible())
   check(label+' banner not inside controls',await banner.evaluate(e=>!e.closest('#tools,#file-panel')))
   check(label+' expected warning',c.warning.test(await banner.textContent()))
   const affected=await page.evaluate(()=>warningQA.get().items.filter(i=>i.input_warnings?.length).length)
   check(label+' affected product count',affected>0&&(await banner.textContent()).includes(affected+' product'))
   const marker=page.locator('.work-row [data-input-warning-marker]').first();check(label+' accessible row marker',await marker.isVisible()&&/input warning/i.test(await marker.textContent()))
   await marker.locator('xpath=ancestor::*[@role="row"]').locator('.work-product').click()
   const detail=page.locator('#product-page [data-item-input-warnings]');check(label+' full product warnings next to advice',await detail.isVisible()&&c.warning.test(await detail.textContent()))
   check(label+' warning is in advice area',await detail.evaluate(e=>!!e.closest('.product-order-action')))
   // The view switch is intentionally desktop-only; preserve that preference on phone.
   if(width<641)await page.setViewportSize({width:1440,height:1000})
   await page.getByRole('button',{name:'Side panel view',exact:true}).click()
   if(width<641)await page.setViewportSize({width,height:1000})
   const panel=page.locator('#main [data-item-input-warnings]');check(label+' side panel warning visible',await panel.isVisible()&&c.warning.test(await panel.textContent()))
   await page.locator('#close-detail').click()
   const before=await page.evaluate(()=>JSON.stringify(warningQA.get().items.map(i=>i.input_warnings))),stored=await page.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort()))
   await banner.getByRole('button',{name:'Dismiss input warning summary'}).click();check(label+' summary dismissed',await banner.count()===0)
   check(label+' dismiss does not persist storage',stored===await page.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort())))
   check(label+' dismiss keeps row warning',await marker.isVisible())
   await marker.locator('xpath=ancestor::*[@role="row"]').locator('.work-product').click();check(label+' dismiss keeps detail warning',await page.locator('#main [data-item-input-warnings]').isVisible());await page.locator('#close-detail').click()
   check(label+' dismissal does not change item warnings',before===await page.evaluate(()=>JSON.stringify(warningQA.get().items.map(i=>i.input_warnings))))
   await load(c);check(label+' repeat import resets dismissal',await banner.isVisible())
   await page.screenshot({path:path.join(out,width+'-'+c.name.replaceAll(' ','-')+'.png')})
  }
  await page.evaluate(text=>{const parsed=JSON.parse(JSON.stringify(warningQA.get()));parsed.input_meaning={warnings:[text],affected:parsed.items.map(i=>({sku:i.sku,warnings:[text]}))};for(const i of parsed.items)i.input_warnings=[text];warningQA.show(parsed)},malicious)
  check(width+' malicious banner text preserved',(await page.locator('#input-meaning-results').textContent()).includes(malicious))
  await page.locator('.work-row .work-product').first().click();check(width+' malicious detail text preserved',(await page.locator('#main [data-item-input-warnings]').textContent()).includes(malicious))
  if(!await page.locator('#main .chart-expand').isVisible())await page.locator('#panel-show-detail').click()
  await page.locator('#main .chart-expand').click();check(width+' malicious full page text preserved',(await page.locator('#product-page [data-item-input-warnings]').textContent()).includes(malicious))
  check(width+' no injected elements or execution',await page.evaluate(()=>!window.warningXss&&!document.querySelector('#input-meaning-results img,#input-meaning-results script,[data-item-input-warnings] img,[data-item-input-warnings] script')))
  await page.locator('#product-page-close').click();await page.locator('#product-page').waitFor({state:'detached'});await page.locator('#close-detail').click()
  for(const source of ['Synthetic demo']){await page.evaluate(({sample,source})=>{const clean=JSON.parse(JSON.stringify(sample));delete clean.input_meaning;for(const i of clean.items)delete i.input_warnings;clean.note=source;warningQA.show(clean)},{sample,source});await absent(width+' '+source)}
  await load({file:csv('synthetic-erp.csv',[header,row('CLEAN-ERP')])});await absent(width+' synthetic ERP CSV import')
  await ctx.close()
 }
 check('no network',report.network.length===0);check('no browser errors',report.errors.length===0);report.status='PASS'
}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2))})().catch(e=>{console.error(e);process.exitCode=1})
