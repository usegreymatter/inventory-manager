import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),fm=require('../forecast_methods.js');
const root=new URL('../',import.meta.url);
const src=fs.readFileSync(new URL('desktop/plugin.js',root),'utf8');
const core=src.slice(src.indexOf('const SAMPLE ='),src.indexOf('const pageStyle ='));
const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa});
vm.runInContext(core.replaceAll('export ','')+'\nglobalThis.qa={calculate,orderGuidance,forecastDetails,validateOrderSettings,StockRunwayForecastMethods}',ctx);
const api=ctx.qa,plain=x=>JSON.parse(JSON.stringify(x));

test('recommended API, all 12 forecast points and evidence: 600 seeded random histories Python/JS parity',()=>{
 let seed=123456;
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32};
 const cases=[];
 for(let i=0;i<600;i++){
   const n=i<10?i:20+Math.floor(next()*90),scale=i%7===0?1e12:i%11===0?1e-12:1000;
   const values=Array.from({length:n},(_,k)=>i%4===0?(k%12<3?scale:scale/20):next()<.25?0:next()*scale);
   cases.push({values,previous:i%3?null:fm.RECOMMEND_CANDIDATES[i%5],stockout_adjust:!!(i%2)});
 }
 const py="import json,sys,forecast_methods as f\nprint(json.dumps([f.recommend(**c) for c in json.load(sys.stdin)]))";
 const expected=JSON.parse(execFileSync('/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8',maxBuffer:64*1024*1024}));
 cases.forEach((c,i)=>assert.deepEqual(fm.recommend(c.values,c.previous,c.stockout_adjust),expected[i],'case '+i));
 assert.ok(core.includes(fs.readFileSync(new URL('forecast_methods.js',root),'utf8')));
});

test('recommended adapter is opt-in, works in both engines, includes reason, no borrowed risk ranges',()=>{
 const values=[20,30,250,40,10,100,20,20,10,50,10,20];
 const months=Array.from({length:36},(_,i)=>`${2030+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`);
 const item={sku:'SYNTH',name:'Synthetic',unit:'u',on_hand:10,supplier_days:14,monthly_sales:[...values,...values,...values]};
 const settings={forecast_method:'recommended'},asof='2032-12-31';
 api.validateOrderSettings(settings);
 const got=api.calculate([item],months,asof,12,settings,asof)[0];
 assert.equal(got.held,false);assert.match(got.forecast_method.label,/Method picked: .* because /);
 assert.deepEqual(plain(got.projection.map(p=>p.demand)),fm.recommend(item.monthly_sales).forecast);
 const g=api.orderGuidance(got,asof,settings),detail=api.forecastDetails(got,g,settings);
 assert.equal(detail.scenarios,null);assert.match(detail.note,/calibration/);
 const py="import json,sys,engine\nc=json.load(sys.stdin)\nf=engine.forecast(c['item'],c['months'],c['asof'],12,c['settings'])\ng=engine.order_guidance(dict(c['item'],**f,as_of=c['asof']),c['asof'],c['settings'])\nprint(json.dumps(dict(f=f,g=g)))";
 const p=JSON.parse(execFileSync('/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify({item,months,asof,settings}),encoding:'utf8'}));
 assert.deepEqual(plain(got.forecast_method),p.f.forecast_method);assert.equal(g.quantity,p.g.quantity);
 assert.equal(api.calculate([item],months,asof,12,{},asof)[0].forecast_method,undefined);
});

test('recommended stockout modes and forecast-miss fallback have full Python/JS point and order parity',()=>{
 const cases=[];
 for(let i=0;i<20;i++){
  const values=Array.from({length:36},(_,k)=>i%2===0?40+(k%4)*3:([20,30,250,40,10,100,20,20,10,50,10,20][k%12]));
  values[24+i%9]=0;
  const months=Array.from({length:36},(_,k)=>`${2030+Math.floor(k/12)}-${String(k%12+1).padStart(2,'0')}`);
  for(const adjust of [false,true])cases.push({item:{sku:'S'+i,name:'Synthetic',unit:'u',on_hand:10,supplier_days:14,monthly_sales:values},months,asof:'2032-12-31',settings:{forecast_method:'recommended',stockout_adjust:adjust,safety_stock_basis:i%3?'sales_variation':'forecast_misses'}});
 }
 const py="import json,sys,engine\nrows=[]\nfor c in json.load(sys.stdin):\n f=engine.forecast(c['item'],c['months'],c['asof'],12,c['settings'])\n g=engine.order_guidance(dict(c['item'],**f,as_of=c['asof']),c['asof'],c['settings'])\n rows.append(dict(held=f['held'],curve=[r['demand'] for r in f.get('projection',[])],method=f.get('forecast_method'),quantity=g.get('quantity'),safety=g.get('safety_stock_provenance')))\nprint(json.dumps(rows))";
 const expected=JSON.parse(execFileSync('/usr/bin/python3',['-c',py],{cwd:root,input:JSON.stringify(cases),encoding:'utf8',maxBuffer:16*1024*1024}));
 cases.forEach((c,i)=>{
  const f=api.calculate([c.item],c.months,c.asof,12,c.settings,c.asof)[0],g=api.orderGuidance(f,c.asof,c.settings);
  const got=plain({held:f.held,curve:(f.projection||[]).map(r=>r.demand),method:f.forecast_method,quantity:g.quantity,safety:g.safety_stock_provenance});
  assert.deepEqual(got,expected[i],'adapter mode case '+i);
  assert.equal(f.held,false);
  assert.match(f.forecast_method.reason,c.settings.stockout_adjust?/Stockout adjustment on/:/Stockout adjustment off/);
 });
});
