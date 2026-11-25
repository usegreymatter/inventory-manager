// Lifecycle: living. Conservative clean-preview regression; no browser/storage permission bypass.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync('standalone/design/smart-import.js','utf8'),c=vm.createContext({})
vm.runInContext(source.slice(source.indexOf('function cleanImportCanApplyDirectly'),source.indexOf('const smartImportUI'))+'\nthis.clean=cleanImportCanApplyDirectly',c)
const state=()=>({parsed:{items:[{on_hand:10,on_order:0,supplier_days:14,monthly_sales:[10,10,10]}],import_report:{warnings:[],defaulted:[],rows_set_aside:[]}},choices:{units_confirmed:true},unitsReviewRequired:false,ack:false,report:{missing:[],warnings:[]},meaning:{requires_ack:false,warnings:[],reasons:[]}})
test('clean preview can apply directly only with previously confirmed units',()=>{
 assert.equal(c.clean(state()),true)
 const s=state();s.unitsReviewRequired=true;assert.equal(c.clean(s),false)
 s.unitsReviewRequired=false;s.choices.units_confirmed=false;assert.equal(c.clean(s),false)
})
test('every warning or acknowledgement preserves second confirmation',()=>{
 const mutations=[s=>s.ack=true,s=>s.error=Error('held'),s=>s.report.missing.push('sales'),s=>s.report.warnings.push('Check mapping'),s=>s.meaning.requires_ack=true,s=>s.meaning.warnings.push('Incoming unknown'),s=>s.meaning.reasons.push('Partial month'),s=>s.parsed.import_report.warnings.push('Preview warning'),s=>s.parsed.import_report.defaulted.push({field:'lead'}),s=>s.parsed.import_report.rows_set_aside.push({row:2}),s=>s.parsed.items[0].input_warnings=['Check dates'],s=>s.parsed.items[0].expiry_warnings=['Check expiry'],s=>s.parsed.items[0].lots=[{expiry_acknowledged:false}],s=>s.parsed.items[0].on_order=null,s=>delete s.parsed.items[0].supplier_days,s=>s.parsed.items[0].monthly_sales=[1,2],s=>s.parsed.items[0].monthly_sales=[1,null,2],s=>s.parsed.items=[]]
 for(const mutate of mutations){const s=state();mutate(s);assert.equal(c.clean(s),false,String(mutate))}
})
test('Use this applies a clean preview directly and retains confirmation for risky or newly acknowledged previews',async()=>{
 const helper=source.slice(source.indexOf('function cleanImportCanApplyDirectly'),source.indexOf('const smartImportUI'))
 const finish=source.slice(source.indexOf('  async function finish(accepted=false){'),source.indexOf('  function cancelPending()'))
 for(const [name,mutate,direct]of [
  ['clean',()=>{},true],
  ['units acknowledged this import',s=>s.unitsReviewRequired=true,false],
  ['any preview warning',s=>s.report.warnings.push('Check this file'),false],
  ['edited workbook with risk acknowledgement',s=>{s.edit=true;s.ack=true;s.meaning.requires_ack=true},false],
  ['held row',s=>s.parsed.import_report.rows_set_aside.push({row:3}),false]
 ]){
  const pending=state();mutate(pending);let resolved=null,remembered=0
  Object.assign(pending,{stillCurrent:()=>true,file:{name:'synthetic.csv'},resolve:value=>resolved=value})
  const context=vm.createContext({pending,dialog:{open:false},remember:async()=>remembered++,retained:null})
  vm.runInContext(helper+finish+'\nthis.finish=finish',context);await context.finish(true)
  assert.equal(resolved?.parsed,pending.parsed,name);assert.equal(resolved?.smart,direct,name);assert.equal(remembered,1,name)
 }
})

test('update navigation is one exact normal anchor, with no automatic network hints',()=>{
 const html=fs.readFileSync('standalone/inventory-manager.html','utf8')
 const anchor='<a class="version-link" href="https://github.com/usegreymatter/inventory-manager/releases" target="_blank" rel="noopener noreferrer">Check for a newer version</a>'
 assert.equal(html.split(anchor).length,2)
 const offline=html.replace(anchor,'')
 assert.doesNotMatch(offline,/(?:src|href)\s*=\s*['"]\s*(?:https?:)?\/\//i)
 assert.doesNotMatch(html,/<link\b[^>]*rel\s*=\s*['"](?:prefetch|preconnect|dns-prefetch|prerender)/i)
 assert.doesNotMatch(html,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/)
 assert.match(html,/<small class="app-version">v1\.3\.0-beta<\/small>/)
})

test('large order explanation distinguishes the buying deadline from existing-stock forecast',()=>{
 const source=fs.readFileSync('standalone/design/presentation-gm-b.js','utf8'),c=vm.createContext({settings:{},bigOrderWarning:()=> 'Check this order: about 9.5 months of stock, much bigger than usual.'})
 vm.runInContext(source.slice(source.indexOf('function gmBBigOrderExplanation'),source.indexOf('const gmBPanel'))+'\nthis.explain=gmBBigOrderExplanation',c)
 const text=c.explain({})
 assert.match(text,/9\.5 months/)
 assert.match(text,/suggested order quantity divided by estimated monthly demand/)
 assert.match(text,/existing stock and recorded incoming supply; it excludes this suggested new order/)
 assert.match(text,/buying deadline is today or overdue/)
 assert.match(fs.readFileSync('standalone/design/product-page-gm-b.js','utf8'),/summary\.title=gmBBigOrderExplanation\(g\)/)
})

// Execute the actual parser, production preflight and Use this acceptance handler.
// The fixture mirrors the canonical clean.csv used by the parent's Chrome pass.
const cleanCsv='sku,name,unit,on_hand,supplier_days,on_order,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10\nA,Synthetic nuts,pieces,5,14,0,20,20,20,20,20,20\nB,Synthetic rice,kg,8,14,0,10,10,10,10,10,10\n'
function realImportHarness(){
 const desktop=fs.readFileSync('desktop/plugin.js','utf8'),context=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
 const core=desktop.slice(desktop.indexOf('const SAMPLE ='),desktop.indexOf('const pageStyle =')).replaceAll('export ','')
 const helpers=source.slice(source.indexOf('function cleanImportCanApplyDirectly'),source.indexOf('const smartImportUI'))
 const preflight=source.slice(source.indexOf('  function preflight(state){'),source.indexOf('  function draw(state){'))
 const finish=source.slice(source.indexOf('  async function finish(accepted=false){'),source.indexOf('  function cancelPending()'))
 vm.runInContext(core+`\nconst csv=(rows,delimiter=',')=>rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(delimiter)).join('\\r\\n')+'\\r\\n';
 const originalReview=reviewCsvInputMeaning;reviewCsvInputMeaning=(s,d,c)=>originalReview(s,d,c,'2026-11-24');
 let pending=null,retained=null;const dialog={open:false},remember=async()=>{};
 `+helpers+preflight+finish+`\nthis.real={make(text,options={}){
 const sheets=[{name:'CSV',rows:importRows(text,importDelimiter(text)),delimiter:importDelimiter(text)}],choices={units_confirmed:true,...options.choices};
 const state={sheets,sheet:'CSV',overrides:{},choices,unitsReviewRequired:options.unitsReviewRequired===true,ack:options.ack===true,legacyParsed:parseStockImport(text),report:understandStockWorkbook(sheets),stillCurrent:()=>true,file:{name:'synthetic.csv'},edit:false};
 preflight(state);return state;
 },async accept(state){let result;state.resolve=value=>result=value;pending=state;await finish(true);return result}}
 `,context)
 return context.real
}
test('actual canonical integer CSV imports with one Use this after units were already confirmed',async()=>{
 const api=realImportHarness(),s=api.make(cleanCsv)
 assert.equal(s.error,null);assert.equal(s.parsed.items.length,2)
 assert.ok(s.report.warnings.includes('CSV: Number format: decimal-dot; review numeric text conventions.'))
 assert.ok(s.parsed.import_report.warnings.includes('Number format: decimal-dot (dot decimal; comma thousands)'))
 const before=JSON.stringify(s.parsed),result=await api.accept(s)
 assert.equal(result?.smart,true,'Use this must skip import-check for this real clean preview')
 assert.equal(JSON.stringify(result.parsed),before,'informational notes and data remain intact')
})
test('real numeric conventions, defaults, holds, risks and first-time units retain confirmation',async()=>{
 const api=realImportHarness()
 for(const [name,text,options]of [
  ['first-time unit acknowledgement',cleanCsv,{unitsReviewRequired:true}],
  ['grouped comma text',cleanCsv.replace('pieces,5,','pieces,"1,234",')],
  ['three-digit dot convention',cleanCsv.replace('pieces,5,','pieces,1.234,')],
  ['decimal comma',cleanCsv.replaceAll(',',';').replace('pieces;5;','pieces;1,25;')],
  ['missing lead default',cleanCsv.replace('pieces,5,14,','pieces,5,,')],
  ['missing incoming',cleanCsv.replace('on_order,','').replaceAll(',14,0,',',14,')],
  ['held stock row',cleanCsv.replace('pieces,5,','pieces,,')],
  ['partial latest month',cleanCsv.replace('2026-05,2026-06,2026-07,2026-08,2026-09,2026-10','2026-06,2026-07,2026-08,2026-09,2026-10,2026-11'),{ack:true}]
 ]){
  const s=api.make(text,options),result=await api.accept(s)
  assert.notEqual(result?.smart,true,name)
 }
 const s=api.make(cleanCsv);s.report.warnings.push('CSV: Number format: decimal-dot; ambiguous number format detected.')
 assert.equal((await api.accept(s))?.smart,false,'an actual numeric warning must never be exempted by a prefix match')
})

test('desktop physical cells include the product unit while values stay numeric',()=>{
 const worklist=fs.readFileSync('standalone/design/worklist-gm-b.js','utf8')
 class Element{
  constructor(tag,text){this.tag=tag;this.children=[];this.dataset={};this._text=text??''}
  setAttribute(){} addEventListener(){}
  append(...values){for(const value of values)if(typeof value==='string')this._text+=value;else this.children.push(value)}
  set textContent(text){this._text=text;this.children=[]}
  get textContent(){return String(this._text)+this.children.map(c=>c.textContent).join('')}
 }
 const context=vm.createContext({node:(tag,text)=>new Element(tag,text),wlMeta:r=>r.meta,wlRank:{order:0},localOrderIncoming:i=>i.on_order,wl:{selected:new Set(),focus:0,drawer:false,phone:false},selectedSku:null,WL_NUMERIC:['hand','incoming','qty','lead','days','value'],wlVisible:()=>['hand','incoming','qty','lead','days','value'].map(key=>[key]),orderAmount:String,wlMoney:v=>'KD '+v})
 vm.runInContext(worklist.slice(worklist.indexOf('function wlValue('),worklist.indexOf('function wlCompare('))+worklist.slice(worklist.indexOf('function wlDecisionText('),worklist.indexOf('function wlReadStorage('))+worklist.slice(worklist.indexOf('function wlRow('),worklist.indexOf('function wlIndex('))+'\nthis.row=wlRow;this.value=wlValue',context)
 const row={bucket:'order',item:{sku:'A',name:'Synthetic nuts',unit:'pieces',on_hand:5,on_order:0},guidance:{quantity:12,lead_days:14},meta:{days:3,value:25}},before=JSON.stringify(row)
 const element=context.row(row,0),cells=Object.fromEntries(element.children.filter(c=>c.dataset.column).map(c=>[c.dataset.column,c]))
 for(const [key,text,value]of [['hand','5 pieces',5],['incoming','0 pieces',0],['qty','12 pieces',12]]){
  assert.equal(cells[key].textContent,text);assert.equal(cells[key].title,text);assert.equal(context.value(row,key),value)
 }
 assert.equal(cells.lead.textContent,'14 d');assert.equal(cells.days.textContent,'3');assert.equal(cells.value.textContent,'KD 25')
 assert.equal(JSON.stringify(row),before,'rendering leaves numeric source/guidance/export inputs unchanged')
})
