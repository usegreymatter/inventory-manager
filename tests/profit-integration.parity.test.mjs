import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa});
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ',''),ctx);
const cases=Array.from({length:100},(_,i)=>({sku:'INT-'+i,name:'Synthetic',unit:'u',on_hand:i%4?i*1.25:0,on_order:i%3?i:0,
 supplier_days:i%25,unit_cost:10,sale_price:i%9===0?null:20,monthly_sales:Array.from({length:12},(_,j)=>(j%4+1)*(i+1)),receipts:{'2026-11':i%5?0:100,'2026-12':i%7?0:1000}}));
const bridge=spawnSync('/usr/bin/python3',['-c',`import json,sys,engine\nmonths=[engine.month_after('2025-10',i) for i in range(1,13)]\nresult=[]\nfor raw in json.load(sys.stdin):\n settings={'profit_suggestion':True,'months_of_cover':2}\n p=engine.forecast(raw,months,'2026-10-31',settings=settings)\n item={**raw,**p,'on_hand':raw['on_hand'],'monthly_sales':raw['monthly_sales'],'as_of':'2026-10-31'}\n g=engine.order_guidance(item,'2026-11-17',settings)\n result.append(g.get('profit_suggestion'))\njson.dump(result,sys.stdout,allow_nan=False)`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(cases),encoding:'utf8'});
assert.equal(bridge.status,0,bridge.stderr);const expected=JSON.parse(bridge.stdout);
test('100 engine/desktop integrated suggestions match exactly with dated receipts and missing prices',()=>{
 ctx.inputs=cases;
 const result=vm.runInContext(`(()=>{const months=Array.from({length:12},(_,i)=>monthAfter('2025-10',i+1)),settings={profit_suggestion:true,months_of_cover:2};return inputs.map(raw=>{const p=calculate([raw],months,'2026-10-31',6,settings)[0],item={...raw,...p,on_hand:raw.on_hand,monthly_sales:raw.monthly_sales,as_of:'2026-10-31'};return orderGuidance(item,'2026-11-17',settings).profit_suggestion??null})})()`,ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
});
