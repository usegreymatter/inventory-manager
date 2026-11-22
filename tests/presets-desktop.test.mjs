import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
test('Desktop preset controls preview, confirm, cancel and undo use exact snapshots',()=>{
 const start=source.indexOf('export function IndustryPresetControls(')
 assert.ok(start>=0,'missing Desktop preset controls')
 let slots=[],cursor=0,saved=[]
 const ctx=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl,
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{slots[i]=next}]},
  useRef:()=>({current:null}),useEffect:()=>{},
  jsx:(tag,props)=>({tag,...props}),jsxs:(tag,props)=>({tag,...props})})
 const core=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll(/export /g,'')
 const component=source.slice(start,source.indexOf('export function Page(',start)).replaceAll(/export /g,'')
 vm.runInContext(core+'\n'+component+'\nthis.api={IndustryPresetControls,normalizeOrderSettings}',ctx)
 let settings=JSON.parse(JSON.stringify(ctx.api.normalizeOrderSettings({months_of_cover:.1,product_overrides:{A:{pack_size:3}}})))
 const before=JSON.stringify(settings);let dataset={items:[{sku:'A',name:'Synthetic',unit:'units',monthly_sales:[300,300,300],on_hand:0,supplier_days:14,receipts:{}}],months:['2026-08','2026-09','2026-10'],as_of:'2026-10-31'}
 const render=()=>{cursor=0;return ctx.api.IndustryPresetControls({settings,dataset,onSave:next=>{settings=JSON.parse(JSON.stringify(next));saved.push(settings)}})}
 const all=tree=>[tree,...(Array.isArray(tree?.children)?tree.children:[tree?.children]).filter(v=>v&&typeof v==='object').flatMap(all)]
 const find=(tree,key,value)=>all(tree).find(n=>n[key]===value)
 let tree=render();find(tree,'data-setting-preset','grocery').onClick();assert.equal(saved.length,0)
 tree=render();assert.ok(find(tree,'id','industry-preset-preview'));assert.match(find(tree,'id','industry-preset-impact').children,/1 of 1 products.*order quantity/);assert.match(find(tree,'id','industry-preset-cadence').children,/How often do you place orders.*30/);find(tree,'id','cancel-setting-preset').onClick();assert.equal(saved.length,0)
 tree=render();find(tree,'data-setting-preset','grocery').onClick();tree=render();find(tree,'id','confirm-setting-preset').onClick()
 assert.equal(settings.shelf_life_days,undefined);assert.equal(settings.review_days,30);assert.equal(settings.months_of_cover,2);assert.equal(settings.product_overrides.A.pack_size,3)
 tree=render();find(tree,'id','undo-setting-preset').onClick();assert.equal(JSON.stringify(settings),before)
 tree=render();find(tree,'data-setting-preset','electronics').onClick();settings.months_of_cover=4;tree=render();assert.equal(find(tree,'id','confirm-setting-preset').disabled,true)
 find(tree,'id','cancel-setting-preset').onClick();tree=render();find(tree,'data-setting-preset','pharmacy').onClick();dataset={};tree=render();assert.equal(find(tree,'id','confirm-setting-preset').disabled,true)
 find(tree,'id','cancel-setting-preset').onClick();tree=render();find(tree,'data-setting-preset','grocery').onClick();tree=render();find(tree,'id','confirm-setting-preset').onClick();settings.buffer_days=2;tree=render();assert.equal(find(tree,'id','undo-setting-preset').disabled,true)
})
