import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'

const source=fs.readFileSync('desktop/plugin.js','utf8')
const weekly='Profit suggestion is less reliable with weekly ordering or deliveries already on the way — in tests it filled less demand. Use the standard amount if running out is costly.'
function context(){
 const c=vm.createContext({})
 vm.runInContext(fs.readFileSync('desktop/profit-warnings.js','utf8'),c)
 return c
}
test('warning decisions have exact Python/JS parity; inputs and suggestion bytes stay unchanged',()=>{
 const c=context(),cases=[]
 for(const review of [0,7,29,30,31,365])for(const incoming of [undefined,0,1,50])for(const cap of [undefined,0,99,100,101])for(const enabled of [false,true]){
  cases.push([{on_order:incoming},{...(enabled?{profit_suggestion:{qty:100,expected_profit:123.45}}:{}),shelf_cap_qty:cap,quantity:80},review])
 }
 const before=JSON.stringify(cases)
 const actual=cases.map(args=>c.StockRunwayProfitWarnings.warning(...args))
 const result=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c','import json,sys; from profit_warnings import profit_suggestion_warning; print(json.dumps([profit_suggestion_warning(*a) for a in json.load(sys.stdin)]))'],{input:JSON.stringify(cases),encoding:'utf8'})
 assert.equal(result.status,0,result.stderr);assert.deepEqual(actual,JSON.parse(result.stdout));assert.equal(JSON.stringify(cases),before)
 assert.equal(c.StockRunwayProfitWarnings.warning({on_order:1},{profit_suggestion:{qty:100},shelf_cap_qty:90},7),weekly)
})
test('Desktop warning lives outside protected core and uses React text children',()=>{
 assert.ok(source.indexOf('const pageStyle =')<source.indexOf('StockRunwayProfitWarnings'))
 assert.ok(source.includes("'data-profit-suggestion-warning':true"))
 assert.ok(source.includes('children:activeProfitWarning'))
 assert.ok(!source.includes('dangerouslySetInnerHTML'))
})
test('standalone product page and side panel retain text-only warning beside the suggestion',()=>{
 const c=context(),adapter=fs.readFileSync('standalone/design/profit-order-gm-b.js','utf8')
 c.node=(tag,text,cls)=>({tag,textContent:text,className:cls,style:{},dataset:{},children:[],append(...children){this.children.push(...children)}})
 c.profitSuggestionSentence=()=>'<img src=x onerror=alert(1)>'
 c.resolveOrderSettings=()=>({values:{review_days:7}});c.settings={};c.drawProductPage=()=>{};c.chartPanel=()=>{};c.productPage={}
 vm.runInContext(adapter,c)
 const row={item:{sku:'<script>',on_order:1},guidance:{profit_suggestion:{qty:100},shelf_cap_qty:90}}
 const before=JSON.stringify(row),line=c.profitOrderLine(row)
 assert.equal(line.textContent,'<img src=x onerror=alert(1)>')
 assert.equal(line.children[0].textContent,weekly)
 assert.equal(line.children[0].dataset.profitSuggestionWarning,'true')
 assert.equal(JSON.stringify(row),before)
 assert.ok(adapter.includes('const profitDrawBase=drawProductPage'))
 assert.ok(adapter.includes('const profitPanelBase=chartPanel'))
})
