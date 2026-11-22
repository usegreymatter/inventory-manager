import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const context=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll(/export /g,'')+'\nthis.api={INDUSTRY_SETTING_PRESETS,previewIndustryPreset,normalizeOrderSettings,validateOrderSettings,calculate,SAMPLE}',context)
const api=context.api,plain=v=>JSON.parse(JSON.stringify(v))
test('six explicit setting presets preview ordinary changes without mutating input',()=>{
 assert.deepEqual(Object.values(api.INDUSTRY_SETTING_PRESETS).map(p=>p.label),['General','Grocery/food','Pharmacy','Fashion/seasonal','Spare parts','Electronics'])
 const before=plain(api.normalizeOrderSettings({months_of_cover:3,product_overrides:{A:{review_days:99,pack_size:3}},supplier_overrides:{B:{supplier_days:12}}}))
 for(const slug of Object.keys(api.INDUSTRY_SETTING_PRESETS)){
  const snapshot=JSON.stringify(before),p=api.previewIndustryPreset(before,slug)
  assert.equal(JSON.stringify(before),snapshot)
  assert.deepEqual(plain(p.next.product_overrides),before.product_overrides)
  assert.deepEqual(plain(p.next.supplier_overrides),before.supplier_overrides)
  assert.equal(p.next.industry_preset,before.industry_preset)
  assert.ok(p.changes.length||p.next.months_of_cover===before.months_of_cover)
  for(const c of p.changes){assert.ok(c.why.length>10);assert.equal(c.old,before[c.setting]);assert.equal(c.new,p.next[c.setting])}
  assert.deepEqual(plain(api.validateOrderSettings(p.next)),plain(api.normalizeOrderSettings(p.next)))
 }
 assert.throws(()=>api.previewIndustryPreset(before,'__proto__'))
})
test('presets leave shelf assumptions unchanged and default keys absent',()=>{
 const before=api.normalizeOrderSettings({}),grocery=api.previewIndustryPreset(before,'grocery').next
 for(const key of ['shelf_life_days','arrival_age_days','min_remaining_life_days']){
  assert.equal(Object.hasOwn(before,key),false)
  assert.equal(Object.hasOwn(api.validateOrderSettings(grocery),key),false)
  assert.equal(api.previewIndustryPreset({...grocery,[key]:14},'general').next[key],14)
 }
 for(const bad of [{shelf_life_days:0},{arrival_age_days:-1},{min_remaining_life_days:1.5},{shelf_life_days:true}])assert.throws(()=>api.validateOrderSettings(bad))
 assert.deepEqual(plain(api.normalizeOrderSettings(grocery)),plain(api.validateOrderSettings(JSON.parse(JSON.stringify(grocery)))))
})
test('optional shelf storage does not mutate existing ordinary settings',()=>{
 const before=plain(api.normalizeOrderSettings({months_of_cover:1.25,product_overrides:{A:{pack_size:3}}}))
 const after=plain(api.normalizeOrderSettings({...before,shelf_life_days:14,arrival_age_days:2,min_remaining_life_days:2}))
 for(const key of ['shelf_life_days','arrival_age_days','min_remaining_life_days'])delete after[key]
 assert.deepEqual(after,before)
})
