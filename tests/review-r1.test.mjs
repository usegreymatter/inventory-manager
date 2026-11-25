import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import pythonStdin from './python-stdin.cjs'
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={reviewInputMeaning,attachInputMeaning,understandStockWorkbook,parseStockImport,calculate,orderGuidance,whyBreakdown,whyThisAmount}',ctx)
const api=ctx.api,plain=x=>JSON.parse(JSON.stringify(x))
const stock=(held='')=>[{name:'Stock',rows:[['sku','name','unit','Available','reserved','2026-07','2026-08','2026-09'],['A','Alpha','kg','13.3',held,'100','100','100']]}]
function meaning(sheets,choices={}){
 const report=plain(api.understandStockWorkbook(sheets)),today='2026-11-19',r=plain(api.reviewInputMeaning(sheets,report,choices,today))
 const code="import importlib,json,sys,types\np=types.ModuleType('r1');p.__path__=['.'];sys.modules['r1']=p\nm=importlib.import_module('r1.input_meaning');a=json.load(sys.stdin);r=m.review_input_meaning(**a);d=m.attach_input_meaning({'items':[{'sku':'A','on_order':500}]},r);print(json.dumps({'review':r,'data':d}))"
 const py=pythonStdin(['-c',code],JSON.stringify({sheets,report,raw_choices:choices,today}))
 assert.equal(py.status,0,py.stderr)
 const expected=JSON.parse(py.stdout),data=plain(api.attachInputMeaning({items:[{sku:'A',on_order:500}]},r))
 // Attachment now replaces sorted warning arrays in its VM realm; compare JSON values, not prototypes.
 assert.deepEqual(plain(r),expected.review);assert.deepEqual(data,expected.data)
 return {r,data}
}
test('A: joined incoming survives attachment unless explicitly not in file',()=>{
 const sheets=stock();sheets.push({name:'Incoming',rows:[['sku','on_order'],['A','500']]})
 assert.equal(meaning(sheets).data.items[0].on_order,500)
 const original=api.understandStockWorkbook(sheets),review=api.reviewInputMeaning(sheets,original,{},'2026-11-19'),joined=api.understandStockWorkbook(review.sheets)
 const csv=joined.canonical_rows.map(r=>r.map(v=>'\"'+String(v??'').replaceAll('\"','\"\"')+'\"').join(',')).join('\n')
 const parsed=api.parseStockImport(csv),before=plain(parsed.items[0]);assert.equal(before.on_order,500)
 const attached=api.attachInputMeaning(parsed,review);assert.equal(attached.items[0].on_order,500)
 const g=raw=>{const item=api.calculate([raw],parsed.months,parsed.as_of,6,{},'2026-11-19')[0];Object.assign(item,{on_hand:raw.on_hand,monthly_sales:raw.monthly_sales});return plain(api.orderGuidance(item,'2026-11-19',{}))}
 assert.deepEqual(g(attached.items[0]),g(before),'joined accepted supply preserves the purchase estimate')
 assert.equal(meaning(sheets,{incoming_not_in_file:true}).data.items[0].on_order,undefined)
})
test('C/D/G: reserved blank, oversold, decimal subtraction and double-subtraction warning',()=>{
 const choices={stock_includes_reserved:true}
 assert.equal(meaning(stock(''),choices).r.sheets[0].rows[1][3],'13.3')
 const over=meaning(stock('20'),choices).r
 assert.equal(over.sheets[0].rows[1][3],'0');assert.ok(over.warnings.some(s=>s.includes('Oversold: reserved exceeds stock')))
 assert.equal(over.rows_kept,1);assert.equal(over.rows_flagged,1)
 const decimal=meaning(stock('3.1'),choices).r
 assert.equal(decimal.sheets[0].rows[1][3],'10.2')
 assert.ok(decimal.warnings.some(s=>s.includes('already available')))
})
test('reserved subtraction preserves scientific and high-precision decimals',()=>{
 for(const [s,h,want]of [['0.00003','0.00001','0.00002'],['0.0000003','0.0000002','0.0000001'],['1.0000000000001','0','1.0000000000001']]){const sheets=stock(h);sheets[0].rows[1][3]=s;assert.equal(meaning(sheets,{stock_includes_reserved:true}).r.sheets[0].rows[1][3],want)}
})
test('attached review counts reflect final accepted records and unknown incoming flags',()=>{
 const sheets=stock(),r=plain(api.reviewInputMeaning(sheets,api.understandStockWorkbook(sheets),{},'2026-11-19'))
 const data=api.attachInputMeaning({items:[{sku:'A'}],import_report:{rows_imported:1}},r)
 assert.equal(data.input_meaning.rows_flagged,1);assert.equal(data.input_meaning.rows_kept,1)
 const r2=plain(api.reviewInputMeaning(sheets,api.understandStockWorkbook(sheets),{},'2026-11-19'));assert.equal(api.attachInputMeaning({items:[],import_report:{rows_imported:0}},r2).input_meaning.rows_kept,0)
})
test('G: unit mismatch requires acknowledgement even with complete rows',()=>{
 const sheets=stock();sheets[0].rows[0].push('Sales unit');sheets[0].rows[1].push('boxes')
 assert.equal(meaning(sheets).r.requires_ack,true)
})
test('B/C/G: bounded pack attribution, human numbers and reconciled displayed terms (sample/demo/400 seeds)',()=>{
 const cases=[]
 for(const sales of [[33.635,33.635,33.635],[0.001,0.001,0.001],[0.002,0.001,0.001]])cases.push({item:{sku:'TINY',name:'Decimal',unit:'kg',on_hand:0,monthly_sales:sales},months:['2026-08','2026-09','2026-10'],as_of:'2026-10-31',today:'2026-11-01'})
 for(const name of ['sample','demo-1000']){const d=JSON.parse(fs.readFileSync('data/'+name+'.json'));for(const item of d.items)cases.push({item,months:d.months,as_of:d.as_of,today:d.as_of})}
 let seed=93871;const rand=n=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n)
 for(let i=0;i<400;i++)cases.push({item:{sku:'R'+i,name:'Random',unit:i%2?'kg':'m',on_hand:rand(1000)/10,monthly_sales:Array.from({length:3},()=>i%7?rand(900)/100:0)},months:['2026-08','2026-09','2026-10'],as_of:'2026-10-31',today:'2026-11-01'})
 const py=pythonStdin(['tests/why_amount_bridge.py'],JSON.stringify(cases));assert.equal(py.status,0,py.stderr);const expected=JSON.parse(py.stdout)
 for(const [i,c]of cases.entries()){
  const item=api.calculate([c.item],c.months,c.as_of,6,{},c.today)[0];Object.assign(item,{on_hand:c.item.on_hand,monthly_sales:c.item.monthly_sales})
  const g=api.orderGuidance(item,c.today,{}),rows=plain(api.whyBreakdown(item,c.today,{})),sentence=api.whyThisAmount(item,c.today,{})
  assert.deepEqual({quantity:g.quantity??null,rows,sentence},expected[i],c.item.sku+' parity')
  if(g.quantity==null)continue
  const pack=c.item.pack_size||1
  for(const r of rows.filter(r=>r.key==='policy_cap'))assert.ok(Math.abs(r.qty)>=1e-9,'not a noise policy cap')
  for(const r of rows.filter(r=>r.key==='pack_rounding'))assert.ok(Math.abs(r.qty)<pack,`${c.item.sku} pack ${r.qty}`)
  assert.doesNotMatch(sentence, /\d\.\d{7,}|\de[+-]\d+|arithmetic reconciliation/)
  const qty=sentence.match(/^Suggested order: ([\d.]+) (.*?) = /);assert.ok(qty,sentence);assert.equal(qty[2],c.item.unit||'units')
  const terms=[...sentence.matchAll(/([+-]?\d+(?:\.\d+)?) \[/g)].map(m=>m[1])
  const scale=s=>Math.round(Number(s)*100);assert.equal(terms.reduce((a,s)=>a+scale(s),0),scale(qty[1]),c.item.sku+' displayed sum')
 }
})
