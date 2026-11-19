// Lifecycle: living. Dependency-free digest contracts, not a browser/visual QA pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const source=fs.readFileSync(new URL('../standalone/design/weekly-summary-gm-b.js',import.meta.url),'utf8')
const css=fs.readFileSync(new URL('../standalone/design/weekly-summary-gm-b.css',import.meta.url),'utf8')
const writer=fs.readFileSync(new URL('../standalone/design/xlsx-gm-b.js',import.meta.url),'utf8')
function context(extra={}){const c=vm.createContext({TextEncoder,Uint8Array,DataView,Date,...extra});vm.runInContext(writer+'\n'+source,c);return c}
const c=context(),plain=o=>JSON.parse(JSON.stringify(o))
const make=(sku,extra={})=>({item:{sku,name:'Product '+sku,unit:'m',supplier:'Supplier A',on_order:0,...extra.item},guidance:{quantity:10,order_by:'now',runout_date:'2026-11-02',...extra.guidance},bucket:extra.bucket||'order',meta:{supplier:'Supplier A',value:20,excess:null,...extra.meta}})
const model=(rows=[],extra={})=>c.weeklySummaryModel({rows,asOf:'2026-10-31',today:'2026-11-17',currency:'KD',source:'Synthetic test only',...extra})
function freeze(obj){if(obj&&typeof obj==='object'){Object.freeze(obj);for(const value of Object.values(obj))freeze(value)}return obj}
test('empty dataset has honest counts and all required report sections',()=>{
 const m=model();assert.equal(m.total,0);assert.equal(m.totals.count,0);assert.equal(m.totals.value,0)
 assert.equal(m.totals.costed,0);assert.equal(c.weeklySummaryValue(m,m.totals),'—')
 assert.deepEqual(plain(c.weeklySummarySections(m).map(s=>s.name)),['Overview','Supplier totals','Top 10 by urgency','Running out without an order','Late local orders','Top 5 excess stock','Needing data','Caveat'])
 assert.match(c.weeklySummaryText(m),/Stock snapshot · 2026-10-31/)
})
test('all rows, not filtered view; helper never mutates inputs',()=>{
 const rows=freeze([make('A'),make('B',{bucket:'healthy'}),make('C',{bucket:'needs-data',guidance:{reason:'Missing sales'}})])
 const before=JSON.stringify(rows),m=model(rows)
 assert.equal(m.total,3);assert.equal(m.totals.count,1);assert.equal(m.needingData.length,1)
 assert.equal(m.needingData[0].reason,'Missing sales');assert.equal(JSON.stringify(rows),before)
})
test('known-cost subtotal includes a real zero and keeps mixed units separate',()=>{
 const m=model([make('A'),make('B',{meta:{value:null},item:{unit:'pieces'}}),make('C',{meta:{value:0}})])
 assert.equal(m.totals.value,20);assert.equal(m.totals.missingCost,1);assert.equal(m.totals.costed,2)
 assert.equal(c.weeklySummaryValue(m,m.totals),'KD 20.00 (known costs only; 1 missing)') // money always 2 decimals
 assert.deepEqual(plain(m.totals.units),[{unit:'m',quantity:20},{unit:'pieces',quantity:10}])
 const unknown=model([make('U',{meta:{value:NaN}})]);assert.equal(c.weeklySummaryValue(unknown,unknown.totals),'Unknown — costs missing')
})
test('supplier totals cover all order-now rows and never collapse missing suppliers',()=>{
 const m=model([make('A'),make('B',{item:{supplier:''},meta:{supplier:'',value:3}}),make('C',{item:{supplier:'B'},meta:{supplier:'B',value:null}})])
 assert.equal(m.suppliers.length,3);assert.equal(m.suppliers.reduce((n,s)=>n+s.count,0),3)
 assert.equal(m.suppliers[0].supplier,'Supplier A');assert.equal(m.suppliers[1].supplier,'Supplier not assigned');assert.equal(m.suppliers[2].missingCost,1)
})
test('top ten urgency uses due then run-out then SKU, independently of input order',()=>{
 const rows=Array.from({length:13},(_,i)=>make(String(i).padStart(2,'0'),{guidance:{order_by:'2026-11-'+String(i+1).padStart(2,'0')}})).reverse()
 const m=model(rows);assert.equal(m.urgent.length,10);assert.equal(m.orderNow.length,13)
 assert.deepEqual(plain(m.urgent.map(r=>r.sku)),['00','01','02','03','04','05','06','07','08','09'])
 assert.deepEqual(plain(model([make('Z'),make('A')]).urgent.map(r=>r.sku)),['A','Z'])
})
test('14-day list is inclusive, snapshot-relative and includes already out',()=>{
 const rows=[make('past',{guidance:{runout_date:'2026-10-30'}}),make('boundary',{guidance:{runout_date:'2026-11-14'}}),make('later',{guidance:{runout_date:'2026-11-15'}}),make('held',{bucket:'needs-data'})]
 assert.deepEqual(plain(model(rows).runningOut.map(r=>r.sku)),['past','boundary'])
 assert.deepEqual(plain(model(rows,{today:'2030-01-01'}).runningOut.map(r=>r.sku)),['past','boundary'])
 assert.match(c.weeklySummarySections(model(rows))[3].note,/14 days of the stock snapshot/)
})
test('no-order list excludes file POs, detailed confirmed orders and local intent',()=>{
 const rows=[make('file',{item:{on_order:2}}),make('dated',{item:{planning_facts:{incoming_pos:[{remaining_qty:2,status:'confirmed'}]}}}),make('local'),make('unknown',{item:{on_order:undefined}}),make('cancelled',{item:{planning_facts:{incoming_pos:[{remaining_qty:2,status:'cancelled'}]}}})]
 const m=model(rows,{localOrders:[{sku:'local',expected_on:'2026-11-18'}]})
 assert.deepEqual(plain(m.runningOut.map(r=>r.sku)),['cancelled','unknown']);assert.equal(m.runningOut[1].incomingUnknown,true)
})
test('late local orders use the decision day, include missing products, and exclude today',()=>{
 const m=model([make('A')],{localOrders:[{sku:'A',qty:2,unit:'m',expected_on:'2026-11-16'},{sku:'gone',qty:1,unit:'rolls',expected_on:'2026-11-14'},{sku:'today',expected_on:'2026-11-17'},{sku:'bad',expected_on:'2026-02-30'}]})
 assert.deepEqual(plain(m.late.map(r=>r.sku)),['gone','A']);assert.equal(m.late[1].daysLate,1)
 assert.equal(m.late[0].name,'Product not in current file')
})
test('top five excess reuses finite worklist metadata rather than recomputing stock',()=>{
 const rows=Array.from({length:8},(_,i)=>make(String(i),{bucket:'overstocked',meta:{excess:i+1},item:{on_hand:NaN}}))
 rows.push(make('bad',{meta:{excess:Infinity}}),make('held',{bucket:'needs-data',meta:{excess:999}}))
 assert.deepEqual(plain(model(rows).excess.map(r=>r.excess)),[8,7,6,5,4])
})
test('malformed held planning facts cannot break the digest',()=>{
 const m=model([make('broken',{bucket:'needs-data',item:{planning_facts:{incoming_pos:{invalid:true}}},guidance:{reason:'Incoming orders need checking'}})])
 assert.equal(m.needingData.length,1);assert.equal(m.runningOut.length,0)
 assert.match(m.needingData[0].reason,/Incoming orders/)
})
test('date filters fail closed and support leap days',()=>{
 assert.equal(c.weeklySummaryDay('2026-02-30'),null);assert.equal(c.weeklySummaryDay('2028-02-29')+1,c.weeklySummaryDay('2028-03-01'))
 assert.equal(c.weeklySummaryDay('2026-1-01'),null);assert.equal(c.weeklySummaryDay('x'.repeat(100000)),null)
 const m=model([make('A')],{asOf:'bad',today:'bad',localOrders:[{sku:'A',expected_on:'2026-01-01'}]})
 assert.equal(m.runningOut.length,0);assert.equal(m.late.length,0)
})
test('copy and Excel share complete sections, caveats and literal untrusted content',()=>{
 const name='=HYPERLINK("evil") <img onerror=bad> عبدالله\nWEEKLY FAKE',rows=Array.from({length:25},(_,i)=>make(String(i),{bucket:'needs-data',item:{name},guidance:{reason:'Missing sales'}})),m=model(rows,{localOrderError:'Storage blocked'})
 const text=c.weeklySummaryText(m),sheets=c.weeklySummarySheets(m)
 assert.match(text,/25 products held/);assert.match(text,/Local order tracking unavailable/)
 assert.ok(!text.includes('عبدالله\nWEEKLY FAKE'));assert.ok(text.includes('<img onerror=bad>'))
 assert.equal(sheets.find(s=>s.name==='Needing data').rows.length,27,'all rows plus header and note')
 const bytes=c.wlXlsxWorkbook(sheets),decoded=new TextDecoder().decode(bytes)
 assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);assert.ok(decoded.includes('&lt;img onerror=bad&gt;'))
 assert.ok(decoded.includes('=HYPERLINK'));assert.ok(!decoded.includes('<f>'));assert.ok(decoded.includes('not in your ERP'))
})
test('digest workbook passes stdlib ZIP CRC and XML parsing for all eight sheets',()=>{
 const bytes=c.wlXlsxWorkbook(c.weeklySummarySheets(model([make('A')]))),python=process.env.PYTHON||'/usr/bin/python3'
 const result=spawnSync(python,['-c',`import sys,io,zipfile,xml.etree.ElementTree as ET
# Trusted test-generated OOXML only; no external XML, DTDs, or network input.
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
sheets=[n for n in z.namelist() if n.startswith('xl/worksheets/')]
assert len(sheets)==8
for name in z.namelist():
 if name.endswith('.xml') or name.endswith('.rels'): ET.fromstring(z.read(name))
print('8 worksheets: ZIP CRC and XML valid')`],{input:Buffer.from(bytes),encoding:'utf8'})
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/8 worksheets/)
})
// Minimal DOM contract harness; native focus trap, print layout and pixels still
// require browser evidence from the integrating parent.
class El{
 constructor(tag,text='',cls=''){this.tag=tag;this.textContent=text;this.className=cls;this.children=[];this.handlers={};this.isConnected=true;this.hidden=false;this.attrs={};this.classList={add(){},remove(){}}}
 append(...els){for(const el of els){el.parent=this;this.children.push(el)}}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(name,fn){this.handlers[name]=fn}
 querySelector(sel){for(const el of this.children){if(sel===el.tag)return el;const nested=el.querySelector(sel);if(nested)return nested}return null}
 focus(){this.focused=true}select(){this.selected=true}showModal(){this.open=true}close(){this.open=false;this.handlers.close?.()}
 remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(e=>e!==this)}
}
function ui(){
 const body=new El('body'),trigger=new El('button'),rows=[make('A')],orders={records:[],error:''},download=[]
 const doc={body,activeElement:trigger,getElementById:id=>body.children.find(el=>el.id===id)}
 const ctx=context({document:doc,node:(...args)=>new El(...args),wlBtn:(text,fn)=>{const el=new El('button',text);el.handlers.click=fn;return el},currentToday:'2026-11-17',localToday:()=> '2026-11-17',render:()=>assert.fail('unneeded render'),wlRefresh:()=>{},currentRows:rows,wlMeta:r=>r.meta,data:{as_of:'2026-10-31'},settings:{currency:'KD'},sourceName:'demo',localOrders:orders,navigator:{clipboard:{writeText:async()=>{throw Error('denied')}}},window:{print:()=>{}},wlDownload:(...args)=>download.push(args)})
 return {ctx,body,trigger,rows,orders,download}
}
function buttons(el){return el.children.flatMap(child=>[...(child.tag==='button'?[child]:[]),...buttons(child)])}
test('dialog opens once, keeps read-only source state, copies with fallback and restores focus',async()=>{
 const u=ui(),before=JSON.stringify([u.rows,u.orders]),d=u.ctx.weeklySummaryOpen()
 assert.equal(d.open,true);assert.equal(u.body.children.length,1)
 assert.equal(u.ctx.weeklySummaryOpen(),d);assert.equal(u.body.children.length,1)
 await buttons(d).find(b=>b.textContent==='Copy text').handlers.click()
 const text=d.querySelector('textarea');assert.equal(text.hidden,false);assert.equal(text.readOnly,true);assert.equal(text.selected,true)
 assert.match(text.value,/WEEKLY STOCK SUMMARY/)
 buttons(d).find(b=>b.textContent==='Download Excel').handlers.click();assert.equal(u.download.length,1)
 assert.equal(u.download[0][1],'stock-runway-weekly-2026-10-31.xlsx')
 buttons(d).find(b=>b.textContent==='Close').handlers.click();assert.equal(u.body.children.length,0);assert.equal(u.trigger.focused,true)
 assert.equal(JSON.stringify([u.rows,u.orders]),before)
})
test('printing is A4, hides app controls and removes modal clipping',()=>{
 assert.match(css,/@page\s*\{\s*size:A4 portrait/);assert.match(css,/> :not\(\.weekly-summary\)/)
 // Intentional: screen-only truncation note must not appear in complete print lists.
 assert.match(css,/max-height:none!important/);assert.match(css,/\.weekly-summary-actions,\.weekly-summary-status,\.weekly-summary-copy,\.weekly-summary-screen-only \{ display:none!important/)
})
test('renderer has no HTML injection, new workbook implementation or persistent writes',()=>{
 assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|new Function|localStorage\.setItem/.test(source))
 assert.match(source,/wlXlsxWorkbook\(weeklySummarySheets\(model\)\)/)
 assert.ok(!/function weeklySummary(?:Zip|Crc|Xml)/.test(source))
})
