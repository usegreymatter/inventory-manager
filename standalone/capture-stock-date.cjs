// Lifecycle: living. Synthetic offline Chromium + WebKit check of the "Stock counted on" field.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROME_BIN=/path/to/chrome node standalone/capture-stock-date.cjs
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/stock-date')
const fixture={as_of:'2026-10-31',months:['2026-05','2026-06','2026-07','2026-08','2026-09','2026-10'],note:'Synthetic fixture — fictional product.',
 items:[{sku:'SYN-30',name:'Synthetic 30 a day',unit:'box',on_hand:3000,supplier_days:14,monthly_sales:[930,900,930,930,900,930]}]}
const bridge=`
window.sdQA={
 load(){data=JSON.parse(${JSON.stringify(JSON.stringify(fixture))});sourceName='csv';evaluationSnapshot=null;render();return this.state()},
 state(){const r=rowMap.get('SYN-30');return {today:currentToday,qty:r.guidance.quantity,runout:r.guidance.runout_date,orderBy:r.guidance.order_by,onHand:r.item.on_hand,counted:r.item.counted_on_hand??null,
  message:document.getElementById('stock-date-message').textContent,snapshot:document.getElementById('snapshot').textContent,inTools:!!document.querySelector('.tools-body #stock-date'),label:document.querySelector('label[for=stock-date]')?.textContent||''}},
 set(value){const input=document.getElementById('stock-date');input.value=value;input.dispatchEvent(new Event('change'));return this.state()},
 field(){return document.getElementById('stock-date').value}
};`
async function main(){
 fs.mkdirSync(out,{recursive:true})
 const probe=path.join(out,'stock-date.html')
 fs.writeFileSync(probe,fs.readFileSync(path.join(__dirname,'inventory-manager.html'),'utf8').replace('</script>',bridge+'\n</script>'))
 const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright'),results=[]
 for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROME_BIN||process.env.CHROMIUM_EXECUTABLE||undefined}:{})})
  try{
   const ctx=await browser.newContext({viewport:{width:1440,height:900},offline:true}),page=await ctx.newPage(),errors=[],network=[]
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('file:')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))network.push(r.url())})
   await page.goto(pathToFileURL(probe).href);await page.waitForFunction(()=>!!window.sdQA)
   const base=await page.evaluate(()=>sdQA.load())
   assert.ok(base.inTools,'field sits in Import / settings');assert.match(base.label,/Stock counted on/)
   assert.equal(base.counted,null);assert.equal(base.onHand,3000)
   if(base.today>'2026-11-07')assert.match(base.message,/assumed counted on 2026-10-31/)
   const dated=await page.evaluate(today=>sdQA.set(today),base.today)
   assert.match(dated.message,/start from/);assert.match(dated.snapshot,/stock counted/)
   assert.equal(dated.counted,3000);assert.ok(dated.runout>base.runout,`${dated.runout} > ${base.runout}`)
   assert.ok(dated.qty<=base.qty,`${dated.qty} <= ${base.qty}`)
   const days=(Date.parse(dated.runout)-Date.parse(base.today))/864e5;assert.ok(days>=95&&days<=105,'runout ~100 days after count: '+days)
   await page.screenshot({path:path.join(out,engine+'-dated.png')})
   const refused=await page.evaluate(()=>sdQA.set('2026-09-30'))
   assert.match(refused.message,/before the last sales month/);assert.match(refused.message,/Not applied/)
   assert.deepEqual([refused.qty,refused.runout,refused.orderBy,refused.counted],[base.qty,base.runout,base.orderBy,null])
   await page.evaluate(today=>sdQA.set(today),base.today)
   const reloaded=await page.evaluate(()=>{sdQA.load();return {...sdQA.state(),field:sdQA.field()}})
   assert.equal(reloaded.field,'');assert.equal(reloaded.counted,null);assert.equal(reloaded.runout,base.runout)
   assert.deepEqual(errors,[]);assert.deepEqual(network,[])
   results.push({engine,base:{qty:base.qty,runout:base.runout},dated:{qty:dated.qty,runout:dated.runout},pass:true})
  }finally{await browser.close()}
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,1))
 console.log(JSON.stringify(results))
}
main().catch(e=>{console.error(e);process.exit(1)})
