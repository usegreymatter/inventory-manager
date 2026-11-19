// Lifecycle: historical. Replay requires original development history (6dcda30).
// Not a fresh-export release gate; historical equality assertions remain frozen.
// Offline synthetic harness; never real Desktop or inventory proof.
// node docs/capture-stress.cjs --label baseline|final [--prepare-baseline]
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const label = process.argv[process.argv.indexOf('--label') + 1]
assert.ok(['baseline', 'final'].includes(label), 'Choose --label baseline or --label final')
const out = `.scratch/stress-${label}`
fs.mkdirSync(out, { recursive: true })
const results = [], failures = []
const report = { label, proof: 'Offline synthetic harness only, not real Desktop', base: '6dcda30',
  budget: { browserConcurrency: 1, timeCapSeconds: 900, sourceDebugCycles: 3 },
  zoomMethod: 'Half CSS viewport and double deviceScaleFactor; 200% browser-equivalent reflow, not device scale alone.',
  results, failures }
const write = () => fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n')
const check = (condition, name, evidence) => { if (!condition) failures.push({ name, evidence }) }
// Baseline 6dcda30 has status-label descendants but no data-runway-product attr.
// SDK segmented controls also have aria-pressed; they are not product rows.
const PRODUCT_ROWS = '[aria-label="Inventory items, soonest run-out first"] button[aria-pressed]:has([data-status-label])'
function prepareBaseline() {
  const base = execFileSync('git', ['show', '6dcda30:desktop/plugin.js'], { encoding: 'utf8' })
  fs.writeFileSync('.scratch/stress-baseline-plugin.js', base)
  fs.writeFileSync('.scratch/stress-baseline-entry.js', fs.readFileSync('docs/harness-entry.js', 'utf8')
    .replace('../desktop/plugin.js', './stress-baseline-plugin.js').replace('./sdk-shim.js', '../docs/sdk-shim.js')
    .replace('./stress-fixtures.mjs', '../docs/stress-fixtures.mjs'))
  const modules = path.dirname(path.dirname(process.env.PLAYWRIGHT_MODULE))
  execFileSync(path.join(modules, '.bin/esbuild'), ['.scratch/stress-baseline-entry.js', '--bundle', '--format=esm',
    '--alias:@hermes/plugin-sdk=./docs/sdk-shim.js', `--alias:react=${modules}/react/index.js`,
    `--alias:react-dom/client=${modules}/react-dom/client.js`, `--alias:react/jsx-runtime=${modules}/react/jsx-runtime.js`,
    '--outfile=.scratch/harness-baseline.bundle.js'], { stdio: 'inherit' })
}
function freezeToday() {
  const OriginalDate = Date
  window.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : ['2026-11-11T12:00:00'])) }
    static now() { return new OriginalDate('2026-11-11T12:00:00').getTime() }
  }
  window.runwayCaptureCaughtErrors = true
}
async function geometry(page) {
  return page.evaluate(productRows => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom } }
    const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'
    const overflowing = [...document.querySelectorAll('main p, main h2, main summary, main label, main input, main button, main strong, main small')]
      .filter(visible).filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
      .map(el => ({ tag:el.tagName, text:el.textContent.slice(0,180), client:el.clientWidth, scroll:el.scrollWidth, rect:rect(el) }))
    const graphemes = new Intl.Segmenter(undefined,{granularity:'grapheme'})
    const rows = [...document.querySelectorAll(productRows)].map(el => {
      const name=el.querySelector('strong'), nameText=name.textContent || '', nameBox=name.getBoundingClientRect(), rowBox=el.getBoundingClientRect()
      let nameFullyShown=false
      if(nameText) {
        const range=document.createRange();range.selectNodeContents(name)
        const glyphs=[...range.getClientRects()].filter(r=>r.width && r.height)
        nameFullyShown=glyphs.length>0 && name.scrollWidth<=name.clientWidth+1 && glyphs.every(r=>r.left>=Math.max(nameBox.left,rowBox.left)-1 && r.right<=Math.min(nameBox.right,rowBox.right)+1 && r.top>=Math.max(nameBox.top,rowBox.top)-1 && r.bottom<=Math.min(nameBox.bottom,rowBox.bottom)+1)
      }
      return { label:el.getAttribute('aria-label'), rect:rect(el), name:rect(name), nameText, nameGraphemes:[...graphemes.segment(nameText)].length, nameFullyShown, badge:rect(el.querySelector('[data-status-label]')) }
    })
    return { width:innerWidth, pageWidth:document.documentElement.scrollWidth, overflowing, rows,
      buckets:[...document.querySelectorAll('[data-bucket]')].map(el=>({bucket:el.dataset.bucket,text:el.textContent})),
      orderCount:document.querySelectorAll('[data-order-sku]').length }
  }, PRODUCT_ROWS)
}
function checkNameLayout(row,key) {
  if(row.nameGraphemes>40) check(row.name.width>=Math.min(96,row.rect.width*.45),'name-starved-by-badge',{key,row})
  else check(row.nameFullyShown,'short product name fully shown',{key,row})
}
async function numericGeometry(page) {
  return page.evaluate(() => {
    const errors=[], cells=[]
    for (const table of document.querySelectorAll('table')) {
      if (!table.getClientRects().length) continue
      for (const cell of table.querySelectorAll('td,th')) {
        const tokens=[];const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT)
        while(walker.nextNode()) {
          const node=walker.currentNode
          if(!node.parentElement.getClientRects().length) continue
          const text=node.textContent
          for(const match of text.matchAll(/[+−-]?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?/gi)) {
            const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length)
            const rs=[...range.getClientRects()].filter(r=>r.width && r.height), box=cell.getBoundingClientRect()
            const token={text:match[0],lines:new Set(rs.map(r=>Math.round(r.y))).size,inside:rs.every(r=>r.x>=box.x-1 && r.right<=box.right+1)}
            tokens.push(token)
            if(token.lines>1 || !token.inside) errors.push({kind:'numeric-token',cell:cell.textContent,token})
          }
        }
        if(cell.scrollWidth>cell.clientWidth+1) errors.push({kind:'cell-overflow',text:cell.textContent,client:cell.clientWidth,scroll:cell.scrollWidth})
        cells.push({text:cell.innerText,accessible:cell.getAttribute('aria-label')||cell.innerText,title:cell.title,tokens})
      }
    }
    return {cells,errors}
  })
}
async function timelineReach(page, region) {
  return region.evaluate(region => {
    const failures=[], views=[]
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}}
    // The product timeline is LTR data even in an RTL host wrapper. For an RTL
    // region use native negative scrolling; record rather than hide occlusion.
    const rtl=getComputedStyle(region).direction==='rtl'
    for(const row of region.querySelectorAll('tr')) for(let c=1;c<row.cells.length;c++) {
      row.scrollIntoView({block:'center',inline:'nearest'});region.scrollLeft=0
      let month=rect(row.cells[0]),target=rect(row.cells[c]),box=rect(region)
      region.scrollLeft=rtl?-(month.left-target.right):target.left-month.right
      month=rect(row.cells[0]);target=rect(row.cells[c]);box=rect(region)
      const fits=target.left>=box.left-1 && target.right<=box.right+1
      const beside=rtl?target.right<=month.left+1:target.left>=month.right-1
      const view={month,target,region:box,scrollLeft:region.scrollLeft,column:c,text:row.cells[c].innerText,fits,beside}
      views.push(view)
      if(!fits || !beside) failures.push(view)
    }
    return {views,failures}
  })
}
async function focusEvidence(page) {
  const result=[]
  for(const scope of ['product','chip']) for(const selected of ['true','false']) {
    const selector=scope==='product' ? PRODUCT_ROWS : '[aria-label="Product filters"] button[data-bucket]'
    const row=page.locator(`${selector}[aria-pressed="${selected}"]`).first()
    assert.equal(await row.count(),1,`${scope} ${selected}: keyboard focus target required`)
    await row.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
    result.push({scope,keys:['Tab','Shift+Tab'],...await row.evaluate(el=>{const s=getComputedStyle(el);return {selected:el.getAttribute('aria-pressed'),focused:el===document.activeElement,focusVisible:el.matches(':focus-visible'),outline:s.outline,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,shadow:s.boxShadow,inlineShadow:el.style.boxShadow,blue:getComputedStyle(document.documentElement).getPropertyValue('--ui-blue').trim()}})})
    const theme=await page.evaluate(()=>document.documentElement.dataset.theme)
    await row.screenshot({path:`${out}/focus-${theme}-${scope}-${selected}.png`})
  }
  return result
}
async function bulkReachEvidence(page, key) {
  const results=[]
  const targets=[{kind:'order-1000',rows:page.locator('[data-order-sku]'),index:999,count:1000},
    {kind:'browser-50',rows:page.locator(PRODUCT_ROWS),index:49,count:50}]
  for(const {kind,rows,index,count} of targets) {
    assert.equal(await rows.count(),count,`${kind}: preserve complete order list / capped browser`)
    const row=rows.nth(index)
    const sku=await row.evaluate(el=>el.dataset.orderSku || el.querySelector('small').textContent)
    const measure=()=>row.evaluate(el=>{
      const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}
      let scroller=el.parentElement
      while(scroller && !(scroller.scrollHeight>scroller.clientHeight && ['auto','scroll'].includes(getComputedStyle(scroller).overflowY))) scroller=scroller.parentElement
      if(!scroller) throw Error('Bulk row has no native scroll container')
      return {row:rect(el),scroller:rect(scroller),scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,width:innerWidth,height:innerHeight,focused:el===document.activeElement}
    })
    const before=await measure()
    // Native scrolling only: no layout, data or style substitutions.
    await row.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}))
    await row.focus()
    const reached=await measure(), evidence={kind,sku,before,reached,selectionKey:'Enter'}
    results.push(evidence)
    check(reached.scrollTop>before.scrollTop && reached.scrollTop>0,'bulk native container scrolled',evidence)
    check(reached.row.top>=reached.scroller.top-1 && reached.row.bottom<=reached.scroller.bottom+1 && reached.row.left>=reached.scroller.left-1 && reached.row.right<=reached.scroller.right+1,'bulk row fully reachable inside scroll container',evidence)
    check(reached.row.top>=0 && reached.row.bottom<=reached.height && reached.row.left>=0 && reached.row.right<=reached.width && reached.focused,'bulk row focused inside viewport',evidence)
    evidence.screenshot=`${out}/${key}-${kind}-reached.png`
    await page.screenshot({path:evidence.screenshot})
    await page.keyboard.press('Enter')
    await page.waitForFunction(sku=>document.querySelector('section[aria-label="Selected item forecast"] h2')?.textContent.endsWith(` · SKU ${sku}`),sku)
    evidence.selectedHeading=await page.locator('section[aria-label="Selected item forecast"] h2').innerText()
    check(evidence.selectedHeading.endsWith(` · SKU ${sku}`),'bulk keyboard selection updates detail',evidence)
    evidence.selectionScreenshot=`${out}/${key}-${kind}-selected.png`
    await page.locator('section[aria-label="Selected item forecast"]').screenshot({path:evidence.selectionScreenshot})
  }
  return results
}
async function shortageContrast(page) {
  return page.evaluate(() => {
    const canvas=document.createElement('canvas').getContext('2d',{willReadFrequently:true})
    const rgba=css=>{canvas.clearRect(0,0,1,1);canvas.fillStyle=css;canvas.fillRect(0,0,1,1);return [...canvas.getImageData(0,0,1,1).data].map(v=>v/255)}
    const over=(fg,bg)=>{const a=fg[3]+bg[3]*(1-fg[3]);return [...fg.slice(0,3).map((v,i)=>(v*fg[3]+bg[i]*bg[3]*(1-fg[3]))/a),a]}
    const luminance=rgb=>rgb.slice(0,3).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
    return [...document.querySelectorAll('main small, main p, main span')].filter(el=>el.getClientRects().length && /^Short from /i.test(el.textContent) && !el.children.length).map(el=>{
      const layers=[];for(let p=el;p;p=p.parentElement) layers.push(rgba(getComputedStyle(p).backgroundColor))
      const bg=layers.reverse().reduce((bg,fg)=>over(fg,bg),[1,1,1,1]),color=getComputedStyle(el).color,fg=over(rgba(color),bg),x=luminance(fg),y=luminance(bg)
      return {text:el.textContent,color,background:bg,ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05),minimum:4.5}
    })
  })
}
async function main() {
  assert.ok(process.env.PLAYWRIGHT_MODULE, 'Use existing PLAYWRIGHT_MODULE; never install')
  const {expandStressFixtures}=await import('./stress-fixtures.mjs')
  const fixtures=expandStressFixtures(JSON.parse(fs.readFileSync('tests/fixtures/visual-stress.json','utf8')))
  if(process.argv.includes('--prepare-baseline')) prepareBaseline()
  if(process.argv.includes('--prepare-only')) { console.log('Prepared immutable 6dcda30 baseline bundle; no browser launched.'); return }
  const current=fs.readFileSync('desktop/plugin.js','utf8'), base=execFileSync('git',['show','6dcda30:desktop/plugin.js'],{encoding:'utf8'})
  assert.equal(current.slice(0,current.indexOf('const pageStyle =')),base.slice(0,base.indexOf('const pageStyle =')))
  for(const file of ['engine.py','sources.py','tools.py','data/sample.json','AGENTS.md']) execFileSync('git',['diff','--exit-code','6dcda30','--',file],{stdio:'pipe'})
  report.protectedBytesUnchanged=true
  if(process.argv.includes('--check-only')) {
    const evidence={status:'SOURCE_ONLY',protectedBytesUnchanged:true,browserRun:false,
      fixtureCounts:Object.fromEntries(Object.entries(fixtures).map(([key,value])=>[key,value.items.length]))}
    fs.writeFileSync('.scratch/stress-source-check.json',JSON.stringify(evidence,null,2)+'\n')
    console.log(JSON.stringify(evidence));return
  }
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE)
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--disable-background-networking','--disable-telemetry','--no-first-run']})
  const start=Date.now()
  try {
    const configs=[]
    for(const width of [320,360,390,720,752,1440]) for(const theme of ['light','dark']) for(const zoom of [1,2]) configs.push({width,theme,zoom,data:'worst'})
    for(const data of ['demo','empty','one','thousand','future']) for(const theme of ['light','dark']) configs.push({width:390,theme,zoom:1,data})
    configs.push({width:320,theme:'dark',zoom:1,data:'worst',dir:'rtl'})
    for(const config of configs) {
      assert.ok(Date.now()-start<900000,'15 minute run cap exceeded; do not automatically retry')
      const context=await browser.newContext({viewport:{width:Math.floor(config.width/config.zoom),height:1000},deviceScaleFactor:config.zoom})
      await context.route(/^https?:/,route=>{failures.push({name:'external-network-attempt',url:route.request().url()});return route.abort()})
      await context.addInitScript(freezeToday)
      try {
        const page=await context.newPage(), errors=[]
        page.on('pageerror',e=>errors.push(e.message))
        page.on('console',m=>{if(m.type()==='error' && !m.text().includes('Could not calculate this dataset')) errors.push(m.text())})
        const key=`${config.data}-${config.width}-${config.theme}-zoom${config.zoom}${config.dir?'-rtl':''}`
        const url=pathToFileURL(path.resolve('docs/harness.html'));url.search=new URLSearchParams({theme:config.theme,data:config.data,dir:config.dir||'ltr',...(label==='baseline'?{build:'baseline'}:{})}).toString()
        await page.goto(url.href)
        await page.waitForFunction(()=>window.runwayTest && (document.querySelector('main') || document.querySelector('[role="alert"]')))
        const item={...config,key,errors,screenshots:[]};results.push(item)
        if(fixtures[config.data]) {
          const stored=await page.evaluate(()=>JSON.stringify(window.runwayTest.ctx.storage.get('csv_data',null)))
          const expected=JSON.stringify(fixtures[config.data])
          item.fixtureSHA256=createHash('sha256').update(stored).digest('hex')
          check(stored===expected,'expanded fixture entered storage unchanged',{key,actualSHA256:item.fixtureSHA256,expectedSHA256:createHash('sha256').update(expected).digest('hex')})
        }
        await page.screenshot({path:`${out}/${key}-initial.png`,fullPage:true});item.screenshots.push(`${out}/${key}-initial.png`)
        if(config.data==='empty') {
          item.recovery=await page.getByRole('button',{name:'Back to sample data',exact:true}).count()
          check(item.recovery===1,'empty recovery',key);continue
        }
        await page.waitForFunction(()=>{
          const toolbar=document.querySelector('.stress-controls')
          return parseFloat(getComputedStyle(document.body).paddingBottom)>=toolbar.getBoundingClientRect().height
        })
        const advanced=page.locator('[data-advanced-settings]');await advanced.locator('summary').click()
        item.developerChrome=await advanced.locator('summary').evaluate(summary=>{
          const toolbar=document.querySelector('.stress-controls').getBoundingClientRect(),target=summary.getBoundingClientRect()
          const hit=document.elementFromPoint(target.left+target.width/2,target.top+target.height/2)
          return {toolbarHeight:toolbar.height,toolbarTop:toolbar.top,reservedBottom:parseFloat(getComputedStyle(document.body).paddingBottom),summaryBottom:target.bottom,unobstructed:!!hit && summary.contains(hit)}
        })
        check(item.developerChrome.reservedBottom>=item.developerChrome.toolbarHeight && item.developerChrome.summaryBottom<=item.developerChrome.toolbarTop && item.developerChrome.unobstructed,'developer toolbar does not cover Advanced', {key,...item.developerChrome})
        item.geometry=await geometry(page)
        check(item.geometry.pageWidth<=item.geometry.width+1,'page-overflow',{key,...item.geometry})
        check(!item.geometry.overflowing.length,'text-overflow',{key,elements:item.geometry.overflowing})
        for(const row of item.geometry.rows) checkNameLayout(row,key)
        if(config.data==='thousand') {
          check(item.geometry.orderCount===1000,'1000 order-now rows',item.geometry)
          item.bulkReach=await bulkReachEvidence(page,key)
          item.screenshots.push(...item.bulkReach.flatMap(row=>[row.screenshot,row.selectionScreenshot]))
        }
        item.shortageContrast=await shortageContrast(page)
        if(config.data==='worst') check(item.shortageContrast.length>0,'shortage contrast nonvacuous',key)
        for(const c of item.shortageContrast) check(c.ratio>=c.minimum,'shortage amber AA contrast',{key,...c})
        const detail=page.locator('section[aria-label="Selected item forecast"]')
        if(await detail.locator('figure').count()) {
          const summary=detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'});await summary.click()
          item.numeric=await numericGeometry(page);check(!item.numeric.errors.length,'table numeric integrity',{key,errors:item.numeric.errors})
          const region=detail.locator('[role="region"][aria-label="Month by month: stock, sales, deliveries"]')
          item.timelineReach=await timelineReach(page,region);check(!item.timelineReach.failures.length,'timeline cells reachable beside Month',{key,failures:item.timelineReach.failures})
          await region.evaluate(el=>{el.scrollLeft=el.scrollWidth})
          await region.screenshot({path:`${out}/${key}-table-stock.png`});item.screenshots.push(`${out}/${key}-table-stock.png`)
          await detail.locator('figure').screenshot({path:`${out}/${key}-chart.png`});item.screenshots.push(`${out}/${key}-chart.png`)
        }
        await advanced.screenshot({path:`${out}/${key}-settings.png`});item.screenshots.push(`${out}/${key}-settings.png`)
        // Selection also crosses the real storage/calculation boundary: no DOM
        // values or styles are edited to manufacture or repair a failure.
        if(config.data==='worst') {
          const skus=config.width===390 && config.zoom===1 ? fixtures.worst.items.map(row=>row.sku)
            : fixtures.worst.items.filter(row=>row.sku.startsWith('METRIC') || row.sku.startsWith('NEGATIVE')).map(row=>row.sku)
          item.products=[]
          for(const sku of skus) {
            const escaped=sku.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
            const row=page.locator(PRODUCT_ROWS).and(page.getByRole('button',{name:new RegExp(` · ${escaped} · `)}))
            await row.focus();await row.press('Enter')
            await page.waitForFunction(sku=>document.querySelector('section[aria-label="Selected item forecast"] h2')?.textContent.endsWith(` · SKU ${sku}`),sku)
            const product={sku,geometry:await geometry(page)};item.products.push(product)
            check(product.geometry.pageWidth<=product.geometry.width+1,'selected product page overflow',{key,sku,geometry:product.geometry})
            if(await detail.locator('figure').count()) {
              const disclosure=detail.locator('summary').filter({hasText:'Month by month: stock, sales, deliveries'})
              const isOpen=await disclosure.evaluate(el=>el.parentElement.open)
              if(!isOpen) await disclosure.click()
              product.numeric=await numericGeometry(page)
              check(!product.numeric.errors.length,'selected table numeric integrity',{key,sku,errors:product.numeric.errors})
              const region=detail.locator('[role="region"][aria-label="Month by month: stock, sales, deliveries"]')
              product.timelineReach=await timelineReach(page,region)
              check(!product.timelineReach.failures.length,'selected timeline cells reachable',{key,sku,failures:product.timelineReach.failures})
            }
            const file=`${out}/${key}-product-${item.products.length}.png`
            await detail.screenshot({path:file});item.screenshots.push(file)
          }
        }
        if(config.data==='worst' && config.width===390 && config.zoom===1) {
          item.focus=await focusEvidence(page)
          check(item.focus.length===4,'selected/unselected products and chips focus nonvacuous',key)
          for(const f of item.focus) check(f.focused && f.focusVisible && (f.outlineStyle!=='none' && parseFloat(f.outlineWidth)>=2 || f.shadow!==f.inlineShadow && /0px 0px 0px 3px/.test(f.shadow)),'keyboard focus ring',f)
        }
        if(config.data==='worst' && config.width===390 && config.zoom===1 && config.theme==='light') {
          item.settings=[]
          for(const [id,valid,invalid,optional] of [['default-delivery-days','3650','3651',true],['months-of-cover','36','37',false],['overstock-threshold','120','121',false],['urgent-window','3650','3651',false],['running-low-window','3650','3651',false],['product-minimum-order','1000000000000','1000000000001',true],['product-pack-size','0.000001','0.0000001',true]]) {
            const input=page.locator(`#order-setting-${id}`)
            await input.fill(valid);await input.blur()
            check(await input.getAttribute('aria-invalid')==='false','valid extreme setting',id)
            const saved=await page.evaluate(()=>JSON.stringify(window.runwayTest.ctx.storage.get('order_settings',{})))
            for(const value of [invalid,'-1','invalid']) {
              await input.fill(value);await input.blur()
              const state=await input.evaluate(el=>({draft:el.value,invalid:el.getAttribute('aria-invalid')}));item.settings.push({id,...state})
              check(state.invalid==='true','settings invalid draft',state)
              check(await page.evaluate(()=>JSON.stringify(window.runwayTest.ctx.storage.get('order_settings',{})))===saved,'invalid draft retains saved settings',{id,value})
            }
            await input.fill('');await input.blur()
            check(await input.getAttribute('aria-invalid')===(optional?'false':'true'),'blank setting semantics',id)
            // Restore a valid value before continuing to another field.
            await input.fill(valid);await input.blur()
          }
          await page.locator('input[type="search"]').fill('no-such-synthetic-product')
          check(await page.getByText('No matching products.',{exact:true}).count()===1,'search empty browser',key)
        }
        check(!errors.length,'browser errors',{key,errors})
        write()
      } finally {await context.close()}
    }
    // Continuous resize in both directions around the chart card thresholds.
    const context=await browser.newContext({viewport:{width:440,height:1000}})
    await context.route(/^https?:/,r=>r.abort());await context.addInitScript(freezeToday)
    try {
      const page=await context.newPage()
      await page.goto(pathToFileURL(path.resolve('docs/harness.html')).href+`?data=one${label==='baseline'?'&build=baseline':''}`)
      await page.locator('figure').waitFor();report.resize=[]
      for(const width of [...Array.from({length:101},(_,i)=>350+i),...Array.from({length:101},(_,i)=>450-i)]) {
        await page.setViewportSize({width,height:1000})
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
        const samples=[]
        for(let n=0;n<4;n++) {samples.push(await page.locator('figure').evaluate(el=>({content:el.clientWidth-parseFloat(getComputedStyle(el).paddingLeft)-parseFloat(getComputedStyle(el).paddingRight),padding:getComputedStyle(el).paddingLeft})));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)))}
        check(new Set(samples.map(s=>s.padding)).size===1,'chart hysteresis flicker',{width,samples});report.resize.push({width,samples})
      }
    } finally {await context.close()}
  } finally {await browser.close()}
  report.status=failures.length?'FAIL':'PASS';write()
  console.log(JSON.stringify({label,status:report.status,configurations:results.length,failures:failures.length,report:`${out}/report.json`}))
  if(failures.length) process.exitCode=1
}
main().catch(error=>{report.status='BLOCKED';report.error=error.stack;write();console.error(error.stack);process.exitCode=1})
