// Lifecycle: living. Local opt-in method acceptance; built-in sample only.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/methods');fs.mkdirSync(out,{recursive:true})
const source=process.env.FORECAST_PAGE||path.join(__dirname,'stock-runway.html')
const hooks=`\nwindow.methodsQA={state:()=>({settings:gmPortableSettings(),key:gmDatasetSettingsKey,rows:currentRows.map(r=>({sku:r.item.sku,demand:r.item.monthly_demand,qty:r.guidance.quantity,method:r.guidance.forecast_method||r.item.forecast_method})),selected:selectedSku}),open:()=>wlOpen(rowMap.get(selectedSku)),presets:globalThis.StockRunwayForecastMethods.PRESETS};\n`
const probe=path.join(out,'probe.html');fs.writeFileSync(probe,fs.readFileSync(source,'utf8').replace('</script>',hooks+'</script>'))
const report={checks:[],errors:[],network:[],screenshots:[]}
function check(label,value,evidence){report.checks.push({label,pass:!!value,evidence});assert.ok(value,label+': '+JSON.stringify(evidence))}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
 try{
  const context=await browser.newContext({offline:true,serviceWorkers:'block',viewport:{width:1440,height:900},acceptDownloads:true})
  await context.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()})
  await context.addInitScript(()=>{const Real=Date;window.Date=class extends Real{constructor(...a){super(...(a.length?a:['2026-11-01T12:00:00Z']))}static now(){return new Real('2026-11-01T12:00:00Z').getTime()}}})
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(String(e)))
  await p.goto(pathToFileURL(probe).href);await p.waitForFunction(()=>window.methodsQA)
  const state=()=>p.evaluate(()=>methodsQA.state())
  const open=async()=>{if(!await p.locator('#tools').evaluate(e=>e.open))await p.locator('#tools>summary').click();await p.locator('#open-settings').click()}
  await open()
  const method=p.locator('#setting-forecast_method'),preset=p.locator('#setting-industry_preset'),baseline=await state()
  check('one Forecast method group',await p.locator('#forecast-method-settings').count()===1)
  check('opt-in defaults',baseline.settings.forecast_method==='current'&&baseline.settings.industry_preset==='none')
  const basis=p.locator('#setting-safety_stock_basis');check('default safety basis stays Sales variation',(await state()).settings.safety_stock_basis==='sales_variation');await basis.selectOption('forecast_misses');check('forecast-miss safety basis opt-in',(await state()).settings.safety_stock_basis==='forecast_misses')
  const methods=await method.locator('option').evaluateAll(es=>es.map(e=>e.value))
  assert.deepEqual(methods,['current','auto','naive','seasonal_naive','ma3','ma6','ma12','ses','holt_damped','hw_additive','hw_multiplicative','theta','croston','sba','tsb','adida','combination']);check('all 17 method choices',true)
  check('seven optional industry presets',await preset.locator('option').count()===8)
  await p.screenshot({path:path.join(out,'desktop-settings.png')});report.screenshots.push('desktop-settings.png')
  for(const value of methods){await method.selectOption(value);check('method selection '+value,(await state()).settings.forecast_method===value)}
  await method.selectOption('naive');const changed=await state()
  check('method change reaches evaluated forecasts',JSON.stringify(changed.rows)!==JSON.stringify(baseline.rows))
  for(const slug of ['distributor','retail','spare-parts','restaurant','pharmacy','seasonal','ecommerce']){
   const before=(await state()).settings;await preset.selectOption(slug);const after=(await state()).settings
   assert.deepEqual({...after,industry_preset:before.industry_preset},before)
   check('preset is advisory '+slug,(await p.locator('#forecast-preset-note').textContent()).includes('Experimental suggestion:'))
  }
  await preset.selectOption('spare-parts');await p.locator('#apply-forecast-preset').click()
  check('explicit suggestion applies method only',(await state()).settings.forecast_method==='sba')
  const saved=await state(),download=p.waitForEvent('download');await p.locator('#export-settings').click();const exported=await download,exportPath=path.join(out,'settings.json');await exported.saveAs(exportPath)
  assert.deepEqual(JSON.parse(fs.readFileSync(exportPath)),saved.settings);check('export preserves method and preset',true)
  for(const bad of [{forecast_method:'invented'},{industry_preset:'invented'},{forecast_method:7},{forecast_method:null},{safety_stock_basis:'bad'}]){
   await p.locator('#settings-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))})
   await p.waitForFunction(()=>document.querySelector('#import-settings-status').textContent.includes('Could not import'))
   assert.deepEqual((await state()).settings,saved.settings);check('invalid settings rejected '+JSON.stringify(bad),true)
  }
  await p.reload();await p.waitForFunction(()=>window.methodsQA);assert.deepEqual((await state()).settings,saved.settings);check('dataset persistence after reload',true)
  await open();await p.locator('#reset-settings').click();check('reset restores Current and None',(await state()).settings.forecast_method==='current'&&(await state()).settings.industry_preset==='none')
  await p.locator('#settings-file').setInputFiles(exportPath);await p.waitForFunction(()=>document.querySelector('#import-settings-status').textContent==='Settings imported.')
  assert.deepEqual((await state()).settings,saved.settings);check('settings import round trip',true)
  await p.getByRole('button',{name:'Close',exact:true}).click();await p.evaluate(()=>methodsQA.open())
  const selected=(await state()).rows.find(r=>r.sku===(saved.selected)),label=selected.method?.label
  check('engine supplies plain forecast label',typeof label==='string'&&label.length>0)
  check('product page names safety stock basis',(await p.locator('.product-inputs').textContent()).includes('Past forecast misses')||(await p.locator('.product-inputs').textContent()).includes('Sales variation (fallback)'))
  check('product page shows engine method label',(await p.locator('.product-inputs').textContent()).includes(label))
  await p.locator('.product-inputs').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'desktop-product.png')});report.screenshots.push('desktop-product.png')
  await p.getByRole('button',{name:'Side panel view',exact:true}).click()
  await p.locator('#close-detail').click()
  await p.setViewportSize({width:390,height:844});await open()
  await p.locator('#settings-sheet').evaluate(e=>{e.scrollTop=0})
  check('phone method group visible below header',await p.locator('#forecast-method-settings').evaluate(e=>{const b=e.getBoundingClientRect(),h=document.querySelector('#settings-sheet>header').getBoundingClientRect();return b.top>=h.bottom&&b.bottom<=innerHeight}))
  check('phone sheet fits viewport',await p.locator('#settings-sheet').evaluate(e=>e.getBoundingClientRect().width===innerWidth&&e.scrollWidth<=innerWidth))
  check('phone selectors meet 44px targets',await p.locator('#forecast-method-settings select').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height>=44)))
  for(const theme of ['light','dark']){await p.evaluate(t=>window.stockRunwayTheme.set(t),theme);await p.screenshot({path:path.join(out,'phone-'+theme+'.png')});report.screenshots.push('phone-'+theme+'.png')}
  await p.keyboard.press('Escape');check('Escape closes sheet',await p.locator('#settings-sheet').evaluate(e=>!e.open))
  check('no runtime errors',report.errors.length===0,report.errors);check('no network requests',report.network.length===0,report.network)
  report.status='PASS';await context.close()
 }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
