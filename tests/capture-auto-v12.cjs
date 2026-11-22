// Local file:// acceptance. Existing Playwright only; no installs/network.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/auto-ui');fs.mkdirSync(out,{recursive:true});
const months=Array.from({length:36},(_,i)=>`${2030+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`);
const cycle=[20,30,250,40,10,100,20,20,10,50,10,20];
const fixture={dataset:'Synthetic Lane M UI',note:'Wholly fictional UI acceptance',months,as_of:'2032-12-31',items:[
 {sku:'CYCLE',monthly_sales:[...cycle,...cycle,...cycle]},
 {sku:'LEVEL',monthly_sales:Array(36).fill(40)},
 {sku:'LOTS',monthly_sales:Array.from({length:36},(_,i)=>i%4===0?120:0)},
].map(i=>({...i,name:'Synthetic '+i.sku,unit:'units',on_hand:10,supplier_days:14,receipts:{}}))};
const json=path.join(out,'fixture.json'),html=path.join(out,'page.html');fs.writeFileSync(json,JSON.stringify(fixture));
const build=spawnSync(process.env.PYTHON||'/usr/bin/python3',['standalone/build.py','--data',json,'--out',html],{cwd:root,encoding:'utf8'});assert.equal(build.status,0,build.stderr);
const hooks=`\nwindow.autoQA={rows:()=>currentRows.map(r=>({sku:r.item.sku,method:r.item.forecast_method,ready:riskReady(r)})),open:sku=>wlOpen(rowMap.get(sku)),close:()=>removeProductPage(),why:sku=>openWhy(rowMap.get(sku)),settings:()=>gmPortableSettings()};\n`;
fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace('</script>',hooks+'</script>'));
const report={checks:[],errors:[],network:[],screenshots:[]};
function check(label,value){report.checks.push({label,pass:!!value});assert.ok(value,label)}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined});try{
 const context=await browser.newContext({offline:true,serviceWorkers:'block',viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await context.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()});
 await context.addInitScript(()=>{const Real=Date;window.Date=class extends Real{constructor(...a){super(...(a.length?a:['2033-01-01T12:00:00Z']))}static now(){return new Real('2033-01-01T12:00:00Z').getTime()}}});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(pathToFileURL(html).href);await page.waitForFunction(()=>window.autoQA);
 check('default remains Current',(await page.evaluate(()=>autoQA.settings())).forecast_method==='current');
 await page.locator('#tools>summary').click();await page.locator('#open-settings').click();
 const select=page.locator('#setting-forecast_method');
 check('recommended choice visible',await select.locator('option[value=recommended]').textContent()==='Recommended per product');
 await select.selectOption('recommended');
 check('mixed catalogue / ranges disclosure',(await page.locator('#forecast-preset-note').textContent()).includes('each product can use a different method'));
 await page.getByRole('button',{name:'Close',exact:true}).click();
 const rows=await page.evaluate(()=>autoQA.rows());check('all three products carry reason',rows.length===3&&rows.every(r=>r.method?.reason&&r.method.label.includes(' because ')));
 check('mixed method IDs',new Set(rows.map(r=>r.method.method)).size>=2);
 check('recommended-model risk withheld',rows.every(r=>r.ready===false));
 report.rows=rows;
 for(const row of rows){
   await page.evaluate(sku=>autoQA.why(sku),row.sku);
   check('Why reason visible '+row.sku,(await page.locator('#why-dialog .forecast-method').textContent()).includes('Method picked:'));
   check('Why ranges withheld '+row.sku,await page.locator('#why-dialog .forecast-range').count()===0);
   await page.locator('#why-dialog .sheet-close').click();
 }
 for(const width of [1440,390])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width===390?844:900});await page.evaluate(t=>stockRunwayTheme.set(t),theme);
   await page.evaluate(()=>autoQA.open('CYCLE'));
   check('product reason visible '+width+' '+theme,await page.locator('[data-forecast-method=true]').isVisible());
   check('no page overflow '+width+' '+theme,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const shot=`product-${width}-${theme}.png`;await page.screenshot({path:path.join(out,shot)});report.screenshots.push(shot);
   await page.evaluate(()=>autoQA.close());
 }
 await page.reload();await page.waitForFunction(()=>window.autoQA);check('recommended setting survives reload',(await page.evaluate(()=>autoQA.settings())).forecast_method==='recommended');
 check('no runtime errors',report.errors.length===0);check('no network',report.network.length===0);report.status='PASS';await context.close();
}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors}));})().catch(e=>{console.error(e);process.exitCode=1});
