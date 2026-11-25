import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createHash} from 'node:crypto'
import beforeV130 from './reviewed-v130-delta.cjs'
const read=p=>fs.readFileSync(p,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex'),delta=JSON.parse(read('tests/fixtures/v130-approved-delta.json'))
for(const [kind,file]of Object.entries(delta.files))test(`v1.3.0 ${kind}: exact reviewed spans retain baseline and unknown-byte detection`,()=>{
 const source=read(file)
 assert.equal(sha(beforeV130(source,kind)),delta.baseline_sha256[kind])
 for(const {after}of delta[kind])assert.throws(()=>beforeV130(source.replace(after,'UNKNOWN'+after.slice(1)),kind))
 assert.notEqual(sha(beforeV130(source+'\nUNKNOWN',kind)),delta.baseline_sha256[kind])
})
const plugin=read('desktop/plugin.js'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={understandStockWorkbook,reviewInputMeaning,parseStockImport,attachInputMeaning,validateDataset}',ctx)
const firstRun=read('standalone/design/first-run-gm-b.js')
vm.runInContext(`const wlCsvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';`+firstRun.slice(firstRun.indexOf('function firstRunTemplate'),firstRun.indexOf('const firstRun='))+'\nthis.template=firstRunTemplate;this.ageNotice=firstRunAgeNotice',ctx)
for(const language of ['en','ar'])test(`v1.3.0 ${language} synthetic template maps, parses and keeps incoming unknown`,()=>{
 const text=ctx.template(language,'2026-01-15'),rows=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(',').map(x=>x.slice(1,-1)))
 assert.deepEqual(rows[0].slice(-6),['2025-07','2025-08','2025-09','2025-10','2025-11','2025-12'])
 const sheets=[{name:'CSV',rows}],report=ctx.api.understandStockWorkbook(sheets)
 assert.equal(report.missing.length,0);assert.equal(report.canonical_rows.length,3)
 assert.ok(report.mapping.some(m=>m.field==='name'));assert.ok(report.mapping.some(m=>m.field==='on_hand'))
 const canonical=report.canonical_rows.map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n')
 const parsed=ctx.api.parseStockImport(canonical);ctx.api.validateDataset(parsed)
 assert.equal(parsed.items.length,2);assert.ok(parsed.items.every(i=>i.on_hand>=0&&i.monthly_sales.length===6));assert.ok(parsed.items.every(i=>!Object.hasOwn(i,'on_order')))
})
test('v1.3.0 freshness is quiet through 45 days, warns after 45, and distinguishes synthetic examples',()=>{
 for(const source of ['sample','demo','csv']){
  assert.equal(ctx.ageNotice(source,'2026-09','2026-11-14'),'')
  const notice=ctx.ageNotice(source,'2026-09','2026-11-15')
  assert.match(notice,/46 days old/)
  if(source==='csv')assert.match(notice,/Refresh your export/)
  else {assert.match(notice,/Synthetic example/);assert.doesNotMatch(notice,/Refresh your export/)}
  assert.equal(ctx.ageNotice(source,'2026-11','2026-11-15'),'')
  assert.equal(ctx.ageNotice(source,null,'2026-11-15'),'')
 }
})
test('v1.3.0 printed current full list uses existing grouping and retains warnings without state changes',()=>{
 const classes=new Set(),current=[{item:{input_warnings:['Incoming unknown'],name:'<img src=x>',sku:'A'},guidance:{used_default_lead:true,lead_days:14,expiry_warnings:['Check expiry']}}],filtered=[]
 let appended=null,printed=0
 const make=(tag,text)=>({tag,text,children:[],append(...nodes){this.children.push(...nodes)},remove(){if(appended===this)appended=null}})
 const c=vm.createContext({currentRows:current,filteredRows:filtered,currentToday:'2026-11-23',settings:{},firstRunAge:{hidden:false,textContent:'Sales old warning'},analysisDeny:()=>false,localToday:()=> '2026-11-23',render:()=>assert.fail('same day needs no recalculation'),node:make,$:()=>({textContent:'Data through Sept 2026 · today 23 Nov 2026'}),bigOrderWarning:()=> 'Check large order',wlOrderText:rows=>{assert.equal(rows,current);return 'Supplier A\nExisting grouped order\nCheck open POs'},wlEmailGroups:rows=>{assert.equal(rows,current);return [['Supplier A',rows]]},document:{getElementById:()=>appended,body:{append:node=>{appended=node},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}}},window:{print:()=>{printed++;assert.ok(classes.has('order-printing'));const text=JSON.stringify(appended);for(const warning of ['Supplier A','Existing grouped order','Check open POs','Incoming unknown','Check expiry','Check large order','Sales old warning','14 days'])assert.ok(text.includes(warning),warning)}}})
 vm.runInContext(firstRun.slice(firstRun.indexOf('function printOrder(){'),firstRun.indexOf('const printOrderButton'))+'\nthis.printOrder=printOrder',c)
 c.printOrder();assert.equal(printed,1);assert.equal(appended,null);assert.equal(classes.size,0);assert.equal(current.length,1)
 c.analysisDeny=()=>true;c.printOrder();assert.equal(printed,1)
})
test('v1.3.0 visible page version matches the package manifest',()=>{
 const version=read('plugin.yaml').match(/^version: (.+)$/m)[1]
 assert.ok(firstRun.includes('v'+version))
})
test('v1.3.0 only warnings actually shared by every source product are deduplicated in the file summary',()=>{
 const source=read('standalone/design/smart-import.js'),c=vm.createContext({})
 vm.runInContext(source.slice(source.indexOf('const fileWideWarningCache'),source.indexOf('const smartImportUI'))+'\nthis.shared=fileWideInputWarnings',c)
 const input={input_meaning:{warnings:['Global','Specific']},items:[{input_warnings:['Global','Specific']},{input_warnings:['Global']}]}
 assert.deepEqual([...c.shared(input)],['Global']);assert.deepEqual(input.items[0].input_warnings,['Global','Specific']);assert.equal(c.shared(input),c.shared(input))
 assert.equal(c.shared({items:[]}).size,0)
})
test('v1.3.0 mixed-unit totals do not repeat item counts, shared unit quantities stay intact',()=>{
 const source=read('standalone/design/worklist-gm-b.js'),c=vm.createContext({orderAmount:String,wlMoney:String})
 vm.runInContext(source.slice(source.indexOf('function wlSummaryNumbers'),source.indexOf('function wlRenderControls'))+'\nthis.summary=wlSummaryNumbers',c)
 const s={orders:2,units:new Map([['kg',10],['pieces',20]]),costed:0,missingCost:2,runout:0,value:0}
 assert.equal(c.summary(s)[0][0],2);assert.equal(c.summary(s)[1][0],'Mixed units');assert.equal(c.summary(s)[1][1],'Quantity not combined')
 assert.equal(c.summary({...s,units:new Map([['units',30]])})[1][0],'Mixed units')
 assert.equal(c.summary({...s,units:new Map(),orders:0})[1][0],'—')
 assert.equal(c.summary({...s,units:new Map([['kg',30]])})[1][0],'30 kg')
 assert.equal(c.summary({...s,costed:2,missingCost:0,value:15})[1][0],'15')
})
