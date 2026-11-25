import { readBaseline, baselineResult } from './baseline.mjs'
import {reviewedSafetyProjection,assertSafetyWarningAdditions} from './policy-v2-support.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
const src=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
function api(source){const c=vm.createContext({TextEncoder,TextDecoder,atob,btoa});vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={calculate,orderGuidance}',c);return c.api}
const current=api(src),baseline=api(readBaseline('897acde:desktop/plugin.js')),plain=x=>JSON.parse(JSON.stringify(x))
test('round 4 default OFF preserves all sample and demo physical outputs and first 20 order quantities',()=>{
 for(const name of ['sample','demo-1000']){
  const d=JSON.parse(fs.readFileSync(new URL('../data/'+name+'.json',import.meta.url),'utf8'))
  const now='2026-11-17',before=baseline.calculate(d.items,d.months,d.as_of,6,{},now),after=current.calculate(d.items,d.months,d.as_of,6,{},now)
  after.forEach(row=>assertSafetyWarningAdditions(row,current.orderGuidance(row,now,{},d.as_of).quantity??0))
  const project=row=>reviewedSafetyProjection(row,current.orderGuidance(row,now,{},d.as_of).quantity??0)
  assert.deepEqual(plain(after.map(project)),plain(before.map(project)),name+' full forecast equality apart from exact reviewed safety warnings')
  after.slice(0,20).forEach((i,n)=>assert.deepEqual(plain(current.orderGuidance(i,now,{stockout_adjust:false},d.as_of)),plain(baseline.orderGuidance(before[n],now,{},d.as_of)),name+' '+i.sku))
 }
})
test('round 4 Python/JS detection and adjusted guidance parity: 360 random + edge + 1005 dataset cases',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['scripts/stockout_parity.cjs'],{encoding:'utf8',maxBuffer:64*1024*1024,timeout:180000}))
 assert.equal(out.result,'pass');assert.ok(out.guidance_cases>=300);assert.ok(out.cases>=1300)
})
