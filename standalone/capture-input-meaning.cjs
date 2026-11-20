// Lifecycle: living. Synthetic browser acceptance of import facts before purchase quantities.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE)
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/input-meaning');fs.mkdirSync(out,{recursive:true})
const csv='Stock report\nsku,name,unit,on_hand,supplier_days,2026-07,2026-08,2026-09,reserved,on_order,Sales unit\n'+Array.from({length:5},(_,i)=>`P${i},Synthetic ${i},pcs,10,14,${i<2?'':'3'},3,3,4,50,${i===0?'boxes':'pcs'}`).join('\n')+'\n'
const file={name:'synthetic-meaning.csv',mimeType:'text/csv',buffer:Buffer.from(csv)}
const probe=path.join(out,'probe.html'),html=fs.readFileSync(path.join(root,'standalone/stock-runway.html'),'utf8');fs.writeFileSync(probe,html.replace('</script>','\nwindow.meaningQA=()=>({data,sourceName});\n</script>'))
const report={checks:[],screenshots:[],network:[],errors:[]}
function check(label,value){report.checks.push({label,pass:!!value});assert.ok(value,label)}
;(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});await ctx.route(/^https?:/,route=>{report.network.push(route.request().url());return route.abort()});const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(pathToFileURL(probe).href);await page.waitForFunction(()=>window.meaningQA)
  const original=await page.evaluate(()=>meaningQA().data.items.map(i=>i.sku))
  await page.locator('#csv-file').setInputFiles(file);await page.locator('#input-meaning-card').waitFor({state:'visible'})
  check(width+' no file replacement before acceptance',JSON.stringify(await page.evaluate(()=>meaningQA().data.items.map(i=>i.sku)))===JSON.stringify(original))
  check(width+' unit confirmation required',await page.locator('#smart-import-use').isDisabled())
  await page.locator('#meaning-stock').selectOption('reserved');await page.locator('#meaning-incoming').selectOption('unknown');await page.locator('#meaning-units').check()
  check(width+' missing-row guard remains blocking',await page.locator('#smart-import-use').isDisabled())
  check(width+' more than 20 percent has explicit override',await page.locator('#meaning-show-anyway').isVisible())
  check(width+' card no horizontal overflow',await page.locator('#input-meaning-card').evaluate(e=>e.scrollWidth<=e.clientWidth&&e.getBoundingClientRect().right<=innerWidth))
  const shot=path.join(out,`input-meaning-${width}.png`);await page.screenshot({path:shot});report.screenshots.push(shot)
  await page.locator('#meaning-show-anyway').check();check(width+' explicit override permits acceptance',await page.locator('#smart-import-use').isEnabled());await page.locator('#smart-import-use').click();await page.waitForFunction(()=>meaningQA().sourceName==='synthetic-meaning.csv')
  const state=await page.evaluate(()=>meaningQA().data)
  check(width+' reserved stock subtracted once',state.items.every(i=>i.on_hand===6))
  check(width+' incoming unknown not supplied as known zero',state.items.every(i=>i.on_order===undefined&&i.incoming_unknown===true))
  check(width+' results persistent incoming warning',(await page.locator('#input-meaning-results').textContent()).includes('Incoming orders unknown — counted as 0. Check open POs before ordering.'))
  check(width+' disagreeing units warned',(await page.locator('#input-meaning-results').textContent()).includes('Sales and stock units disagree'))
  check(width+' affected rows marked',await page.locator('[data-input-warning-sku]').count()===5)
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('stock-runway-smart-mappings-v1')))
  check(width+' only layout and interpretation defaults remembered',saved.length===1&&saved[0].choices.stock_includes_reserved&&saved[0].choices.incoming_not_in_file&&saved[0].choices.units_confirmed&&!JSON.stringify(saved).includes('Synthetic 0'))
  await page.locator('#csv-file').setInputFiles(file);await page.locator('#smart-import').waitFor({state:'visible'})
  check(width+' risky layout requires a fresh acknowledgement',await page.locator('#meaning-show-anyway').isChecked()===false&&await page.locator('#smart-import-use').isDisabled())
  check(width+' interpretation defaults remembered',await page.locator('#meaning-stock').inputValue()==='reserved'&&await page.locator('#meaning-incoming').inputValue()==='unknown'&&await page.locator('#meaning-units').isChecked())
  await page.locator('#smart-import-cancel').click();check(width+' cancel preserves accepted stock',await page.evaluate(()=>meaningQA().data.items.every(i=>i.on_hand===6)))
  const future={name:'future.csv',mimeType:'text/csv',buffer:Buffer.from(csv.replaceAll('2026-09','2027-09').replaceAll('2026-07','2027-07').replaceAll('2026-08','2027-08'))}
  await page.locator('#csv-file').setInputFiles(future);await page.locator('#smart-import').waitFor({state:'visible'});check(width+' future sales guard visible',(await page.locator('#input-meaning-card').textContent()).includes('Sales dates are in the future.'));await page.locator('#smart-import-cancel').click()
  await ctx.close()
 }
 check('no network',report.network.length===0);check('no browser errors',report.errors.length===0);report.status='PASS'
}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2))})().catch(error=>{console.error(error);process.exitCode=1})
