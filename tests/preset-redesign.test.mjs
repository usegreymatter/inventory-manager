import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const context=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll(/export /g,'')+'\nthis.api={INDUSTRY_SETTING_PRESETS,previewIndustryPreset,normalizeOrderSettings,validateOrderSettings,resolveOrderSettings,orderGuidance,calculate,parseCsv,SAMPLE}',context)
const api=context.api,plain=v=>JSON.parse(JSON.stringify(v))
const item={sku:'CAN',name:'Cans',unit:'units',monthly_sales:[300,300,300],monthly_demand:300,seasonal:false,on_hand:0,supplier_days:14,receipts:{},as_of:'2026-10-31'}
const dataset={items:[item,{...item,sku:'MILK',shelf_life_days:14}],months:['2026-08','2026-09','2026-10'],as_of:item.as_of}
test('machine-readable recipes match the shipped definitions exactly',()=>{
 const file=JSON.parse(fs.readFileSync(new URL('../docs/presets.json',import.meta.url),'utf8'))
 assert.deepEqual(file.presets,plain(api.INDUSTRY_SETTING_PRESETS))
 assert.equal(file.cover_floor,'per_product: max(product_months_of_cover ?? max(current_months_of_cover, recipe.months_of_cover), effective_review_days / 30)')
})
test('all industry setup guides preserve service target and match General quantities at weekly and monthly defaults',()=>{
 for(const review_days of [7,30]){
  const current=api.normalizeOrderSettings({review_days})
  const general=api.previewIndustryPreset(current,'general',dataset,item.as_of)
  for(const slug of Object.keys(api.INDUSTRY_SETTING_PRESETS)){
   const p=api.previewIndustryPreset(current,slug,dataset,item.as_of)
   assert.equal(p.next.service_level,current.service_level,slug+' must not raise model service')
   assert.equal(p.impact.quantity_change,0,slug+' must be a quantity no-op from defaults')
   assert.equal(p.impact.after_quantity,general.impact.after_quantity)
  }
 }
 for(const service_level of [.9,.95,.99]){
  const current=api.normalizeOrderSettings({service_level})
  const p=api.previewIndustryPreset(current,'pharmacy',dataset,item.as_of)
  assert.equal(p.next.service_level,service_level)
 }
})
test('industry recipes preserve cadence and cover review only, without adding lead twice',()=>{
 for(const slug of Object.keys(api.INDUSTRY_SETTING_PRESETS))for(const review of [2,7,30,90]){
  const current=api.normalizeOrderSettings({review_days:review,months_of_cover:3,default_delivery_days:45})
  const p=api.previewIndustryPreset(current,slug,{...dataset,items:[{...item,supplier_days:60}]},item.as_of)
  assert.equal(p.next.review_days,review)
  assert.equal(p.next.months_of_cover,3)
  assert.ok(api.resolveOrderSettings(item,p.next).settings.months_of_cover>=Math.max(3,review/30))
 }
})
test('presets do not write or clear global shelf assumptions, nor force experimental methods',()=>{
 const current=api.normalizeOrderSettings({shelf_life_days:365,arrival_age_days:20,min_remaining_life_days:10,forecast_method:'recommended'})
 for(const slug of Object.keys(api.INDUSTRY_SETTING_PRESETS)){
  const p=api.previewIndustryPreset(current,slug,dataset,item.as_of)
  for(const key of ['shelf_life_days','arrival_age_days','min_remaining_life_days'])assert.equal(p.next[key],current[key])
  if(slug!=='general')assert.equal(p.next.forecast_method,'recommended')
 }
 const defaults=api.normalizeOrderSettings({})
 assert.deepEqual(plain(api.previewIndustryPreset(defaults,'general').next),plain(defaults))
})
test('preview computes exact current-data affected quantity counts with the real engine',()=>{
 const current=api.normalizeOrderSettings({months_of_cover:.1,review_days:30})
 const p=api.previewIndustryPreset(current,'grocery',dataset,item.as_of)
 const before=dataset.items.map(i=>api.orderGuidance(i,item.as_of,current,item.as_of).quantity)
 const after=dataset.items.map(i=>api.orderGuidance(i,item.as_of,p.next,item.as_of).quantity)
 assert.equal(p.impact.products,2)
 assert.equal(p.impact.affected_products,after.filter((q,i)=>q!==before[i]).length)
 assert.equal(p.impact.before_quantity,before.reduce((a,b)=>a+b,0))
 assert.equal(p.impact.after_quantity,after.reduce((a,b)=>a+b,0))
 assert.equal(p.impact.quantity_change,p.impact.after_quantity-p.impact.before_quantity)
 assert.equal(api.previewIndustryPreset(current,'grocery').impact,null)
})
test('cover floor uses product/supplier overrides and blocks unsupported cycles',()=>{
 const current=api.normalizeOrderSettings({review_days:7,product_overrides:{CAN:{review_days:90}},supplier_overrides:{Supply:{supplier_days:120}}})
 const p=api.previewIndustryPreset(current,'grocery',{...dataset,items:[{...item,supplier:'Supply'}]},item.as_of)
 assert.equal(p.next.months_of_cover,2)
 assert.equal(p.next.product_overrides.CAN.months_of_cover,3)
 assert.equal(p.next.review_days,7)
 const blocked=api.previewIndustryPreset(api.normalizeOrderSettings({review_days:3650}),'grocery')
 assert.match(blocked.blocked,/exceeds the .*36-month/)
})
test('preview marks unavailable advice separately, never as a zero-quantity product',()=>{
 const current=api.normalizeOrderSettings({months_of_cover:.1})
 const p=api.previewIndustryPreset(current,'grocery',{...dataset,items:[item,{...item,sku:'HELD',hold_reason:'Check data'}]},item.as_of)
 assert.equal(p.impact.products,2);assert.equal(p.impact.unavailable_products,1);assert.equal(p.impact.affected_products,1)
 const expected=api.orderGuidance(item,item.as_of,p.next,item.as_of).quantity
 assert.equal(p.impact.after_quantity,expected)
})
test('explicit product null/zero/none defeats global cap and round-trips in settings with Python parity',()=>{
 const results=[]
 for(const value of [null,0,'none']){
  const settings=api.validateOrderSettings({big_order_months:6,shelf_life_days:14,product_overrides:{CAN:{shelf_life_days:value}}})
  assert.equal(Object.hasOwn(settings.product_overrides.CAN,'shelf_life_days'),true)
  const g=api.orderGuidance(item,item.as_of,settings,item.as_of),base=api.orderGuidance(item,item.as_of,{},item.as_of)
  assert.equal(g.quantity,base.quantity)
  assert.equal(Object.hasOwn(g,'shelf_cap_qty'),false)
  results.push({settings:plain(settings),quantity:g.quantity})
 }
 const py=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json\ni=json.loads(${JSON.stringify(JSON.stringify(item))})\nout=[]\nfor v in [None,0,'none']:\n s=engine.validate_order_settings({'big_order_months':6,'shelf_life_days':14,'product_overrides':{'CAN':{'shelf_life_days':v}}})\n out.append({'settings':s,'quantity':engine.order_guidance(i,i['as_of'],s)['quantity']})\nprint(json.dumps(out))`],{cwd:new URL('..',import.meta.url),encoding:'utf8'})
 assert.equal(py.status,0,py.stderr)
 assert.deepEqual(results,JSON.parse(py.stdout))
})
test('separate profit suggestion has no shelf limit for disabled products',()=>{
 for(const value of [null,0,'none']){
  const g=api.orderGuidance(item,item.as_of,{profit_suggestion:true,shelf_life_days:14,product_overrides:{CAN:{shelf_life_days:value,unit_cost:10,sale_price:20}}},item.as_of)
  assert.ok(g.profit_suggestion,'profit estimate remains available')
  const base=api.orderGuidance(item,item.as_of,{profit_suggestion:true,product_overrides:{CAN:{unit_cost:10,sale_price:20}}},item.as_of)
  assert.deepEqual(plain(g.profit_suggestion),plain(base.profit_suggestion))
 }
})
test('import explicit none/null/0 shelf cells disables global cap; blank inherits',()=>{
 for(const token of ['none','null','0','']){
  const csv='sku,name,unit,on_hand,supplier_days,shelf_life_days,2026-08,2026-09,2026-10\nCAN,Cans,units,0,14,'+token+',300,300,300\n'
  const parsed=api.parseCsv(csv)
  assert.equal(parsed.items.length,1,JSON.stringify(parsed.import_report))
  const imported={...api.calculate(parsed.items,parsed.months,parsed.as_of,6)[0],as_of:parsed.as_of}
  assert.equal(Object.hasOwn(imported,'shelf_life_days'),token!=='')
  if(token)assert.equal(api.resolveOrderSettings(imported,{shelf_life_days:14}).sources.shelf_life_days,'from file')
  const g=api.orderGuidance(imported,item.as_of,{shelf_life_days:14},item.as_of)
  assert.equal(Object.hasOwn(g,'shelf_cap_qty'),token==='')
 }
})
