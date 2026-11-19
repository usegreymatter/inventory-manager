// Lifecycle: living. Offline source-harness XSS/Chrome smoke; not rebuilt HTML.
// TMPDIR=$PWD/.scratch node scripts/stress-hostile-browser.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const executablePath=process.env.CHROME_BIN||undefined
const root=process.cwd(),scratch=path.join(root,'.scratch');fs.mkdirSync(scratch,{recursive:true})
const plugin=fs.readFileSync('desktop/plugin.js','utf8'),moduleSource=fs.readFileSync('desktop/smart-import.js','utf8'),uiSource=fs.readFileSync('standalone/design/smart-import.js','utf8')
const sha=text=>createHash('sha256').update(text).digest('hex')
let browser
const errors=[],network=[]
try{
  browser=await chromium.launch({executablePath,headless:true,ignoreDefaultArgs:['--no-sandbox'],timeout:30000})
  const context=await browser.newContext({serviceWorkers:'block'})
  await context.route('**/*',route=>{network.push(route.request().url());return route.abort()})
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><html><body><p id="source-status"></p><button id="trigger">Import</button></body></html>')
  await page.addScriptTag({content:plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')})
  await page.addScriptTag({content:fs.readFileSync('standalone/design/xlsx-gm-b.js','utf8')})
  await page.addScriptTag({content:uiSource})
  const started=Date.now()
  await page.evaluate(()=>{
    globalThis.__hostile=0
    const payload='<img src=x onerror="globalThis.__hostile=1">',sheet='<svg onload=__hostile=1>'
    const rows=[['sku','name','unit','on_hand','supplier_days','supplier','2026-01','2026-02','2026-03',payload],
      [payload,payload,'pcs',10,7,payload,1,2,3,payload]]
    const bytes=wlXlsxWorkbook([{name:sheet,rows}])
    const file=new File([bytes],payload+'.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    globalThis.__load=loadStockImport(file)
  })
  await page.locator('#smart-import[open]').waitFor({timeout:10000})
  assert.equal(await page.locator('#smart-import-use').isEnabled(),true,'malicious text stays importable data')
  assert.equal(await page.locator('#smart-import-preview td').first().textContent(),'<img src=x onerror="globalThis.__hostile=1">')
  await page.locator('#smart-import-change').click()
  assert.ok((await page.locator('#smart-import').textContent()).includes('<svg onload=__hostile=1>'),'sheet name rendered literally')
  assert.ok((await page.locator('#smart-import').textContent()).includes('<img src=x onerror="globalThis.__hostile=1">'),'header/filename rendered literally')
  assert.equal(await page.locator('#smart-import img,#smart-import svg,#smart-import script').count(),0)
  assert.equal(await page.evaluate(()=>globalThis.__hostile),0)
  await page.locator('#smart-import-cancel').click()
  assert.equal(await page.evaluate(()=>globalThis.__load),null,'cancel resolves without applying imported values')
  assert.deepEqual(errors,[]);assert.deepEqual(network,[],'no attacker payload or source causes network requests')
  // Real browser decompression + entity attack, using the production module.
  const importModule='data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64')
  const fixtures=['tests/fixtures/smart-import/arabic_headers.xlsx','tests/fixtures/smart-import/stored_mixed_cells.xlsx']
  for(const filename of fixtures){
    const bytes=Array.from(fs.readFileSync(filename))
    const count=await page.evaluate(async({module,bytes,filename})=>(await(await import(module)).readWorkbook(new Uint8Array(bytes),filename)).length,{module:importModule,bytes,filename})
    assert.ok(count>0)
  }
  const report={status:'PASS',browser:await browser.version(),executablePath,source_harness:true,generated_html_tested:false,
    checks:9+fixtures.length,positive_xlsx_fixtures:fixtures.length,network_requests:network.length,page_errors:errors.length,elapsed_ms:Date.now()-started,
    hashes:{plugin:sha(plugin),smart_module:sha(moduleSource),smart_ui:sha(uiSource)}}
  fs.writeFileSync(path.join(scratch,'stress-hostile-browser.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
}finally{if(browser)await browser.close()}
