import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source=fs.readFileSync('desktop/plugin.js','utf8')
const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.parse=parseCsv',context)
const parse=(text,options)=>JSON.parse(JSON.stringify(context.parse(text,options)))
const headers=['sku','name','unit','on_hand','supplier_days','2026-08','2026-09','2026-10']
const base=['A','Widget','units','100','7','150','150','150']
const csv=(headers,rows,delimiter=',')=>[headers,...rows].map(row=>row.map(v=>'"'+v.replaceAll('"','""')+'"').join(delimiter)).join('\r\n')+'\r\n'

for(const quantities of [['25',''],['','25'],['','']])test(`IMPORT-01 blank lot quantity stays unknown ${JSON.stringify(quantities)}`,()=>{
 const rows=quantities.map((qty,i)=>[...base,['L','M'][i],'2027-02-28',qty])
 const data=parse(csv([...headers,'lot','expiry','lot_qty'],rows)),item=data.items[0]
 assert.equal(item.on_hand,100)
 assert.deepEqual(item.monthly_sales,[150,150,150])
 assert.deepEqual(item.lots||[],quantities.flatMap((qty,i)=>qty?[{lot:['L','M'][i],expiry:'2027-02-28',qty:25}]:[]))
 assert.equal(data.import_report.rows_imported,2)
 assert.match(item.expiry_warnings.join(' '),/lot stock unknown/)
 assert.match(data.import_report.warnings.join(' '),/lot stock unknown/)
})
test('IMPORT-01 zero is explicit; missing quantity column retains legacy lot-stock summing',()=>{
 const explicit=parse(csv([...headers,'lot','expiry','lot_qty'],[['25','L'],['0','M']].map(([qty,lot])=>[...base,lot,'2027-02-28',qty]))).items[0]
 assert.equal(explicit.on_hand,100)
 assert.deepEqual(explicit.lots.map(l=>l.qty),[25,0])
 assert.doesNotMatch(explicit.expiry_warnings.join(' '),/unknown/)
 const implicit=parse(csv([...headers,'lot','expiry'],['L','M'].map(lot=>[...base,lot,'2027-02-28']))).items[0]
 assert.equal(implicit.on_hand,200)
 assert.deepEqual(implicit.lots.map(l=>l.qty),[100,100])
})
test('IMPORT-01 unknown lot rows retain one snapshot per warehouse',()=>{
 const rows=['North','South'].flatMap(location=>[['L',''],['M','25']].map(([lot,qty])=>[...base,location,lot,'2027-02-28',qty]))
 const item=parse(csv([...headers,'Warehouse','lot','expiry','lot_qty'],rows)).items[0]
 assert.equal(item.on_hand,200)
 assert.deepEqual(item.monthly_sales,[300,300,300])
 assert.deepEqual(item.lots,[{lot:'M',expiry:'2027-02-28',qty:50}])
})
for(const value of ['Widget\rSpecial','Widget\r\nSpecial','Widget\nSpecial','Widget\r"Special"'])test(`IMPORT-04 quoted CR/LF preserved ${JSON.stringify(value)}`,()=>{
 const row=[...base];row[1]=value
 for(const strict of [false,true])assert.equal(parse(csv(headers,[row]),{strict}).items[0].name,value)
})
for(const field of ['on_hand','supplier_days','2026-08','on_order','unit_cost','lot_qty'])test(`IMPORT-06 price cannot resolve ambiguous ${field}`,()=>{
 const h=[...headers],row=[...base]
 if(h.includes(field))row[h.indexOf(field)]='1.234'
 else{h.push(field);row.push('1.234');if(field==='lot_qty'){h.push('lot','expiry');row.push('L','2027-02-28')}}
 for(const price of [null,'','2,50'])assert.throws(()=>parse(csv(price===null?h:[...h,'sale_price'],[price===null?row:[...row,price]],';')),/ambiguous number format/)
})
test('IMPORT-06 price cannot invalidate legacy dot decimals',()=>{
 const h=[...headers,'unit_cost','on_order'],row=[...base,'1.25','0.5'];row[3]='1.5'
 const control=parse(csv(h,[row],';')).items[0]
 const actual=parse(csv([...h,'sale_price'],[[...row,'2,50']],';')).items[0]
 assert.equal(actual.sale_price,2.5);delete actual.sale_price
 assert.deepEqual(actual,control)
})
test('IMPORT-06 existing comma evidence and price-only comma remain valid',()=>{
 const h=[...headers,'unit_cost'],row=[...base,'2,50'];row[3]='1.234'
 const control=parse(csv(h,[row],';')).items[0],actual=parse(csv([...h,'sale_price'],[[...row,'3,50']],';')).items[0]
 assert.equal(control.on_hand,1234);assert.equal(actual.sale_price,3.5);delete actual.sale_price
 assert.deepEqual(actual,control)
 const item=parse(csv([...headers,'sale_price'],[[...base,'€ 2,50']],';')).items[0]
 assert.equal(item.on_hand,100);assert.equal(item.sale_price,2.5)
})
