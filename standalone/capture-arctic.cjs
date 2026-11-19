// Lifecycle: living. Offline acceptance for the owner-selected Arctic build.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.scratch/brand')
const report={status:'RUNNING',checks:[],screenshots:[],errors:[],network:[],geometry:[]}
function check(name,pass,evidence){report.checks.push({name,pass:!!pass,evidence});assert.ok(pass,name+': '+JSON.stringify(evidence))}
function contrast(a,b){
 const l=rgb=>{const v=rgb.match(/\d+(?:\.\d+)?/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]}
 const x=l(a),y=l(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
async function settle(page){await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
async function geometry(page,key,phone){
 const g=await page.evaluate(()=>{
  const svg=document.querySelector('svg[data-chart]'),box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}}
  const labels=[...svg.querySelectorAll('text')].map(e=>({text:e.textContent,...box(e)})),overlaps=[]
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
   const a=labels[i],b=labels[j];if(a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1)overlaps.push([a.text,b.text])
  }
  return {width:innerWidth,scroll:document.documentElement.scrollWidth,labels,overlaps,
   months:svg.querySelectorAll('[data-month-tick]').length,receipts:svg.querySelectorAll('[data-gm-delivery-label],[data-gm-leader]').length,
   hint:getComputedStyle(document.querySelector('.list-footer')).display,
   bg:['html','body','#main','#sidebar','.topbar','.chart-wrap','svg[data-chart]'].map(s=>[s,getComputedStyle(document.querySelector(s)).backgroundColor]),
   chart:box(svg),section:box(document.querySelector('.chart-section')),logo:box(document.querySelector('.gm-logo')),
   annotations:[...svg.querySelectorAll('[data-today-label],[data-runout-label]')].map(e=>({text:e.textContent,...box(e)})),
   plotTop:Math.min(...[...svg.querySelectorAll('[data-gridline]')].map(e=>box(e).y)),
   runout:svg.querySelector('[data-runout-label]')?{leader:svg.querySelector('[data-runout-leader]')?.getAttribute('d'),stroke:svg.querySelector('[data-runout-leader]')?getComputedStyle(svg.querySelector('[data-runout-leader]')).stroke:null,width:svg.querySelector('[data-runout-leader]')?.getAttribute('stroke-width')}:null,
   bars:[...svg.querySelectorAll('[data-period]')].map(e=>[getComputedStyle(e).fill,getComputedStyle(e).stroke,getComputedStyle(e).opacity,e.dataset.period]),
   canvas:document.querySelectorAll('canvas').length,relative:[...document.querySelectorAll('.date-relative')].map(e=>e.textContent),
   textColours:[...new Set([...document.querySelectorAll('body *')].filter(e=>{
    if(e.closest('script,style,.gm-logo,[hidden]')||!e.getClientRects().length)return false
    if(e.closest('details:not([open])')&&!e.closest('summary'))return false
    return [...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())
   }).map(e=>e instanceof SVGElement?getComputedStyle(e).fill:getComputedStyle(e).color))],
   numberColour:getComputedStyle(document.querySelector('.big-number')).color}
 })
 report.geometry.push({key,...g})
 check(key+' no horizontal overflow',g.scroll<=g.width,g.scroll)
 const backgrounds=['rgb(245, 248, 253)','rgb(230, 236, 247)']
 check(key+' all rendered UI text >=4.5:1',g.textColours.every(c=>backgrounds.every(b=>contrast(c,b)>=4.5)),g.textColours)
 check(key+' key quantity >=7:1',backgrounds.every(b=>contrast(g.numberColour,b)>=7),g.numberColour)
 check(key+' no label collisions',g.overlaps.length===0,g.overlaps)
 check(key+' annotations above plot',g.annotations.every(a=>a.bottom<g.plotTop-4),g.annotations)
 if(g.runout)check(key+' run-out leader is one-pixel red',g.runout.leader&&g.runout.stroke==='rgb(180, 35, 24)'&&g.runout.width==='1',g.runout)
 check(key+' Arctic surfaces',g.bg.every(([,c])=>c==='rgb(245, 248, 253)'),g.bg)
 check(key+' SVG not canvas',g.canvas===0,g.canvas)
 check(key+' full-opacity historical fill and unfilled forecast outlines',g.bars.every(([f,s,o,p])=>f===(p==='forecast'?'none':'rgb(174, 184, 202)')&&s==='rgb(91, 98, 116)'&&o==='1'),g.bars)
 if(phone){check(key+' max three months',g.months<=3,g.months);check(key+' no long receipt leaders',g.receipts===0,g.receipts);check(key+' no touch hint',g.hint==='none',g.hint)}
}
async function main(){
 fs.mkdirSync(out,{recursive:true})
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined})
 try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const phone=viewport.width===390,size=`${viewport.width}x${viewport.height}`,context=await browser.newContext({viewport,isMobile:phone,hasTouch:phone,deviceScaleFactor:1,reducedMotion:'reduce'})
  await context.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(pathToFileURL(path.join(__dirname,'stock-runway.html')).href+'#sku=UL-FOAM-GRN');await page.waitForSelector('svg[data-chart]');await settle(page)
  const initial=await page.locator('.sku-button[aria-pressed=true]').getAttribute('data-sku')
  const image=path.join(out,`ship-gm-b-${size}.png`);await page.screenshot({path:image});report.screenshots.push(image)
  await geometry(page,size+' initial',phone)
  check(size+' logo height',Math.round(await page.locator('.gm-logo').evaluate(e=>e.getBoundingClientRect().height))===14)
  check(size+' no text wordmark',await page.locator('.gm-wordmark').count()===0)
  check(size+' snapshot-relative date',(await page.locator('.date-relative').first().textContent())==='In 42 days')
  const skus=await page.locator('.sku-button').evaluateAll(es=>es.map(e=>e.dataset.sku))
  for(const sku of skus){
   await page.evaluate(s=>location.hash='sku='+encodeURIComponent(s),sku);await page.waitForFunction(s=>document.body.dataset.selectedSku===s,sku)
   for(const zoom of ['6','12','24','all']){await page.locator(`[data-zoom="${zoom}"]`).click();await settle(page);await geometry(page,`${size}:${sku}:${zoom}`,phone)}
  }
  await page.evaluate(s=>location.hash='sku='+encodeURIComponent(s),initial);await page.waitForFunction(s=>document.body.dataset.selectedSku===s,initial)
  await page.locator('[data-zoom="12"]').click();await settle(page)
  // Use the actual retained marker focus hook, not a fabricated tooltip.
  await page.locator('[data-delivery-marker]').first().focus();await page.waitForSelector('.chart-tooltip:not([hidden])')
  const tip=path.join(out,`premium-gm-b-${size}-tooltip.png`);await page.screenshot({path:tip});report.screenshots.push(tip)
  const tooltip=await page.locator('.chart-tooltip').boundingBox();check(size+' tooltip inside viewport',tooltip.x>=0&&tooltip.x+tooltip.width<=viewport.width&&tooltip.y+tooltip.height<=viewport.height,tooltip)
  await page.keyboard.press('Escape');check(size+' Escape hides tooltip',await page.locator('.chart-tooltip').isHidden())
  await context.close()
 }
 // Explicit synthetic future-receipt fixture covers the optional phone Arrives
 // label; real sample inputs/forecast files are never modified.
 const probe=path.join(out,'arctic-arrival-probe.html')
 const html=fs.readFileSync(path.join(__dirname,'design/option-gm-b.html'),'utf8')
 fs.writeFileSync(probe,html.replace('</script>','\nwindow.arcticFixture=()=>{const item=structuredClone(currentRows[0].item);item.projection[0].receipts=100;return inventorySvg(item,data.months,358,null,null,220).svg};\n</script>'))
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
 const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(String(e)))
 await ctx.route(/^https?:/,r=>{report.network.push(r.request().url());return r.abort()})
 await p.goto(pathToFileURL(probe).href+'#sku=UL-FOAM-GRN');await p.waitForFunction(()=>window.arcticFixture)
 await settle(p);await p.evaluate(()=>document.querySelector('.chart-wrap').replaceChildren(window.arcticFixture()))
 await geometry(p,'390x844 synthetic monthly arrival',true)
 check('phone monthly arrival label is tooltip-only',await p.locator('[data-gm-receipt-label]').count()===0)
 check('optional monthly arrival retains exact accessible quantity',await p.locator('[data-delivery-marker][data-quantity="100"]').count()===1)
 await ctx.close()
 check('no runtime errors',report.errors.length===0,report.errors);check('no external requests',report.network.length===0,report.network)
 report.status='PASS'
 }finally{await browser.close();fs.writeFileSync(path.join(out,'arctic-browser-report.json'),JSON.stringify(report,null,2)+'\n')}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
