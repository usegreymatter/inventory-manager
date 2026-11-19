import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const read = name => fs.readFileSync(new URL('../'+name, import.meta.url),'utf8')
const plugin=read('desktop/plugin.js'),core=plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')
const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(core+'\n'+read('standalone/design/strings-a3.js')+'\n'+read('standalone/design/why-a3.js')+'\nglobalThis.api={SAMPLE,evaluateDataset,orderGuidance,whyBreakdown,orderBreakdown,validBreakdown,normalizeOrderSettings,waterfall}',ctx)
const a=ctx.api,today='2026-11-12',plain=x=>JSON.parse(JSON.stringify(x))
for(const backup of [false,true])for(const cover of [0,2,3.5])test(`waterfall conservation: backup=${backup}, cover=${cover}`,()=>{
  const settings=a.normalizeOrderSettings({months_of_cover:cover,include_backup_in_orders:backup})
  for(const item of a.evaluateDataset(a.SAMPLE,6,settings)){
    const g=a.orderGuidance(item,today,settings,a.SAMPLE.as_of),before=JSON.stringify(g)
    const steps=a.orderBreakdown(item,g,settings,today)
    assert.ok(a.validBreakdown(steps,g.quantity))
    assert.equal(steps.at(-1).qty,g.quantity)
    assert.equal(steps.slice(0,-1).reduce((n,s)=>n+s.qty,0),g.quantity)
    assert.equal(steps.find(s=>s.key==='safety_stock')?.qty??0,backup?g.safety_stock??0:0)
    assert.equal(JSON.stringify(g),before)
  }
})
test('A3 consumes only core ledger, preserves values and hides zero phase-2 adjustments',()=>{
  const corpus=JSON.parse(read('tests/golden/phase2-inputs.json'))
  const manual=JSON.parse(read('tests/golden/manual-inputs.json'))
  const late=structuredClone(corpus.cases.find(c=>c.item.sku==='SAME-DAY-SUPPLY'))
  late.item.planning_facts.incoming_pos[0].due_date='2026-10-31'
  const keys=new Set(),optional=new Set(['stockout_correction','projects_excluded','manual_change','committed_orders'])
  for(const c of [...corpus.cases,...manual.cases,late]){
    const settings=c.settings||{},date=corpus.today,item=a.evaluateDataset({as_of:corpus.as_of,months:c.months,items:[c.item]},6,settings,date)[0]
    const g=a.orderGuidance(item,date,settings),saved=JSON.stringify(item)
    const expected=plain(a.whyBreakdown(item,date,settings)).filter(s=>!optional.has(s.key)||s.qty!==0)
    const steps=a.orderBreakdown(item,{...g,breakdown:[{key:'fake',label:'Fake',qty:999}]},settings,date)
    assert.deepEqual(plain(steps).filter(s=>s.key!=='total').map(({key,qty})=>({key,qty})),expected)
    assert.ok(a.validBreakdown(steps,g.quantity??null))
    assert.equal(JSON.stringify(item),saved)
    for(const s of steps){keys.add(s.key);assert.ok(s.label.trim().split(/\s+/).length<=3)}
    if(g.quantity==null){assert.equal(steps.length,1);assert.equal(steps[0].qty,null)}
    else assert.equal(steps.slice(0,-1).reduce((n,s)=>n+s.qty,0),g.quantity)
  }
  for(const key of ['late_po_hold','committed_orders','manual_change'])assert.ok(keys.has(key),key)
})
test('invalid ledgers fail closed including forged null quantities',()=>{
  assert.equal(a.validBreakdown([{key:'total',label:'Total',qty:7}],7),false)
  assert.equal(a.validBreakdown([{key:'bad',label:'This label is too long',qty:7},{key:'total',label:'Total',qty:7}],7),false)
  assert.equal(a.validBreakdown([{key:'bad',label:'Bad',qty:Infinity},{key:'total',label:'Total',qty:7}],7),false)
  assert.equal(a.validBreakdown([{key:'bad',label:'Bad',qty:null}],null),false)
})
test('drawer uses plain rounding labels and core safety stock',()=>{
  const item=a.evaluateDataset(a.SAMPLE,6)[0]
  for(const [override,label] of [[{},'Round up'],[{pack_size:1},'Round up'],[{pack_size:2.5},'Round to box'],[{minimum_order:13},'Round up']]){
    const settings=a.normalizeOrderSettings({include_backup_in_orders:true,product_overrides:{[item.sku]:override}})
    const g=a.orderGuidance(item,today,settings),steps=a.orderBreakdown(item,g,settings,today)
    assert.equal(steps.find(s=>s.key==='pack_rounding').label,label)
    assert.equal(steps.find(s=>s.key==='safety_stock').label,'Safety stock')
    assert.ok(a.validBreakdown(steps,g.quantity))
  }
})
test('zero orders, fractional packs, incoming and MOQ retain authoritative quantity',()=>{
  const settings=a.normalizeOrderSettings({months_of_cover:2,product_overrides:{'SYN-A':{pack_size:2.5,minimum_order:13}}})
  for(const stock of [0,3.7,100000])for(const onOrder of [0,25]){
    const raw={as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:[{sku:'SYN-A',name:'Synthetic',unit:'kg',monthly_sales:[10,11,12],on_hand:stock,on_order:onOrder,supplier_days:14,receipts:{'2026-11':10}}]}
    const item=a.evaluateDataset(raw,6,settings)[0],g=a.orderGuidance(item,today,settings,raw.as_of)
    const steps=a.orderBreakdown(item,g,settings,today)
    assert.ok(a.validBreakdown(steps,g.quantity))
    assert.equal(steps.slice(0,-1).reduce((n,s)=>n+s.qty,0),g.quantity)
  }
})
test('zero-valued phase-2 adjustments stay absent',()=>{
  const raw={as_of:'2026-10-31',months:['2026-08','2026-09','2026-10'],items:[{sku:'A',name:'Synthetic',unit:'kg',monthly_sales:[10,10,10],on_hand:0,supplier_days:14,demand_change_pct:0,planning_facts:{version:'1.0',sales_history:['2026-08','2026-09','2026-10'].map(month=>({sku:'A',month,quantity:10,project:false,in_stock_days:10,backorder:false}))}}]}
  const item=a.evaluateDataset(raw,6,{},today)[0],g=a.orderGuidance(item,today,{})
  const coreSteps=a.whyBreakdown(item,today,{})
  assert.ok(coreSteps.some(s=>s.key==='manual_change'&&s.qty===0))
  assert.ok(coreSteps.some(s=>s.key==='projects_excluded'&&s.qty===0))
  const steps=a.orderBreakdown(item,g,{},today)
  assert.ok(a.validBreakdown(steps,g.quantity))
  assert.ok(!steps.some(s=>['manual_change','projects_excluded','committed_orders','stockout_correction'].includes(s.key)&&s.qty===0))
})
test('invalid Why ledger opens a short unavailable state instead of silently returning',()=>{
  for(const steps of [[],[{key:'total',label:'Total',qty:7}]]){
    const elements={
      'why-sku':{textContent:''},
      'why-chart':{children:['stale chart'],replaceChildren(...children){this.children=children}},
      'why-dialog':{open:false,showModal(){this.open=true},querySelector(){return {focus(){}}}}
    }
    const c=vm.createContext({settings:{},currentToday:today,data:{as_of:'2026-10-31'},
      $:id=>elements[id],window:{getSelection:()=>null},withDatasetEvaluation:fn=>fn(),evaluationSnapshot:{ready:true},rowMap:new Map(),
      node:(tag,text,className)=>({tag,text,className})})
    vm.runInContext(read('standalone/design/strings-a3.js')+'\n'+read('standalone/design/why-a3.js'),c)
    c.orderBreakdown=()=>steps
    const trigger={isConnected:true},row={item:{sku:'SYN-BAD',unit:'ea'},guidance:{quantity:7}}
    c.openWhy(row,trigger)
    assert.equal(elements['why-dialog'].open,true)
    assert.equal(elements['why-dialog'].returnFocus,trigger)
    assert.equal(elements['why-sku'].textContent,'SYN-BAD')
    assert.equal(elements['why-chart'].children.length,1)
    assert.equal(elements['why-chart'].children[0].text,'Can’t explain')
  }
})

test('Why drawer discloses the undated incoming assumption only when used',()=>{
 for(const assumed of [false,true]){
  const chart={children:[],replaceChildren(...children){this.children=children},append(...children){this.children.push(...children)}}
  const elements={'why-sku':{},'why-chart':chart,'why-dialog':{open:false,showModal(){this.open=true},querySelector(){return {focus(){}}}}}
  const c=vm.createContext({settings:{},currentToday:today,data:{as_of:'2026-10-31'},currentRows:[],
   $:id=>elements[id],window:{getSelection:()=>null},evaluationSnapshot:{health:{features:{}}},
   node:(tag,text,className)=>({tag,text,className,dataset:{}}),
   forecastDetails:()=>({method:'champion',method_name:'Average',tested_months:0})})
  vm.runInContext(read('standalone/design/strings-a3.js')+'\n'+read('standalone/design/why-a3.js'),c)
  c.orderBreakdown=()=>[{key:'forecast_demand',label:'Cover demand',qty:7},{key:'total',label:'Total',qty:7}]
  c.waterfall=()=>({tag:'ol'})
  c.openWhyPass({item:{sku:'SYN-ASSUMED',unit:'ea'},guidance:{quantity:7,undated_on_order_assumed_within_lead:assumed}},null)
  const notes=chart.children.filter(n=>n.dataset?.undatedIncomingAssumption)
  assert.equal(notes.length,assumed?1:0)
  if(assumed)assert.equal(notes[0].text,'Undated on-order stock is assumed to arrive within delivery time.')
 }
})

test('every numeric waterfall row shows its unit; holds never show a number',()=>{
  ctx.orderAmount=n=>String(n)
  ctx.node=(tag,text,className)=>({tag,text,className,dataset:{},style:{},children:[],setAttribute(){},append(...children){this.children.push(...children)}})
  for(const unit of ['kg','m²','ea']){
    const steps=[{key:'forecast_demand',label:'Cover demand',qty:2.5},{key:'incoming_supply',label:'Incoming',qty:-.5},{key:'total',label:'Suggested order',qty:2}]
    const chart=a.waterfall(steps,unit)
    assert.equal(chart.children.length,3)
    for(const row of chart.children){
      const number=row.children[0].children[1]
      assert.equal(number.children[0].text,unit)
      assert.ok(number.title.endsWith(' '+unit))
    }
    const held=a.waterfall([{key:'late_po_hold',label:'Late PO hold',qty:null}],unit)
    assert.equal(held.children.length,1)
    assert.equal(held.children[0].children[0].text,'Late PO hold')
    assert.equal(held.children[0].children[1].text,unit)
    assert.ok(!('qty' in held.children[0].dataset))
  }
})
