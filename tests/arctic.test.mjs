// Lifecycle: living. Snapshot-relative display must not depend on the wall clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../standalone/design/presentation-gm-b.js',import.meta.url),'utf8')
function relative(as_of,date,currentToday='2026-11-14'){
  const ctx={data:{as_of},currentToday,A3_DATE_SUFFIX:'T00:00:00Z',gmRelative:null,
    gmDate:d=>new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})}
  vm.createContext(ctx);vm.runInContext(source.split('// Retain the supplied logo')[0],ctx)
  return ctx.gmRelative(date)
}
function leadNotice(guidance){
  const ctx={gmRelative:null};vm.createContext(ctx)
  vm.runInContext(source.split('// Retain the supplied logo')[0],ctx)
  return ctx.gmBLeadNotice(guidance)
}
test('Arctic distinguishes a default order lead from a confirmed arrival',()=>{
  assert.equal(leadNotice({used_default_lead:true,lead_days:14,delivery_date:null}),
    'Supplier lead time missing; order date assumes the default 14 days')
  assert.equal(leadNotice({used_default_lead:true,lead_days:30,delivery_date:'2026-12-01'}),
    'Supplier lead time missing: using the default 30 days')
  assert.equal(leadNotice({used_default_lead:false,lead_days:0}),null)
  assert.equal(leadNotice({status:'needs-data'}),null)
})
test('Arctic run-out relative days use the unchanged forecast snapshot',()=>{
  assert.equal(relative('2026-10-31','2026-11-20'),'In 20 days')
  assert.equal(relative('2026-10-31','2026-11-20','2030-01-01'),'In 20 days')
})
test('Arctic relative date singular, past, leap day and same day',()=>{
  assert.equal(relative('2026-10-31','2026-11-01'),'In 1 day')
  assert.equal(relative('2026-10-31','2026-10-30'),'1 day before snapshot')
  assert.equal(relative('2026-10-31','2026-10-29'),'2 days before snapshot')
  assert.equal(relative('2026-10-31','2026-10-31'),'On snapshot date')
  assert.equal(relative('2028-02-28','2028-03-01'),'In 2 days')
})

// Decision columns are presentation metadata, not changes to planner outputs.
const worklist=fs.readFileSync(new URL('../standalone/design/worklist-gm-b.js',import.meta.url),'utf8')
const desktop=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
test('Arctic legacy presets migrate while custom order stays intact',()=>{
  const c=vm.createContext({document:{body:{dataset:{}}}})
  vm.runInContext(worklist.slice(worklist.indexOf('const wlColumns='),worklist.indexOf('wl.columns=wlColumns'))+worklist.slice(worklist.indexOf('const WL_SIMPLE_COLUMNS='),worklist.indexOf('function wlMoney'))+'\nglobalThis.migrate=wlLegacyMode;globalThis.ordered=wlNormalize;',c)
  const simple=['product','status','hand','incoming','qty','due','runout'],detailed=['product','status','hand','incoming','days','qty','due','runout','supplier','category','lead']
  assert.equal(c.migrate(simple),'simple');assert.equal(c.migrate(detailed),'detailed');assert.equal(c.migrate(['product','qty','hand']),'custom')
  assert.deepEqual(JSON.parse(JSON.stringify(c.ordered(['qty','product','hand','qty','unknown']))),['product','qty','hand'])
})
function decisionFixture(){
  const ctx={TextEncoder,TextDecoder,atob,btoa,data:{as_of:'2026-10-31',months:['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11']},settings:{months_of_cover:2},wlMeta:r=>r.meta}
  vm.createContext(ctx)
  vm.runInContext(desktop.slice(desktop.indexOf('const SAMPLE ='),desktop.indexOf('const pageStyle =')).replace(/^export \{[^\n]*\}\s*$/gm,'').replaceAll('export ','')+'\n'+worklist.slice(worklist.indexOf('function wlMoney'),worklist.indexOf('function wlReadStorage'))+'\nglobalThis.decision=wlDecision;globalThis.display=wlDecisionText;',ctx)
  return ctx
}
test('Arctic decision columns: complete six-month average, effective cost, forecast duration and excess',()=>{
  const c=decisionFixture(),i={sku:'COST',name:'Costed sample',unit:'m',monthly_sales:[60,60,60,60,60,60,60,9999],on_hand:500,on_order:20,unit_cost:2.5},g={quantity:180,monthly_demand:60,safety_stock:20,lead_days:15},before=JSON.stringify({i,g})
  const m=c.decision(i,g)
  assert.equal(m.monthly,60);assert.equal(m.value,450);assert.equal(m.lasts,3);assert.equal(m.pattern,'Steady');assert.equal(m.last,'2026-10')
  // 520 stock - (20 safety + 60 * (15 + 60) / 30) = 350; * 2.5 = 875.
  assert.equal(m.excess,875);assert.equal(c.display({item:i,meta:m},'value'),'450');assert.equal(c.display({item:i,meta:m},'last'),'Oct 2026')
  c.settings.product_overrides={COST:{unit_cost:3}};assert.equal(c.decision(i,g).value,540)
  assert.equal(JSON.stringify({i,g}),before,'display computation must not mutate source data')
})
test('Arctic decision columns: missing cost, fallback demand, short/zero history and CV thresholds',()=>{
  const c=decisionFixture(),i={sku:'NO-COST',unit:'units',monthly_sales:[0,0,0,0,0,0,0,9999],on_hand:0,on_order:0},g={quantity:180,safety_stock:0,lead_days:15},zero=c.decision(i,g)
  assert.equal(zero.value,null);assert.equal(zero.excess,null);assert.equal(zero.lasts,null);assert.equal(zero.pattern,null);assert.equal(zero.last,null)
  assert.equal(c.display({item:i,meta:zero},'last'),'Never');assert.equal(c.display({item:i,meta:zero},'value'),'—')
  assert.equal(c.decision({...i,monthly_sales:[60,60,60]},g).lasts,3)
  assert.equal(c.decision({...i,monthly_sales:[60,60,60]},g).pattern,null)
  assert.equal(c.decision({...i,monthly_sales:[0,60,0,60]},g).pattern,'Erratic','population CV = 1')
  assert.equal(c.decision({...i,monthly_sales:[10,60,10,60]},g).pattern,'Variable')
  assert.equal(c.decision({...i,monthly_sales:[30,60,30,60]},g).pattern,'Steady')
})

// Decluttering moves controls, not calculations. Test meaning rather than old button text.
test('Arctic summary shows three metrics, unit-aware fallback and explicitly incomplete costs',()=>{
  const c=vm.createContext({orderAmount:n=>n.toLocaleString('en-US'),wlMoney:n=>'KD '+n.toLocaleString('en-US')})
  vm.runInContext(worklist.slice(worklist.indexOf('function wlSummaryNumbers'),worklist.indexOf('function wlRenderControls'))+'\nglobalThis.summary=wlSummaryNumbers;',c)
  const s={orders:2,units:new Map([['units',2893],['m',30868]]),costed:0,missingCost:2,value:0,runout:1},before=JSON.stringify({...s,units:[...s.units]})
  const result=JSON.parse(JSON.stringify(c.summary(s)))
  assert.deepEqual(result,[[2,'To order','order'],['2,893 units · 30,868 m','To order (qty)','order'],[1,'Running out within 7 days','runout']])
  assert.deepEqual(JSON.parse(JSON.stringify(c.summary({...s,costed:2,missingCost:0,value:1200})[1])),['KD 1,200','Order value','order'])
  assert.equal(c.summary({...s,costed:1,missingCost:1,value:600})[1][0],'2,893 units · 30,868 m','default product retains the unit-aware partial-cost fallback')
  // Only the synthetic demo opts into a clearly labelled known-cost subtotal.
  assert.deepEqual(JSON.parse(JSON.stringify(c.summary({...s,costed:1,missingCost:1,value:600},true)[1])),['KD 600','Order value (known costs) · cost missing for 1 product','order'])
  assert.equal(c.summary({...s,units:new Map(),orders:0})[1][0],'—')
  assert.equal(JSON.stringify({...s,units:[...s.units]}),before,'display summary does not mutate source totals')
})
test('Arctic assumption note is dataset-wide, singular-aware and opens the existing settings',()=>{
  let opened=0
  const note={hidden:false,children:[],replaceChildren(){this.children=[]},append(...children){this.children.push(...children)}}
  const c=vm.createContext({currentRows:[{guidance:{used_default_lead:true,lead_days:14}},{guidance:{used_default_lead:false,lead_days:5}}],wlLeadNote:note,node:(tag,text)=>({tag,text}),wlBtn:(text,click)=>({text,click}),gmOpenSettings:()=>opened++})
  vm.runInContext(worklist.slice(worklist.indexOf('function wlRenderLeadNote'),worklist.indexOf('function wlRenderActive'))+'\nglobalThis.notice=wlRenderLeadNote;',c)
  c.notice();assert.equal(note.hidden,false);assert.equal(note.children[0].text,'Delivery time assumed (14 days) for 1 product · ');note.children[1].click();assert.equal(opened,1)
  c.currentRows.push({guidance:{used_default_lead:true,lead_days:14}});c.notice();assert.equal(note.children[0].text,'Delivery time assumed (14 days) for 2 products · ')
  c.currentRows=[];c.notice();assert.equal(note.hidden,true);assert.equal(note.children.length,0)
})

const chartSource=fs.readFileSync(new URL('../standalone/design/chart-focus-gm-b.js',import.meta.url),'utf8')
function orderDisplayFixture(){
 const c=decisionFixture();c.currentToday='2026-11-01'
 vm.runInContext(chartSource.slice(chartSource.indexOf('function suggestedOrderScenario'),chartSource.indexOf('function drawSuggestedOrder'))+worklist.slice(worklist.indexOf('function wlEmailLine'),worklist.indexOf('function wlDraftEmail'))+'\nglobalThis.scenario=suggestedOrderScenario;globalThis.email=wlEmailDraft;globalThis.supplierEmail=wlSupplierEmail;',c)
 return c
}
test('Arctic order overlay reuses monthly net-stock slopes and jumps by exact guidance quantity',()=>{
 const c=orderDisplayFixture(),row={item:{stock:100},guidance:{quantity:100,lead_days:14,order_by:'now'}},series={n:12,rows:[{month:'2026-11',demand:60,receipts:0,stock:40},{month:'2026-12',demand:120,receipts:20,stock:-60}]},before=JSON.stringify({row,series}),s=c.scenario(row,series)
 assert.equal(s.arrivalDate,'2026-11-15');assert.equal(s.arrivalT,12+14/30);assert.ok(Math.abs(s.before-72)<1e-10);assert.ok(Math.abs(s.after-172)<1e-10);assert.equal(s.points.at(-1).stock,40)
 assert.equal(JSON.stringify({row,series}),before,'counterfactual never mutates source series/guidance')
 assert.equal(c.scenario({...row,guidance:{...row.guidance,quantity:0}},series),null)
 assert.equal(c.scenario({...row,guidance:{...row.guidance,order_by:null}},series),null)
 assert.equal(c.scenario({...row,guidance:{...row.guidance,lead_days:null}},series),null)
 assert.equal(c.scenario({...row,guidance:{...row.guidance,lead_days:365}},series).points.length,0,'do not invent an off-horizon forecast')
 // Mid-month snapshots cannot reach the chart: the unchanged core holds them.
 const item={sku:'MIDMONTH',name:'Invalid snapshot fixture',unit:'units',on_hand:100,on_order:0,monthly_sales:c.data.months.map(()=>60)};assert.equal(c.calculate([item],c.data.months,'2026-11-17',1)[0].held,true)
})
test('Arctic counterfactual floors stockout before arrival and does not invent backorders',()=>{
 const c=orderDisplayFixture(),row={item:{stock:10},guidance:{quantity:25.5,lead_days:14,order_by:'now'}},series={n:12,rows:[{month:'2026-11',demand:30,receipts:0,stock:-20}]},s=c.scenario(row,series)
 assert.equal(s.before,0);assert.equal(s.after,25.5);assert.ok(Math.abs(s.points.at(-1).stock-9.5)<1e-10,'floating-point display interpolation')
 assert.ok(s.baseline.every(p=>p.stock>=0));assert.equal(s.baseline.at(-1).stock,0)
// SVG interpolation uses floating point; quantities themselves remain untouched.
 const instant=c.scenario({...row,guidance:{...row.guidance,lead_days:0}},series);assert.equal(instant.orderT,instant.arrivalT);assert.ok(Math.abs(instant.after-instant.before-25.5)<1e-10)
})
test('Arctic email draft preserves rounded quantities, units, per-line dates and safe plain text',()=>{
 const c=orderDisplayFixture(),rows=[{item:{sku:'SKU\n1',name:'Name <script>',unit:'m²'},guidance:{quantity:12.5,order_by:'now',lead_days:14}},{item:{sku:'SKU2',name:'Pack-rounded product',unit:'units'},guidance:{quantity:144,order_by:'2026-12-27',lead_days:7}}],draft=c.email('Supplier\nName',rows)
 assert.equal(draft.subject,'Purchase order request – Supplier Name – 2026-11-01');assert.ok(draft.body.startsWith('Hello Supplier Name,\n'))
 assert.ok(draft.body.includes('SKU 1 · Name <script> · 12.5 m² · Requested delivery: 2026-11-15'));assert.ok(draft.body.includes('SKU2 · Pack-rounded product · 144 units · Requested delivery: 2027-01-03'));assert.ok(draft.body.endsWith('[Your name]'))
 c.data.suppliers={Supplier:{email:'buyer@example.test'}};assert.equal(c.supplierEmail('Supplier',rows),'buyer@example.test')
 c.data.suppliers=[{name:'Supplier',email:'other@example.test'}];assert.equal(c.supplierEmail('Supplier',rows),'other@example.test')
 c.data.suppliers=[{name:'Supplier',email:'unsafe@example.test?bcc=other'}];assert.equal(c.supplierEmail('Supplier',rows),'')
 assert.equal(c.supplierEmail('',[{item:{supplier_email:'buyer@example.test'}}]),'','unassigned supplier cannot get a mailto recipient')
})
