import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
const ctx=vm.createContext({TextEncoder,TextDecoder,Date,Intl})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={calculate,orderGuidance,whyBreakdown}',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x)),as_of='2026-10-31',today='2026-11-01'

test('core why: exact numeric totals, full parity and purity across 400 seeds plus goldens',()=>{
 const corpus=JSON.parse(fs.readFileSync(new URL('./golden/phase2-inputs.json',import.meta.url),'utf8'))
 const manual=JSON.parse(fs.readFileSync(new URL('./golden/manual-inputs.json',import.meta.url),'utf8'))
 const cases=[...corpus.cases,...manual.cases].map(c=>({...c,as_of,today}))
 const late=structuredClone(cases.find(c=>c.item.sku==='SAME-DAY-SUPPLY'));late.item.planning_facts.incoming_pos[0].due_date='2026-10-31';cases.push(late)
 let seed=537181;const rand=n=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n)
 for(let i=0;i<400;i++){
  const n=3+rand(16),months=Array.from({length:n},(_,j)=>new Date(Date.UTC(2026,9+j-n+1,1)).toISOString().slice(0,7))
  const sales=months.map(()=>rand(4000)/100),item={sku:'A',name:'Synthetic',unit:'box',on_hand:[0,.1,25,1e12][rand(4)],supplier_days:rand(30),monthly_sales:sales,receipts:{}}
  if(rand(2))item.planning_facts={version:'1.0',sales_history:months.map((month,j)=>({sku:'A',month,quantity:sales[j],in_stock_days:[1,10,28][rand(3)],backorder:Boolean(rand(3)),project:rand(7)===0}))}
  if(rand(2))item.demand_change_pct=[-90,-37.5,0,50,300,null][rand(6)]
  if(!item.planning_facts&&rand(2))item.on_order=rand(20)/10
  const settings={big_order_months:6,include_backup_in_orders:Boolean(rand(2)),months_of_cover:[.5,2,3.5][rand(3)],product_overrides:{A:{pack_size:[.000001,.1,.125,.3,4][rand(5)],minimum_order:[0,.4,10][rand(3)]}}}
  cases.push({item,months,as_of,today,settings})
 }
 const py=spawnSync('/usr/bin/python3',['tests/why_bridge.py'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,TMPDIR:process.cwd()+'/.scratch'}})
 assert.equal(py.status,0,py.stderr);const expected=JSON.parse(py.stdout);assert.equal(expected.length,425)
 cases.forEach((c,i)=>{
  const item=api.calculate([c.item],c.months,as_of,6,c.settings||{},today)[0],saved=JSON.stringify(item),g=api.orderGuidance(item,today,c.settings||{}),rows=plain(api.whyBreakdown(item,today,c.settings||{}))
  assert.equal(JSON.stringify(item),saved,`mutation ${i}`)
  assert.deepEqual({quantity:g.quantity??null,rows},expected[i],`why seed ${i}: ${JSON.stringify(c)}`)
  if(g.quantity==null){assert.equal(rows.length,1);assert.equal(rows[0].qty,null)}
  else assert.equal(rows.reduce((a,r)=>a+r.qty,0),g.quantity,`exact total ${i}`)
 })
})
