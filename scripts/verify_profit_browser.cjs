// Synthetic/offline Chromium proof; build .scratch/profit-order.html first.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch'),input=path.join(out,'profit-order.html');
const hook=`
window.profitProbe={
 prepare(){const row=currentRows.find(r=>!r.item.held&&r.guidance.quantity!=null&&r.item.monthly_demand>0&&!PROFIT_ORDER.unavailableReason(r.item,{...settings,profit_suggestion:true}));if(!row)throw Error('No eligible synthetic product');const sku=row.item.sku;saveSettings({...gmPortableSettings(),product_overrides:{...settings.product_overrides,[sku]:{...settings.product_overrides[sku],unit_cost:10,sale_price:20}}});return sku},
 open(sku){openProductPage(rowMap.get(sku));return {current:rowMap.get(sku).guidance.quantity,suggestion:rowMap.get(sku).guidance.profit_suggestion}},
 panel(sku){showProductAsPanel(rowMap.get(sku))},
 irregular(sku){data.items.find(r=>r.sku===sku).monthly_sales=data.months.map((_,i)=>i%3===2?90:0);saveSettings({...gmPortableSettings(),profit_suggestion:false});const before=rowMap.get(sku).guidance.quantity;saveSettings({...gmPortableSettings(),profit_suggestion:true});const g=rowMap.get(sku).guidance;openProductPage(rowMap.get(sku));return {before,current:g.quantity,suggestion:g.profit_suggestion,reason:g.profit_suggestion_unavailable}},
 expiry(sku){const item=data.items.find(r=>r.sku===sku);item.lots=[];item.expiry_warnings=['Month-only expiry interpreted as month-end','lot total does not match on-hand stock; check lot quantities','<img src=x onerror="window.__expiryXss=1">'];render();openProductPage(rowMap.get(sku));return rowMap.get(sku).guidance.expiry_warnings},
 usableRisk(sku){const item=data.items.find(r=>r.sku===sku);item.on_hand=200;item.lots=[{lot:'Expired',expiry:'2026-10-30',qty:200}];render();const row=rowMap.get(sku),spec=riskSpec(row),risk=productRisk(row);return {excluded:row.guidance.expiry_excluded_qty,usable:spec.on_hand,physical:row.item.on_hand,shortfall:risk.expected_shortfall_before,expected:StockRunwayRisk.simulateRisk({...spec,on_hand:0,include_shortfall:true}).expected_shortfall_before}},
 settings(){gmOpenSettings()},
 snapshot(sku){const row=rowMap.get(sku);return {enabled:settings.profit_suggestion===true,current:row.guidance.quantity,suggestion:row.guidance.profit_suggestion,persisted:JSON.parse(localStorage.getItem(gmDatasetSettingsKey))}}
};`;
const probe=path.join(out,'profit-browser.html');fs.writeFileSync(probe,fs.readFileSync(input,'utf8').replace('</script>',hook+'\n</script>'));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
 const report={browser:browser.version(),checks:[],errors:[],network:[]};
 try{
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
   page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url())});
   await page.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-01T09:00:00Z']))}static now(){return new D('2026-11-01T09:00:00Z').getTime()}}});
   await page.goto(pathToFileURL(probe).href);await page.waitForFunction(()=>window.profitProbe);
   const sku=await page.evaluate(()=>profitProbe.prepare()),off=await page.evaluate(sku=>profitProbe.open(sku),sku);
   assert.equal(off.suggestion,undefined);assert.equal(await page.locator('[data-profit-suggestion]').count(),0);
   await page.evaluate(()=>profitProbe.settings());
   await page.locator('#settings-sheet summary').filter({hasText:'Advanced'}).click();
   await page.locator('label[for="setting-profit_suggestion"]').click();
   assert.equal(await page.locator('#setting-profit_suggestion').isChecked(),true);
   await page.locator('#settings-sheet').getByRole('button',{name:'Close',exact:true}).click();
   const on=await page.evaluate(sku=>profitProbe.open(sku),sku);assert.ok(on.suggestion);assert.equal(on.current,off.current);
   const line=page.locator('#product-page [data-profit-suggestion]');await line.waitFor({state:'visible'});assert.match(await line.innerText(),/^Most profitable: .*vs current.*Order-now estimate/s);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(out,`profit-${width}.png`)});
   const persisted=await page.evaluate(sku=>profitProbe.snapshot(sku),sku);assert.equal(persisted.persisted.profit_suggestion,true);
   await page.evaluate(sku=>profitProbe.panel(sku),sku);assert.ok(await page.locator('[data-profit-suggestion]').count());
   await page.reload();await page.waitForFunction(()=>window.profitProbe);
   const reloaded=await page.evaluate(sku=>profitProbe.snapshot(sku),sku);assert.equal(reloaded.enabled,true);assert.ok(reloaded.suggestion);
   await page.evaluate(()=>profitProbe.settings());
   await page.locator('#settings-sheet summary').filter({hasText:'Advanced'}).click();
   await page.locator('label[for="setting-profit_suggestion"]').click();
   await page.locator('#settings-sheet').getByRole('button',{name:'Close',exact:true}).click();
   const restored=await page.evaluate(sku=>profitProbe.open(sku),sku);assert.equal(restored.suggestion,undefined);assert.equal(restored.current,off.current);assert.equal(await page.locator('[data-profit-suggestion]').count(),0);
   const irregular=await page.evaluate(sku=>profitProbe.irregular(sku),sku);assert.equal(irregular.suggestion,undefined);assert.equal(irregular.current,irregular.before);assert.match(irregular.reason,/Sales too irregular/);
   const abstention=page.locator('#product-page [data-profit-suggestion]');await abstention.waitFor({state:'visible'});assert.match(await abstention.innerText(),/^Sales too irregular/);assert.doesNotMatch(await abstention.innerText(),/Most profitable/);
   const warnings=await page.evaluate(sku=>profitProbe.expiry(sku),sku);const warningBox=page.locator('#product-page [data-expiry-warnings]');assert.ok(warnings.length>=3);assert.equal(await warningBox.count(),1);const warningText=await warningBox.innerText();assert.match(warningText,/month-end/);assert.match(warningText,/lot total does not match/);assert.match(warningText,/<img src=x/);assert.equal(await warningBox.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.__expiryXss),undefined);
   const usable=await page.evaluate(sku=>profitProbe.usableRisk(sku),sku);assert.equal(usable.excluded,200);assert.equal(usable.usable,0);assert.equal(usable.physical,200);assert.equal(usable.shortfall,usable.expected);assert.ok(usable.shortfall>0);
   report.checks.push({width,expiry_risk_uses_usable_stock:true,expiry_warnings_visible_and_escaped:true,irregular_reason_visible:true,irregular_standard_unchanged:true,default_hidden:true,native_toggle:true,current_unchanged:true,product_line:true,panel_line:true,persistence:true,off_hidden:true,no_overflow:true});
   await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);report.status='PASS';
 }finally{await browser.close();fs.writeFileSync(path.join(out,'profit-browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
