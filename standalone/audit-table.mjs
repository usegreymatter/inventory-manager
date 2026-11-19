// Arctic computed typography, alignment, hit-target and screenshot audit.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),out=path.join(root,'.scratch/brand'),results=[];fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined});
try{for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
 const phone=viewport.width<1024,context=await browser.newContext({viewport,isMobile:phone,hasTouch:phone,deviceScaleFactor:1,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 await context.route(/^https?:/,r=>r.abort());page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(pathToFileURL(path.join(root,'standalone/design/option-gm-b.html')).href);await page.waitForSelector('#worklist');await page.evaluate(()=>document.fonts.ready);
 async function scan(state){return await page.evaluate(({phone,state})=>{
  const visible=e=>{if(e.closest('script,style,title,[hidden],.gm-logo'))return false;for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden')return false;if(p.tagName==='DETAILS'&&!p.open&&e!==p.querySelector('summary')&&!p.querySelector('summary')?.contains(e))return false;}return e.getClientRects().length>0;};
  const groups={header:'.topbar',worklist:'#worklist',main:'#hero',chart:'.chart-section',dialog:'dialog[open]'},regions={},offscale=[],smallTargets=[];
  for(const [name,selector]of Object.entries(groups)){
   if(!document.querySelector(selector))continue;
   const nodes=[...document.querySelector(selector).querySelectorAll('*')].filter(e=>visible(e)&&([...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||e.matches('input[placeholder]')));
   regions[name]={sizes:[...new Set(nodes.map(e=>getComputedStyle(e).fontSize))].sort(),weights:[...new Set(nodes.map(e=>getComputedStyle(e).fontWeight))].sort()};
   for(const e of nodes){const s=getComputedStyle(e);if(![12,14,16,20,48].includes(parseFloat(s.fontSize))||!['400','600'].includes(s.fontWeight))offscale.push({name,text:e.textContent.slice(0,80),size:s.fontSize,weight:s.fontWeight});}
  }
  if(phone)for(const e of document.querySelectorAll('button,input,select,summary,[role=button],.work-check')){if(!visible(e))continue;if(e.matches('input[type=checkbox]')&&e.closest('label')?.getBoundingClientRect().height>=44)continue;const r=e.getBoundingClientRect();if(r.width<43.9||r.height<43.9)smallTargets.push({tag:e.tagName,text:e.textContent.slice(0,50),w:r.width,h:r.height});}
  const rows=[...document.querySelectorAll('.work-row')].map(e=>e.getBoundingClientRect().height),chart=document.querySelector('.chart-section');
  return {state,regions,offscale,smallTargets,overflow:document.documentElement.scrollWidth>innerWidth,rows,chartBottom:chart&&visible(chart)?chart.getBoundingClientRect().bottom:null};
 },{phone,state})}
 const states=[await scan('table')];await page.screenshot({path:path.join(out,`audit-table-${viewport.width}.png`)});
 await page.locator('#filter-supplier>summary').click();states.push(await scan('filters'));await page.keyboard.press('Escape');
 await page.locator('.work-product').first().click();await page.waitForSelector('svg[data-chart]');states.push(await scan('drawer'));await page.screenshot({path:path.join(out,`audit-drawer-${viewport.width}.png`)});
 await page.locator('.about>summary').click();states.push(await scan('info'));
 const info=await page.locator('.about .detail-body').boundingBox();assert(info.x>=0&&info.x+info.width<=viewport.width,'Info stays inside drawer horizontally; drawer content scrolls vertically');
 await page.locator('.about>summary').click();await page.locator('.big-number').click();states.push(await scan('why'));await page.keyboard.press('Escape');
 await page.locator('#close-detail').click();await page.locator('#tools>summary').click();states.push(await scan('menu'));await page.locator('#open-settings').click();states.push(await scan('settings'));await page.locator('.settings-group>summary').click();states.push(await scan('settings-advanced'));await page.keyboard.press('Escape');
 results.push({viewport,errors,states});await context.close();
}
fs.writeFileSync(path.join(out,'premium-audit.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
assert(results.every(r=>!r.errors.length&&r.states.every(s=>!s.offscale.length&&!s.smallTargets.length&&!s.overflow&&s.rows.every(h=>h===(r.viewport.width<1024?104:64)))),'Computed type/hit target/row audit failed');
}finally{await browser.close()}
