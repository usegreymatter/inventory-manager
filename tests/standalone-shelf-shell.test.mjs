import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {webcrypto} from 'node:crypto'

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8')
const descendants=root=>[root,...root.children.flatMap(descendants)]
// Logic-only DOM: HTML sinks throw, so hostile names/dates must remain text.
class Element {
  constructor(tag='div',text='',cls=''){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.events={};this.className=cls;this._text=text??'';this.hidden=false;this.checked=false;this.disabled=false;this.value='';this.classList={add(){},remove(){}}}
  set innerHTML(_){assert.fail('shell must never interpolate HTML')}
  set textContent(value){this.children=[];this._text=String(value??'')}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}
  append(...nodes){for(let node of nodes){if(typeof node==='string')node=new Element('#text',node);node.remove();node.parentElement=this;this.children.push(node)}}
  prepend(...nodes){this.append(...nodes);this.children=[...nodes,...this.children.filter(n=>!nodes.includes(n))]}
  before(...nodes){const p=this.parentElement,index=p.children.indexOf(this);for(const n of nodes)n.remove();p.children.splice(index,0,...nodes);for(const n of nodes)n.parentElement=p}
  after(...nodes){const p=this.parentElement,index=p.children.indexOf(this)+1;for(const n of nodes)n.remove();p.children.splice(index,0,...nodes);for(const n of nodes)n.parentElement=p}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null}
  replaceChildren(...nodes){for(const n of this.children)n.parentElement=null;this.children=[];this._text='';this.append(...nodes)}
  setAttribute(key,value){this.attrs[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value)}
  getAttribute(key){return this.attrs[key]??null}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn)}
  async dispatch(name){for(const fn of this.events[name]||[])await fn({target:this,preventDefault(){}})}
  matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('[')){const key=selector.slice(1,-1);return key.startsWith('data-')?Object.hasOwn(this.dataset,key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())):Object.hasOwn(this.attrs,key)}return this.tagName===selector.toUpperCase()}
  querySelectorAll(selector){return descendants(this).slice(1).filter(n=>selector.split(',').some(s=>n.matches(s.trim())))}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  contains(node){return descendants(this).includes(node)}
  get isConnected(){return !!this.parentElement||this.tagName==='BODY'}
  showModal(){this.open=true}
  close(){this.open=false}
  focus(){}
}
function dom(){const body=new Element('body');return {body,activeElement:null,createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text),createComment:()=>new Element('#comment'),getElementById:id=>descendants(body).find(n=>n.id===id)||null,querySelector:s=>body.querySelector(s),querySelectorAll:s=>body.querySelectorAll(s),addEventListener(){}}}
const malicious='<img src=x onerror=alert(1)>'

// Stress repairs are UI-only: exercise the actual importer and row renderer.
function stressCore(document){
  const core=read('desktop/plugin.js'),ctx=vm.createContext({document,TextEncoder,TextDecoder,atob,btoa,crypto:webcrypto,localStorage:{getItem:()=>null},readStockFile:async file=>file.text})
  const status=new Element('p');status.id='source-status';document.body.append(status)
  vm.runInContext(core.slice(core.indexOf('const SAMPLE ='),core.indexOf('const pageStyle =')).replaceAll('export ','')+'\n'+read('standalone/design/smart-import.js')+'\nthis.api={loadStockImport,parseStockImport,reviewCsvInputMeaning,attachInputMeaning,importRows,fileWideInputWarnings}',ctx)
  return ctx
}
for(const header of ['Ref','Article No','Prodcut Code'])test(`browser import names candidate ${header} and leaves the dataset untouched`,async()=>{
  const ctx=stressCore(dom()),text=header+',Name,On Hand,2026-08,2026-09,2026-10\nA-1,Widget,5,1,1,1\nA-2,Gadget,7,2,2,2\n'
  const dataset=ctx.api.parseStockImport('sku,name,on_hand,2026-08,2026-09,2026-10\nOLD,Previous,10,1,1,1\n'),before=JSON.stringify(dataset)
  ctx.data=dataset
  await assert.rejects(ctx.api.loadStockImport({name:'synthetic.csv',size:text.length,text,arrayBuffer:async()=>new TextEncoder().encode(text).buffer}),e=>e.message===`Could not find a product code column. Is '${header}' your product code? Rename it to 'sku' (or 'Item Code').`)
  assert.equal(ctx.data,dataset);assert.equal(JSON.stringify(dataset),before)
})
test('future-month warnings remain visible on every worklist row even when shared file-wide',()=>{
  const document=dom(),ctx=stressCore(document),text='sku,name,on_hand,2026-08,2026-09,2026-10,2026-11,2026-12,2027-01\nD0,Dated item 0,5,20,20,20,20,20,20\nD1,Dated item 1,7,20,20,20,20,20,20\n'
  const parsed=ctx.api.parseStockImport(text),review=ctx.api.reviewCsvInputMeaning([{name:'CSV',rows:ctx.api.importRows(text,','),delimiter:','}],parsed,{},'2026-11-23')
  const data=ctx.api.attachInputMeaning(parsed,review),warning='Sales dates are in the future. Dates may be shifted — check the sales period before ordering.'
  assert.ok(ctx.api.fileWideInputWarnings(data).has(warning),'shared warning is still deduplicated in the import summary')
  Object.assign(ctx,{data,wlMeta:()=>({}),node:(...args)=>new Element(...args),wlBtn:(text,fn,cls)=>new Element('button',text,cls),wl:{selected:new Set(),focus:0,phone:false,drawer:false},selectedSku:null,wlVisible:()=>[['product']],WL_NUMERIC:[],settings:{},bigOrderWarning:()=>'',localOrderPill:()=>null})
  const source=read('standalone/design/worklist-gm-b.js')
  vm.runInContext(source.slice(source.indexOf('function wlRow('),source.indexOf('function wlIndex('))+'\nthis.row=wlRow',ctx)
  for(const item of data.items){
    assert.ok(item.input_warnings.includes(warning))
    const element=ctx.row({item,guidance:{},bucket:'healthy'},0),marker=element.querySelector('[data-input-warning-marker]')
    assert.ok(marker,'future-dated '+item.sku+' needs a persistent row marker');assert.match(marker.textContent,/Input warnings?/);assert.equal(marker.dataset.inputWarningMarker,item.sku)
  }
  const clean=ctx.row({item:{sku:'C',name:'Clean'},guidance:{},bucket:'healthy'},0)
  assert.equal(clean.querySelector('[data-input-warning-marker]'),null)
})
test('Arabic template button and README identify browser-only headers and English CLI/MCP path',()=>{
  const source=read('standalone/design/first-run-gm-b.js'),ctx=vm.createContext({node:(...args)=>new Element(...args),wlBtn:(text,fn)=>new Element('button',text)})
  vm.runInContext(source.slice(source.indexOf('const firstRunTemplates='),source.indexOf('const firstRunAge='))+'\nthis.templates=firstRunTemplates',ctx)
  const arabic=ctx.templates.children.find(e=>e.id==='template-ar')
  assert.match(arabic.textContent,/browser app/i);assert.match(arabic.title,/CLI\/MCP.*English/i)
  assert.match(read('README.md'),/Arabic-header template.*browser app.*CLI\/MCP.*English template/)
})
const row=(sku='S',extra={})=>({item:{sku,name:malicious,unit:'units'},guidance:{quantity:0,capped:true,shelf_cap_qty:0,cap_reason:malicious,expiring:[{lot:malicious,expiry:'2026-12-01',qty:80,sell_through_qty:20,at_risk_qty:60,clear_by:'2026-11-25'},{lot:'sold',expiry:'2026-11-20',qty:20,sell_through_qty:20,at_risk_qty:0,clear_by:'2026-11-15'}],...extra}})
function shelfShell(rows=[row()]){
  const source=read('standalone/design/decision-simple-gm-b.js'),start=source.indexOf('// Shelf-life presentation')
  assert.ok(start>=0,'missing standalone shelf-life presentation adapter')
  const document=dom(),root=new Element('section'),summary=new Element('div'),overlay=new Element('section');root.append(summary);document.body.append(root,overlay)
  const ctx=vm.createContext({document,currentRows:rows,wlSummary:summary,productPage:{overlay},node:(...args)=>new Element(...args),orderAmount:String,wlBtn:(text,fn,cls)=>{const n=new Element('button',text,cls);n.addEventListener('click',fn);return n},$:id=>document.getElementById(id),buildList(){return 'built'},wlRenderRows(){},drawProductPage(){const figures=new Element('div','','product-page-figures');overlay.replaceChildren(figures)},chartPanel(){return new Element('section')},wlRow(){const e=new Element('div');e.append(new Element('small','','work-sku'));return e}})
  // Execute the complete additive adapter and its real wrapper hooks.
  vm.runInContext(source.slice(start).split('// Match device preference')[0]+'\nthis.api={buildList,wlRow,drawProductPage,chartPanel}',ctx)
  return {ctx,document,root,summary,overlay,api:ctx.api}
}
test('clearance uses shared guidance, sorts clear-by, excludes sell-through and renders hostile data as text',()=>{
  const early=row('E',{expiring:[{lot:'early',expiry:'2026-11-22',at_risk_qty:5,clear_by:'2026-11-20'}]})
  const a=shelfShell([row(),early]);assert.equal(a.api.buildList(),'built')
  const section=a.document.getElementById('shelf-clearance');assert.ok(section&&!section.hidden)
  assert.match(section.textContent,/Get rid of by/);assert.match(section.textContent,/commercial|Commercial/);assert.match(section.textContent,/not.*safety.*compliance/)
  const entries=section.querySelectorAll('li');assert.equal(entries.length,2);assert.match(entries[0].textContent,/2026-11-20/);assert.match(entries[1].textContent,/60 units/);assert.match(entries[1].textContent,/expiry 2026-12-01/);assert.ok(entries[1].textContent.includes(malicious));assert.equal(section.querySelector('img'),null)
  assert.equal(a.root.children.indexOf(section),a.root.children.indexOf(a.summary)+1)
  a.ctx.currentRows=[];a.api.buildList({controls:false});assert.ok(!a.document.getElementById('shelf-clearance')||a.document.getElementById('shelf-clearance').hidden,'fresh snapshot clears stale clearance')
})
test('capped zero is visibly marked in row, full product and side panel; off remains unmarked',()=>{
  const r=row(),a=shelfShell([r]),element=a.api.wlRow(r,0);assert.match(element.querySelector('[data-shelf-capped]')?.textContent||'',/Shelf-life capped.*0 units/)
  a.api.drawProductPage(r);assert.match(a.overlay.querySelector('[data-shelf-capped]')?.textContent||'',/0 units/);assert.ok(a.overlay.textContent.includes(malicious));assert.ok(a.overlay.querySelector('[data-clearance-list]'))
  const panel=a.api.chartPanel(r);assert.ok(panel.querySelector('[data-shelf-capped]'));assert.ok(panel.querySelector('[data-clearance-list]'))
  const off=row('OFF',{capped:false,expiring:[]});assert.equal(a.api.wlRow(off,0).querySelector('[data-shelf-capped]'),null);assert.equal(a.api.chartPanel(off).querySelector('[data-clearance-list]'),null)
})
test('clearance re-render and product navigation never duplicate sections or leak another SKU',()=>{
  const a=shelfShell();a.api.buildList();a.api.buildList();assert.equal(a.document.querySelectorAll('#shelf-clearance').length,1)
  a.api.drawProductPage(row());a.api.drawProductPage(row('OFF',{capped:false,expiring:[]}));assert.equal(a.overlay.querySelector('[data-shelf-capped]'),null);assert.equal(a.overlay.querySelector('[data-clearance-list]'),null)
})

function smartAcceptance({ack=false,requiresAck=true,current=true}={}){
  const source=read('standalone/design/smart-import.js'),start=source.indexOf('  async function finish(accepted=false){'),end=source.indexOf('  function cancelPending()',start)
  const parsed={items:[{sku:'A',lots:[{lot:'a',expiry:'2026-04-03',qty:1,expiry_acknowledged:false},{lot:'b',expiry:'2026-05-01',qty:1}]}]};let result='unresolved',remembered=0
  const ctx=vm.createContext({pending:{parsed,ack,meaning:{requires_ack:requiresAck},choices:{units_confirmed:true},stillCurrent:()=>current,resolve:r=>result=r,file:{}},dialog:{open:false},remember:async()=>remembered++,retained:null})
  vm.runInContext(source.slice(source.indexOf('function cleanImportCanApplyDirectly'),source.indexOf('const smartImportUI'))+source.slice(start,end)+'\nthis.finish=finish',ctx)
  return {parsed,ctx,result:()=>result,remembered:()=>remembered}
}
test('accepted import review acknowledges only previously ambiguous lot dates',async()=>{
  const a=smartAcceptance({ack:true});await a.ctx.finish(true);assert.equal(a.parsed.items[0].lots[0].expiry_acknowledged,true);assert.equal(a.parsed.items[0].lots[1].expiry_acknowledged,undefined);assert.equal(a.result().parsed,a.parsed);assert.equal(a.remembered(),1)
})
test('cancel, stale import and missing acknowledgement never unlock expiry dates',async()=>{
  for(const options of [{ack:false},{ack:true,current:false},{ack:false,requiresAck:false}]){const a=smartAcceptance(options);await a.ctx.finish(true);assert.equal(a.result(),null);assert.equal(a.parsed.items[0].lots[0].expiry_acknowledged,false);assert.equal(a.remembered(),0)}
  const a=smartAcceptance({ack:true});await a.ctx.finish(false);assert.equal(a.result(),null);assert.equal(a.parsed.items[0].lots[0].expiry_acknowledged,false)
})
test('stored layouts cannot automatically accept ambiguous expiry dates',()=>{
  const source=read('standalone/design/smart-import.js')
  assert.match(source,/if\(saved&&[^\n]*!.*expiry/i,'automatic reuse must explicitly guard unacknowledged expiry lots')
})
test('JSON/canonical preflight requires explicit expiry acknowledgement and preserves cancellation',async()=>{
  const document=dom(),error=new Element('p');error.id='file-error';document.body.append(error)
  const ctx=vm.createContext({document,node:(...args)=>new Element(...args),$:id=>document.getElementById(id),openSheet:dialog=>dialog.showModal()})
  vm.runInContext(read('standalone/design/import-gm-b.js')+'\nthis.confirm=confirmStockImport',ctx)
  const parsed={items:[{sku:malicious,lots:[{lot:malicious,expiry:'2026-04-03',qty:1,expiry_acknowledged:false}]}]}
  const waiting=ctx.confirm(parsed,{name:'synthetic.json'}),button=document.getElementById('import-check-confirm'),ack=document.getElementById('import-expiry-ack')
  assert.ok(ack,'JSON imports with ambiguous lot dates need an explicit review checkbox');assert.equal(button.disabled,true);assert.ok(document.body.textContent.includes('2026-04-03'));assert.equal(document.querySelector('img'),null)
  ack.checked=true;await ack.dispatch('change');assert.equal(button.disabled,false);await button.dispatch('click');assert.equal(await waiting,true);assert.equal(parsed.items[0].lots[0].expiry_acknowledged,true)
  const again={items:[{sku:'B',lots:[{lot:'b',expiry:'2026-05-04',qty:1,expiry_acknowledged:false}]}]},cancelled=ctx.confirm(again,{name:'next.json'})
  await document.getElementById('import-check-cancel').dispatch('click');assert.equal(await cancelled,false);assert.equal(again.items[0].lots[0].expiry_acknowledged,false)
})
test('real CSV review unlocks the shared engine only after acknowledgement and asks again on the same layout',async()=>{
  const document=dom(),status=new Element('p');status.id='source-status';document.body.append(status)
  const storage=new Map(),core=read('desktop/plugin.js'),ctx=vm.createContext({document,console,TextEncoder,TextDecoder,atob,btoa,crypto:webcrypto,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},readStockFile:async file=>file.text})
  vm.runInContext(core.slice(core.indexOf('const SAMPLE ='),core.indexOf('const pageStyle =')).replaceAll('export ','')+'\n'+read('standalone/design/smart-import.js')+'\nthis.api={loadStockImport,orderGuidance}',ctx)
  const file={name:'synthetic.csv',size:250,text:'sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10,lot,expiry date,lot quantity\nS,Synthetic,units,100,2,300,300,300,A,03/04/2027,100\n'}
  file.arrayBuffer=async()=>new TextEncoder().encode(file.text).buffer
  const review=async()=>{const promise=ctx.api.loadStockImport(file,()=>true);for(let n=0;n<100&&!document.getElementById('smart-import').open;n++)await new Promise(resolve=>setTimeout(resolve,5));return {promise}}
  const {promise}=await review();let units=document.getElementById('meaning-units');assert.ok(units);units.checked=true;await units.dispatch('change')
  assert.equal(document.getElementById('smart-import-use').disabled,true)
  let ack=document.getElementById('meaning-show-anyway');assert.ok(ack);assert.match(document.body.textContent,/2027-03-04/)
  ack.checked=true;await ack.dispatch('change');assert.equal(document.getElementById('smart-import-use').disabled,false)
  await document.getElementById('smart-import-use').dispatch('click');const result=await promise;assert.ok(result);assert.equal(result.parsed.items[0].lots[0].expiry_acknowledged,true)
  const item={...result.parsed.items[0],monthly_demand:300,as_of:result.parsed.as_of};assert.notEqual(ctx.api.orderGuidance(item,result.parsed.as_of,{}).status,'needs-data')
  const again=await review();assert.ok(document.getElementById('smart-import').open);assert.equal(document.getElementById('meaning-show-anyway').checked,false);assert.equal(document.getElementById('smart-import-use').disabled,true)
  await document.getElementById('smart-import-cancel').dispatch('click');assert.equal(await again.promise,null)
})
test('industry recipe leaves global shelf blank; explicit product settings cap without preset dependency',()=>{
  const core=read('desktop/plugin.js'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
  vm.runInContext(core.slice(core.indexOf('const SAMPLE ='),core.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={orderGuidance,previewIndustryPreset}',ctx)
  const item={sku:'S',name:'Synthetic',unit:'units',monthly_sales:[300,300,300],monthly_demand:300,seasonal:false,on_hand:0,supplier_days:0,receipts:{},as_of:'2026-10-31'}
  item.minimum_order=120 // Supplier MOQ exceeds this preset's 10-day usable window.
  const recipe=ctx.api.previewIndustryPreset({},'grocery').next
  assert.equal(Object.hasOwn(recipe,'shelf_life_days'),false)
  const settings={...recipe,product_overrides:{S:{shelf_life_days:14,arrival_age_days:2,min_remaining_life_days:2}}},g=ctx.api.orderGuidance(item,'2026-10-31',settings)
  assert.equal(g.capped,true);assert.ok(g.quantity<g.uncapped_qty);const withoutName={...settings};delete withoutName.industry_preset;assert.equal(ctx.api.orderGuidance(item,'2026-10-31',withoutName).quantity,g.quantity)
  const a=shelfShell([{item,guidance:g}]);assert.match(a.api.wlRow({item,guidance:g},0).textContent,/Shelf-life capped/)
})
test('large clearance ledgers are initially bounded and every lot is reachable',async()=>{
  const lots=Array.from({length:205},(_,n)=>({lot:String(n),expiry:'2026-12-01',at_risk_qty:1,clear_by:'2026-11-25'})),a=shelfShell([row('S',{expiring:lots})]);a.api.buildList();const section=a.document.getElementById('shelf-clearance'),more=section.querySelector('button');assert.equal(section.querySelectorAll('li').length,100);assert.equal(more.hidden,false);await more.dispatch('click');assert.equal(section.querySelectorAll('li').length,200);await more.dispatch('click');assert.equal(section.querySelectorAll('li').length,205);assert.equal(more.hidden,true)
})
test('preset shelf copy reflects active cap while retaining global scope and commercial warning',()=>{
  const source=read('standalone/design/settings-gm-b.js');assert.doesNotMatch(source,/Requires shelf-life engine support|once shelf-life engine support is integrated|when shelf-life support is active/)
  assert.match(source,/global shelf assumptions stay unchanged/i);assert.match(source,/not a safety\/compliance control/i);assert.match(source,/shelf-life.*cap|cap.*shelf-life/i)
})
test('shell CSS keeps clearance and cap text within narrow 390px layouts',()=>{
  const css=read('standalone/design/decision-simple-gm-b.css');assert.match(css,/\.shelf-clearance/);assert.match(css,/\.shelf-capped/);assert.match(css,/overflow-wrap\s*:\s*anywhere/);assert.match(css,/@media\s*\(max-width:\s*(?:480|600|640)px\)/)
})

test('smart import renderer counts physical omitted rows once across negative_stock and duplicate_sku channels',async()=>{
  const cases=[
    ['negative_stock','B,Negative,-1,1,2,3\n',1,false],
    ['duplicate_sku','A,Duplicate,8,1,2,3\nA,Duplicate again,9,1,2,3\n',2,false],
    ['warning_only','B,Negative,-1,1,2,3\n',1,true],
  ]
  for(const [name,extra,count,titleRow] of cases){
    const document=dom(),core=read('desktop/plugin.js'),ctx=vm.createContext({document,TextEncoder,TextDecoder,atob,btoa,crypto:webcrypto,localStorage:{getItem:()=>null},readStockFile:async file=>file.text})
    const status=new Element('p');status.id='source-status';document.body.append(status)
    vm.runInContext(core.slice(core.indexOf('const SAMPLE ='),core.indexOf('const pageStyle =')).replaceAll('export ','')+'\n'+read('standalone/design/smart-import.js')+'\nthis.api={loadStockImport,parseStockImport,understandStockWorkbook,importRows}',ctx)
    const text=(titleRow?'Synthetic stock report\n':'')+'sku,name,on_hand,2026-08,2026-09,2026-10\nA,Synthetic,5,1,2,3\n'+extra
    const report=ctx.api.understandStockWorkbook([{name:'CSV',rows:ctx.api.importRows(text,','),delimiter:','}])
    assert.equal(report.warnings.filter(w=>w.includes('row omitted')).length,count,name+' warning channel')
    if(!titleRow)assert.equal(ctx.api.parseStockImport(text).import_report.rows_set_aside.length,count,name+' structured channel')
    const promise=ctx.api.loadStockImport({name:name+'.csv',size:text.length,text,arrayBuffer:async()=>new TextEncoder().encode(text).buffer},()=>true)
    for(let n=0;n<100&&!document.getElementById('smart-import')?.open;n++)await new Promise(resolve=>setTimeout(resolve,5))
    assert.match(document.getElementById('smart-import-ready').textContent,new RegExp(` · ${count} rows set aside$`),name)
    const details=document.querySelectorAll('details').find(d=>d.querySelector('summary')?.textContent.startsWith('Rows set aside'))
    assert.ok(details,name+' disclosure exists even when closed')
    assert.equal(details.querySelectorAll('li').length,count,name+' list agrees with count')
    assert.equal(new Set(details.querySelectorAll('li').map(li=>li.textContent.match(/Row (\d+)/)?.[1])).size,count,name+' distinct physical rows')
    await document.getElementById('smart-import-cancel').dispatch('click');assert.equal(await promise,null)
  }
})
