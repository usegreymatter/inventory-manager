// Offline synthetic cost-view acceptance. Requires local Playwright; no server.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE)
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/cost-ui');fs.mkdirSync(out,{recursive:true})
const built=path.join(out,'head.html')
require('node:child_process').execFileSync(process.env.PYTHON||'python3',['standalone/build.py','--out',built],{cwd:root})
const html=fs.readFileSync(built,'utf8')
const probe=path.join(out,'probe.html')
const seam="window.costQA={show:fixture=>{localToday=()=> '2026-11-01';data=fixture;sourceName='cost-test';render()},get:()=>currentRows.map(row=>({sku:row.item.sku,qty:row.guidance.quantity,expiry_at_risk_qty:row.guidance.expiry_at_risk_qty,...costForRow(row)})),total:()=>StockRunwayCosts.costTotals(currentRows.map(costForRow)),open:sku=>openProductPage(rowMap.get(sku)),columns:()=>wl.columns};"
fs.writeFileSync(probe,html.replace('</script>','\n'+seam+'\n</script>'))
const malicious='<img src=x onerror="window.costXss=1"> & <script>window.costXss=2</script>'
const fixture={as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:[{sku:'COST-A',name:malicious,unit:'ea',on_hand:5.5,on_order:0,supplier_days:10,unit_cost:4,sale_price:4.3,monthly_sales:[30,30,30],receipts:{},lots:[{lot:'REAL-LOT',expiry:'2026-11-03',qty:5.5}]},{sku:'COST-B',name:'Cost-only item',unit:'ea',on_hand:60,on_order:10,supplier_days:10,unit_cost:2,monthly_sales:[30,30,30],receipts:{'2026-11':5}},{sku:'COST-C',name:'Unknown cost item',unit:'ea',on_hand:20,on_order:0,supplier_days:10,monthly_sales:[30,30,30],receipts:{}}]}
const report={checks:[],errors:[],consoleErrors:[],network:[]}
function check(label,value){report.checks.push({label,pass:!!value});assert.ok(value,label)}
;(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});try{
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:1000},offline:true,reducedMotion:'reduce'});await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()});const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text())});
  await page.goto(pathToFileURL(probe).href);await page.waitForFunction(()=>window.costQA);await page.evaluate(f=>costQA.show(f),fixture);await page.waitForFunction(()=>riskMetrics.columns.complete);
  await page.waitForFunction(()=>document.querySelector('#cost-totals')?.textContent.includes('Lost profit estimate'));
  const values=await page.evaluate(()=>({rows:costQA.get(),total:costQA.total()}));
  check(width+' tied up matches exact fractional input',values.rows.find(r=>r.sku==='COST-A').money_tied_up===22&&values.total.money_tied_up===142);
  check(width+' incomplete totals explicit',/Known for 2 \/ 3 products/.test(await page.locator('#cost-totals').innerText()));
  check(width+' cost-only no guessed margin or lost profit',!('margin_unit'in values.rows.find(r=>r.sku==='COST-B'))&&!('lost_profit_est'in values.rows.find(r=>r.sku==='COST-B')));
  check(width+' unknown cost no guessed money',!('money_tied_up'in values.rows.find(r=>r.sku==='COST-C')));
  check(width+' incoming includes existing dated ledger',values.rows.find(r=>r.sku==='COST-B').incoming_value===30);
  const expiry=values.rows.find(r=>r.sku==='COST-A');check(width+' real FEFO expiry risk valued read-only',expiry.expiry_at_risk_qty>0&&expiry.expiry_value_at_risk===expiry.expiry_at_risk_qty*4);
  check(width+' lost profit from sampled shortfall',values.rows.find(r=>r.sku==='COST-A').lost_profit_est>0);
  check(width+' totals visible',await page.locator('#cost-totals').isVisible());
  check(width+' page has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Use actual Custom-view controls; no direct column-state injection.
  await page.locator('#work-view>summary').click();await page.locator('#work-view [data-density=detailed]').click();
  check(width+' Detailed columns unchanged',await page.evaluate(()=>!costQA.columns().includes('money_tied_up')&&!costQA.columns().includes('lost_profit_est')));
  await page.locator('#work-view [data-density=custom]').click();
  await page.locator('#column-customize>summary').click();await page.locator('#column-customize [data-key=money_tied_up] input').check();await page.locator('#column-customize [data-key=lost_profit_est] input').check();
  check(width+' custom columns selected',await page.evaluate(()=>costQA.columns().includes('money_tied_up')&&costQA.columns().includes('lost_profit_est')));
  await page.locator('#work-view>summary').click();
  await page.evaluate(()=>costQA.open('COST-A'));const detail=page.locator('#product-page .product-costs');
  check(width+' detail visible',await detail.isVisible());check(width+' fractional margin is visible',await detail.locator('.cost-grid>div').filter({hasText:'Margin per unit'}).locator('strong').innerText()==='0.3');check(width+' detail margin and estimate labels',/Margin per unit/.test(await detail.innerText())&&/Lost profit estimate/.test(await detail.innerText()));
  check(width+' malicious product name is literal',await page.locator('#product-page h1').textContent()===malicious);
  check(width+' user text never HTML',await page.evaluate(()=>!window.costXss&&!document.querySelector('#product-page h1 img,#product-page h1 script,.product-costs img,.product-costs script')));
  const after=await page.evaluate(()=>costQA.get().map(x=>x.qty));check(width+' display changes no order quantities',JSON.stringify(after)===JSON.stringify(values.rows.map(x=>x.qty)));
  await detail.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'detail-'+width+'.png')});await page.locator('#product-page-close').click();await page.screenshot({path:path.join(out,'totals-'+width+'.png')});await ctx.close();
 }
 check('zero page errors',report.errors.length===0);check('zero console errors',report.consoleErrors.length===0);check('zero network calls',report.network.length===0);
}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}console.log(JSON.stringify(report,null,2))})().catch(e=>{console.error(e);process.exitCode=1})
