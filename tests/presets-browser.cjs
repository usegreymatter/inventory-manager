// Synthetic offline acceptance. Build .scratch/presets.html before running.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch');
const hook=`
window.presetProbe={
 mixed(){const months=Array.from({length:12},(_,i)=>i<2?'2025-'+(i+11):'2026-'+String(i-1).padStart(2,'0'));const mk=(sku,lead)=>({sku,name:sku,unit:'u',monthly_sales:months.map(()=>100),on_hand:100,on_order:0,supplier_days:lead,receipts:{}});data={items:[...Array.from({length:9},(_,i)=>mk('S'+i,10)),mk('SLOW',300)],months,as_of:'2026-10-31'};sourceName='synthetic-mixed-preset-test';render();saveSettings({review_days:90,product_overrides:{SLOW:{review_days:30}}});gmSyncFields();},
 setup(){const item={sku:'CAN',name:'Synthetic cans',unit:'units',monthly_sales:[300,300,300],on_hand:0,supplier_days:14,receipts:{}};data={items:[item,{...item,sku:'MILK',name:'Synthetic milk',shelf_life_days:14}],months:['2026-08','2026-09','2026-10'],as_of:'2026-10-31'};sourceName='synthetic-preset-test';render();},
 reset(){saveSettings({months_of_cover:.25,review_days:30,shelf_life_days:365,product_overrides:{CAN:{pack_size:3,shelf_life_days:null}}});gmSyncFields();},
 state(){return {settings:gmPortableSettings(),persisted:JSON.parse(localStorage.getItem(gmDatasetSettingsKey)),rows:currentRows.map(r=>({sku:r.item.sku,quantity:r.guidance.quantity,capped:r.guidance.capped}))}},
 preview(){return gmSettingPresetPending?.preview},
 openSettings(){gmOpenSettings()},
 noShelfSetup(){saveSettings({shelf_life_days:14});openProductPage(rowMap.get('CAN'));},
 openCan(){openProductPage(rowMap.get('CAN'))},
 coverSetup(){saveSettings({months_of_cover:2,profit_suggestion:true,product_overrides:{CAN:{months_of_cover:3}}});openProductPage(rowMap.get('CAN'));},
 coverState(){const row=rowMap.get('CAN');return {why:whyThisAmount(row.item,currentToday,settings,data.as_of),quantity:row.guidance.quantity,risk_cover:riskSpec(row).cover_months}}
};`;
const input=fs.readFileSync(path.join(out,'presets.html'),'utf8'),at=input.lastIndexOf('</script>');
assert.ok(at>0);const probe=path.join(out,'presets-browser.html');fs.writeFileSync(probe,input.slice(0,at)+hook+input.slice(at));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
 const report={browser:browser.version(),checks:[],errors:[],network:[]};
 try{
  for(const width of [390,1440])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce',colorScheme:theme}),page=await context.newPage();
   page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url())});
   await page.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-01T09:00:00Z']))}static now(){return new D('2026-11-01T09:00:00Z').getTime()}}});
   await page.goto(pathToFileURL(probe).href);await page.waitForFunction(()=>window.presetProbe);
   await page.evaluate(()=>presetProbe.setup());await page.evaluate(()=>presetProbe.openSettings());
   for(const slug of ['general','grocery','pharmacy','fashion','spare-parts','electronics']){
    await page.evaluate(()=>presetProbe.reset());const before=await page.evaluate(()=>presetProbe.state());
    await page.locator('[data-setting-preset="'+slug+'"]').click();
    const preview=await page.evaluate(()=>presetProbe.preview());assert.ok(preview.impact);assert.equal(preview.impact.products,2);assert.equal(preview.impact.affected_products,1);assert.ok(preview.impact.quantity_change>0);
    const impact=page.locator('#industry-preset-impact');await impact.scrollIntoViewIfNeeded();assert.equal(await impact.isVisible(),true);assert.match(await impact.innerText(),/1 of 2 products affected.*Total order quantity:/);
    assert.match(await page.locator('#industry-preset-preview').innerText(),/How often do you place orders.*30-day/s);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(slug==='grocery')await page.screenshot({path:path.join(out,'preset-preview-'+width+'-'+theme+'.png')});
    await page.locator('#confirm-setting-preset').click();const applied=await page.evaluate(()=>presetProbe.state());
    assert.equal(applied.settings.months_of_cover,2);assert.equal(applied.settings.review_days,30);assert.equal(applied.settings.shelf_life_days,365);assert.equal(applied.settings.product_overrides.CAN.shelf_life_days,null);
    assert.equal(applied.rows.reduce((s,r)=>s+r.quantity,0),preview.impact.after_quantity);assert.equal(applied.rows.filter((r,i)=>r.quantity!==before.rows[i].quantity).length,preview.impact.affected_products);
    await page.locator('#undo-setting-preset').click();const undone=await page.evaluate(()=>presetProbe.state());assert.deepEqual(undone,before);
    report.checks.push({theme,width,slug,preview_visible:true,affected_products:preview.impact.affected_products,quantity_change:preview.impact.quantity_change,apply:true,exact_undo:true,no_overflow:true});
   }
   await page.evaluate(()=>presetProbe.mixed());const mixedBefore=await page.evaluate(()=>presetProbe.state());
   await page.locator('[data-setting-preset="grocery"]').click();const floor=await page.evaluate(()=>presetProbe.preview());
   assert.equal(floor.next.months_of_cover,2);assert.equal(floor.impact.affected_products,9);
   for(let i=0;i<9;i++)assert.equal(floor.next.product_overrides['S'+i].months_of_cover,3);
   assert.equal(floor.next.product_overrides.SLOW.months_of_cover,undefined);
   assert.match(await page.locator('#industry-preset-impact').innerText(),/9 of 10 products affected/);
   await page.locator('#confirm-setting-preset').click();const mixedAfter=await page.evaluate(()=>presetProbe.state());
   assert.equal(mixedAfter.rows.reduce((s,r)=>s+r.quantity,0),floor.impact.after_quantity);
   assert.equal(mixedAfter.rows.filter((r,i)=>r.quantity!==mixedBefore.rows[i].quantity).length,floor.impact.affected_products);
   assert.deepEqual(mixedAfter.persisted,mixedAfter.settings);
   await page.locator('#undo-setting-preset').click();assert.deepEqual(await page.evaluate(()=>presetProbe.state()),mixedBefore);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   report.checks.push({theme,width,per_product_floor:true,affected_products:9,apply:true,exact_undo:true,no_overflow:true});
   await page.evaluate(()=>presetProbe.setup());
   await page.locator('#settings-sheet').getByRole('button',{name:'Close',exact:true}).click();
   await page.evaluate(()=>presetProbe.noShelfSetup());
   assert.equal((await page.evaluate(()=>presetProbe.state())).rows.find(r=>r.sku==='CAN').capped,true);
   await page.locator('#product-show-detail').click();
   await page.locator('#product-page').getByRole('button',{name:'Change settings for this product',exact:true}).click();
   const button=page.locator('#settings-sheet [data-no-shelf-life="CAN"]');await button.click();
   const disabled=await page.evaluate(()=>presetProbe.state());assert.equal(disabled.settings.product_overrides.CAN.shelf_life_days,null);assert.equal(disabled.rows.find(r=>r.sku==='CAN').capped,undefined);
   assert.equal(await page.locator('#sheet-setting-product-shelf_life_days').inputValue(),'0');
   assert.equal(await page.locator('#settings-sheet').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   report.checks.push({theme,width,native_product_no_shelf:true,explicit_zero_display:true,no_overflow:true});
   await page.reload();await page.waitForFunction(()=>window.presetProbe);await page.evaluate(()=>{presetProbe.setup();presetProbe.coverSetup()});
   const coverState=await page.evaluate(()=>presetProbe.coverState());assert.match(coverState.why,/3 months cover/);assert.equal(coverState.risk_cover,3);
   const coverInput=page.locator('.product-inputs .product-input').filter({has:page.locator('span', {hasText:/^Cover$/})});
   if(!await coverInput.isVisible())await page.locator('#product-show-detail').click();
   assert.equal(await coverInput.isVisible(),true);assert.match(await coverInput.innerText(),/Cover\s+3 months\s+Product/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   report.checks.push({theme,width,resolved_cover:3,report_source:'Product',why:true,risk:true,no_overflow:true});
   await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);report.status='PASS';
 }finally{await browser.close();fs.writeFileSync(path.join(out,'presets-browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
