// Offline advisory scenario proof; source data and forecast remain frozen.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/pp'),report={checks:[],errors:[],network:[],screenshots:[]}
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert.ok(value,name)}
const hook=`window.stockoutQA={state:()=>({enabled:settings.stockout_adjust,rows:currentRows.map(r=>({sku:r.item.sku,qty:r.guidance.quantity,flags:detectStockoutMonths(r.item,data.as_of.slice(0,7)).flagged})),raw:JSON.stringify(data)}),open:sku=>openProductPage(rowMap.get(sku)),close:()=>{removeProductPage();history.replaceState(null,'','#')},simple:()=>!WL_SIMPLE_COLUMNS.includes('stockouts'),catalog:()=>wlColumns.some(c=>c[0]==='stockouts')};`
async function main(){
 fs.mkdirSync(out,{recursive:true});const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
 try{for(const width of [1440,390]){
  const html=fs.readFileSync(path.join(__dirname,'stock-runway-demo-1000.html'),'utf8'),file=path.join(out,'stockout-probe.html');fs.writeFileSync(file,html.replace('</script>',hook+'\n</script>'))
  const ctx=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});await ctx.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-17T09:00:00Z']))}static now(){return new D('2026-11-17T09:00:00Z').getTime()}}})
  await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());r.abort()});const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>window.stockoutQA)
  const before=await p.evaluate(()=>stockoutQA.state());check(width+' defaults OFF',before.enabled===false);check(width+' catalog optional, absent Simple',await p.evaluate(()=>stockoutQA.simple()&&stockoutQA.catalog()))
  // Use the actual settings switch, not a test-only settings assignment.
  await p.locator('#tools>summary').click();await p.locator('#open-settings').click();await p.locator('#settings-sheet details.settings-group>summary').filter({hasText:'Advanced'}).click();await p.locator('[data-setting-key=stockout_adjust]').check();await p.keyboard.press('Escape')
  const after=await p.evaluate(()=>stockoutQA.state());check(width+' setting ON',after.enabled===true);check(width+' raw data unchanged',before.raw===after.raw)
  const map=new Map(before.rows.map(r=>[r.sku,r])),changed=after.rows.filter(r=>r.qty!==map.get(r.sku).qty);check(width+' ON changes some orders',changed.length>0);check(width+' ON changes only flagged SKUs',changed.every(r=>map.get(r.sku).flags.length>0));check(width+' every unflagged SKU unchanged',after.rows.filter(r=>!r.flags.length).every(r=>r.qty===map.get(r.sku).qty))
  const target=changed.find(r=>r.flags.some(f=>f.month>='2026-05'))||changed[0];await p.evaluate(sku=>stockoutQA.open(sku),target.sku);await p.locator('#product-show-detail').click();await p.waitForSelector('[data-stockout-note]');check(width+' advisory visible and labelled ON',await p.locator('[data-stockout-note]').textContent().then(s=>s.includes('with correction, order would be')&&s.includes('Correction ON')))
  await p.locator('#product-page [data-zoom=all]').click();check(width+' chart hatching visible',await p.locator('#product-page [data-stockout-stripe]').count()>0);await p.locator('.product-page-chart').evaluate(e=>{e.scrollIntoView({block:'start'});const page=e.closest('#product-page');page.scrollTop=Math.max(0,page.scrollTop-80)})
  check(width+' no overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#product-page').scrollWidth<=document.querySelector('#product-page').clientWidth))
  const shot=path.join(out,'stockout-'+width+'.png');await p.screenshot({path:shot});report.screenshots.push(shot)
  await p.reload();await p.waitForFunction(()=>window.stockoutQA);check(width+' opt-in persists on device',await p.evaluate(()=>stockoutQA.state().enabled));await p.evaluate(()=>stockoutQA.close())
  await p.locator('#tools>summary').click();await p.locator('#open-settings').click();await p.locator('#settings-sheet details.settings-group>summary').filter({hasText:'Advanced'}).click();await p.locator('[data-setting-key=stockout_adjust]').uncheck();await p.keyboard.press('Escape')
  const restored=await p.evaluate(()=>stockoutQA.state());check(width+' OFF restores every quantity',restored.rows.every(r=>r.qty===map.get(r.sku).qty));await p.evaluate(sku=>stockoutQA.open(sku),target.sku);check(width+' advisory remains with correction OFF',await p.locator('[data-stockout-note]').textContent().then(s=>s.includes('Advisory only · correction OFF')))
  report.changed=changed.length;report.target={sku:target.sku,before:map.get(target.sku).qty,after:target.qty};await ctx.close()
 }
 check('no runtime errors',!report.errors.length);check('offline no requests',!report.network.length)
 }finally{await browser.close();fs.writeFileSync(path.join(out,'stockout-report.json'),JSON.stringify(report,null,2)+'\n')}
 console.log(JSON.stringify(report,null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
