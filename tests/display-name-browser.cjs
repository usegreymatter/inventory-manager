// Offline rendered-text rename acceptance; existing local Playwright only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});const checks=[];
 try{
  const context=await browser.newContext();await context.route(/^https?:/,r=>r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function verify(label){
   const text=await page.locator('body').innerText(),title=await page.title();
   assert.doesNotMatch(title+'\n'+text,/stock runway/i,label);
   assert.match(title+'\n'+text,/Inventory Manager/,label);
   const accessible=await page.locator('body').evaluate(el=>[...el.querySelectorAll('[title],[aria-label],[alt]')].map(n=>[n.title,n.getAttribute('aria-label'),n.getAttribute('alt')].filter(Boolean).join(' ')).join('\n'));
   assert.doesNotMatch(accessible,/stock runway/i,label+' accessible labels');checks.push(label);
  }
  for(const file of ['standalone/inventory-manager.html','standalone/inventory-manager-demo-1000.html',...['baseline','option-a','option-a2','option-a3','option-b','option-gm-a','option-gm-b','option-gm-c'].map(n=>'standalone/design/'+n+'.html')]){
   await page.goto(pathToFileURL(path.resolve(file)).href);await page.waitForTimeout(250);await verify(file);
  }
  const harness=pathToFileURL(path.resolve('docs/harness.html')).href;
  await page.goto(harness);await page.getByRole('heading',{name:'Inventory Manager',exact:true}).waitFor();await verify('Desktop page');
  await page.getByRole('button',{name:'Inventory Manager: quick view',exact:true}).click();await page.getByRole('dialog').waitFor();await verify('Desktop quick view');
  await page.goto(harness+'#settings');await page.getByRole('heading',{name:'Inventory Manager settings',exact:true}).waitFor();await verify('Desktop settings');
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close()}
 const report={status:'PASS',rendered_surfaces:checks.length,checks};fs.mkdirSync('.scratch/B',{recursive:true});fs.writeFileSync('.scratch/B/display-name-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1});
