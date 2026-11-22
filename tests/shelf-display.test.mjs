import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
test('commercial clearance renders hostile lot names as text with date and quantity',()=>{
 const start=source.indexOf('function ClearanceSection('),end=source.indexOf('// END SHELF LIFE DISPLAY',start)
 assert.ok(start>=0&&end>start,'clearance display exists')
 const jsx=(type,props)=>({type,props}),ctx=vm.createContext({jsx,jsxs:jsx,muted:{},sectionStyle:{}})
 vm.runInContext(source.slice(start,end)+'\nthis.view=ClearanceSection',ctx)
 const hostile='<img src=x onerror=alert(1)>',rows=[{sku:'S',name:'Synthetic',lot:hostile,clear_by:'2026-11-03',at_risk_qty:50,unit:'units',expiry:'2026-11-05'}]
 const result=JSON.stringify(ctx.view({rows}))
 assert.ok(result.includes(hostile));assert.ok(result.includes('2026-11-03'));assert.ok(result.includes('50'))
 assert.ok(result.includes('commercial'));assert.ok(!result.includes('dangerouslySetInnerHTML'))
 assert.equal(ctx.view({rows:[]}),null)
 assert.ok(source.includes('data-shelf-capped'))
 assert.ok(source.includes('jsx(ClearanceSection,'),'wired into app')
})
