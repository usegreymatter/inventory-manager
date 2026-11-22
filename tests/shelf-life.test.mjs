import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
const root=new URL('../',import.meta.url),src=fs.readFileSync(new URL('desktop/plugin.js',root),'utf8')
const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(src.slice(src.indexOf('const SAMPLE ='),src.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.s={orderGuidance,orderBucket,clearanceList,whyBreakdown,whyThisAmount,validateOrderSettings}',ctx)
const plain=x=>JSON.parse(JSON.stringify(x)),item=()=>({sku:'S',name:'Synthetic',unit:'units',monthly_sales:[300,300,300],monthly_demand:300,seasonal:false,on_hand:0,supplier_days:0,receipts:{},as_of:'2026-10-31'})
test('hand-worked short life, packs, MOQ and explanation',()=>{
 const s={shelf_life_days:10},i=item()
 assert.equal(ctx.s.orderGuidance(i,'2026-10-31',s).quantity,100)
 i.pack_size=24;assert.equal(ctx.s.orderGuidance(i,'2026-10-31',s).quantity,96)
 i.minimum_order=120;const g=ctx.s.orderGuidance(i,'2026-10-31',s)
 assert.equal(g.quantity,0);assert.equal(g.status,'shelf-conflict');assert.match(g.cap_reason,/120.*96/)
 assert.match(ctx.s.whyThisAmount(i,'2026-10-31',s),/shelf-life cap/)
})
test('explicit shelf ledger and raw invalid settings fail closed',()=>{
 const rows=plain(ctx.s.whyBreakdown(item(),'2026-10-31',{shelf_life_days:10}))
 assert.ok(rows.some(r=>r.key==='shelf_life_cap'));assert.equal(rows.reduce((a,r)=>a+r.qty,0),100)
 for(const value of [0,-1,true,1.5,'10'])assert.equal(ctx.s.orderGuidance(item(),'2026-10-31',{shelf_life_days:value}).status,'needs-data')
})
test('clearance list is FEFO, commercial, and capped zero is never healthy',()=>{
 const i=item();i.on_hand=200;i.supplier_days=2;i.lots=[{lot:'<img src=x onerror=alert(1)>',expiry:'2026-10-30',qty:100},{lot:'B',expiry:'2026-11-05',qty:100}]
 const rows=plain(ctx.s.clearanceList([i],'2026-10-31',{},i.as_of))
 assert.equal(rows.length,2);assert.equal(rows[0].at_risk_qty,100);assert.equal(rows[1].clear_by,'2026-11-03')
 assert.equal(rows[0].lot,i.lots[0].lot)
 const s={shelf_life_days:10};i.lots=[];i.minimum_order=120;i.pack_size=24;i.on_hand=0
 assert.equal(ctx.s.orderBucket(i,'2026-10-31',s),'needs-data')
})
test('scratch-built offline single file executes the same shelf-life core',()=>{
 fs.mkdirSync(new URL('.scratch/',root),{recursive:true})
 const path=new URL('.scratch/shelf-life-test.html',root)
 execFileSync(process.env.PYTHON||'/usr/bin/python3',['standalone/build.py','--output',path.pathname],{cwd:root,encoding:'utf8'})
 const html=fs.readFileSync(path,'utf8'),code=html.split('/* STOCK_RUNWAY_CORE_START */\n')[1].split('/* STOCK_RUNWAY_CORE_END */')[0]
 const offline=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
 vm.runInContext(code.replaceAll('export ','')+'\nthis.api={orderGuidance}',offline)
 assert.equal(offline.api.orderGuidance(item(),'2026-10-31',{shelf_life_days:10}).quantity,100)
})
test('2000 random exact Python/JS guidance parity and monotonic life',()=>{
 let seed=327810;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
 const cases=[]
 for(let n=0;n<2000;n++){
  const i=item();i.on_hand=next()%400;i.supplier_days=next()%20;i.pack_size=[1,12,.25][next()%3]
  const level=next()%1000;i.monthly_sales=[level,level,level];i.monthly_demand=level
  if(n%3===0)i.lots=[{lot:'old',expiry:'2026-11-05',qty:i.on_hand}]
  if(n%4===0)i.monthly_sales=[level/2,level,level*1.5]
  if(n%5===0)i.on_order=next()%20
  if(n%6===0)i.receipts={'2026-11':next()%100,'2026-12':next()%100}
  if(n%11===0)i.lots=[{lot:'a',expiry:'2026-11-05',qty:i.on_hand/3},{lot:'b',expiry:'2026-11-10',qty:i.on_hand*2/3}]
  cases.push({item:i,settings:{months_of_cover:[0,.5,2][next()%3],buffer_days:next()%15,shelf_life_days:1+next()%180,arrival_age_days:next()%20,min_remaining_life_days:next()%10}})
 }
 const py=`import json,sys,types\np=types.ModuleType('shelf_parity');p.__path__=['.'];sys.modules['shelf_parity']=p\nfrom shelf_parity.engine import order_guidance\nprint(json.dumps([order_guidance(c['item'],'2026-10-31',c['settings']) for c in json.load(sys.stdin)],allow_nan=True))`
 const expected=JSON.parse(execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8',maxBuffer:30*1024*1024}).replaceAll('Infinity','null'))
 cases.forEach((c,n)=>{
  const a=plain(ctx.s.orderGuidance(c.item,'2026-10-31',c.settings));assert.deepEqual(a,expected[n],`case ${n}`)
  const longer=ctx.s.orderGuidance(c.item,'2026-10-31',{...c.settings,shelf_life_days:c.settings.shelf_life_days+30})
  assert.ok(longer.quantity>=a.quantity,`monotonic ${n}`)
 })
})
