// Synthetic presentation-only regression: execute the actual import preview renderer.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync('standalone/design/smart-import.js','utf8')
test('hidden sheet warnings appear once in the dedicated notice, not repeated in general warnings',()=>{
 const all=[]
 function el(tag,text,cls){const n={tag,text,cls,children:[],dataset:{},append(...nodes){this.children.push(...nodes)},replaceChildren(){this.children=[]},contains(){return false},setAttribute(){},addEventListener(){}};all.push(n);return n}
 const body=el('div'),hidden='Ignored hidden sheet: Synthetic old stock'
 const state={file:{name:'synthetic.xlsx'},report:{sheets:[],warnings:[hidden,hidden,'Other check'],missing:[]},meaning:{warnings:[],reasons:[]},choices:{units_confirmed:false},parsed:{items:[],import_report:{warnings:[hidden,'Other check'],rows_set_aside:[],defaulted:[],matched:[]}}}
 const before=JSON.stringify(state)
 const c=vm.createContext({el,body,document:{activeElement:null},preflight(){},disclosure(){},use:{},disabledReason:{}})
 vm.runInContext(source.slice(source.indexOf('  function draw(state){'),source.indexOf('  async function load('))+'\nthis.draw=draw',c)
 c.draw(state)
 assert.equal(all.filter(n=>n.text===hidden).length,1)
 assert.equal(all.find(n=>n.text===hidden).cls,'smart-import-hidden-sheet')
 assert.equal(all.filter(n=>n.text==='Other check').length,1)
 assert.equal(JSON.stringify(state),before,'deduplication never edits parser warnings')
})
test('urgency subtitle explains buying deadline, lead time and run-out rather than changing counts',()=>{
 const worklist=fs.readFileSync('standalone/design/worklist-gm-b.js','utf8')
 const c=vm.createContext({node:(tag,text,cls)=>({tag,text,cls}),wlSummary:{after(n){c.note=n}}})
 vm.runInContext(worklist.slice(worklist.indexOf('const wlUrgencyNote='),worklist.indexOf('const wlLeadNote=')),c)
 assert.equal(c.note.tag,'p');assert.equal(c.note.id,'work-urgency-note')
 assert.match(c.note.text,/Order now uses the “Order now within N days” setting and includes supply gaps/)
 assert.match(c.note.text,/High risk = more than 40% estimated chance of running out before arrival/)
 assert.match(c.note.text,/7-day count uses the stock run-out date/)
 assert.match(c.note.text,/Deadlines allow for supplier lead time/)
})
test('existing Order now bucket includes future deadlines within the configured window and positive-quantity gaps',()=>{
 const plugin=fs.readFileSync('desktop/plugin.js','utf8')
 const c=vm.createContext({normalizeOrderSettings:s=>s,orderGuidance:i=>i.guidance,dateOrdinal:s=>/^\d{4}-\d{2}-\d{2}$/.test(s)?Date.parse(s+'T00:00:00Z')/86400000:null})
 vm.runInContext(plugin.slice(plugin.indexOf('function orderBucketPass('),plugin.indexOf('const formatDateFromToday'))+'\nthis.bucket=orderBucketPass',c)
 const item={guidance:{quantity:10,order_by:'2026-11-27',runout_date:'2026-12-10',status:'order',supply_gap:false}}
 assert.equal(c.bucket(item,'2026-11-24',{urgent_days:7,running_low_days:30}),'order','future deadline, not physical runout within seven days')
 assert.equal(c.bucket(item,'2026-11-24',{urgent_days:1,running_low_days:30}),'running-low','Order now window is configurable')
 item.guidance.supply_gap=true
 assert.equal(c.bucket(item,'2026-11-24',{urgent_days:1,running_low_days:30}),'order')
 item.guidance.quantity=0
 assert.equal(c.bucket(item,'2026-11-24',{urgent_days:1,running_low_days:30}),'running-low','zero-quantity gap is not an order')
})
