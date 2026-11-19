import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
const src=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8'),ctx=vm.createContext({Date,Intl,TextEncoder,TextDecoder})
vm.runInContext(src.slice(src.indexOf('const SAMPLE ='),src.indexOf('const pageStyle =')).replaceAll('export ','')+'\nthis.api={forecastDiary,scoreDiary,forecastSelection,calculate,prepareLearning,biasCorrection,learningReport,learningEvents}',ctx)
const plain=x=>JSON.parse(JSON.stringify(x))
const near=(a,b)=>{if(typeof b==='number')assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);else if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((x,i)=>near(a[i],x))}else if(b&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k in b)near(a[k],b[k])}else assert.equal(a,b)}
test('forecast diary and matured scores port parity',()=>{
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json
from tests.phase3b_fixtures import dataset,raw,diary_rows
d=dataset(); ds=dataset(raw([100]*48)); diary=diary_rows(ds)
print(json.dumps(dict(data=d,score_data=ds,diary=diary,forecasts=engine.forecast_diary(d),scores=engine.score_diary(diary,ds),report=engine.learning_report(ds,diary))))`],{encoding:'utf8'})
 assert.equal(p.status,0,p.stderr);const x=JSON.parse(p.stdout)
 near(plain(ctx.api.forecastDiary(x.data)),x.forecasts)
 near(plain(ctx.api.scoreDiary(x.diary,x.score_data)),x.scores)
 near(plain(ctx.api.learningReport(x.score_data,x.diary)),x.report)
})
test('gated correction integration and undo parity across twelve monthly runs',()=>{
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json
from tests.phase3b_fixtures import dataset,raw
diary=[]; runs=[]
for t in range(12):
 d=dataset(raw([10000]+[100*1.01**i for i in range(1,36+t)]),engine.month_after('2026-01',t))
 ready=engine.prepare_learning(d,diary,dict(learning_enabled=True))
 runs.append(dict(data=d,diary=list(diary),ready=ready,selection=engine.forecast_selection(ready['items'][0],d['as_of'][:7])))
 diary.extend(engine.forecast_diary(ready))
print(json.dumps(runs))`],{encoding:'utf8',maxBuffer:5*1024*1024})
 assert.equal(p.status,0,p.stderr);const runs=JSON.parse(p.stdout)
 for(const run of runs){const ready=ctx.api.prepareLearning(run.data,run.diary,{learning_enabled:true});near(plain(ready),run.ready);near(plain(ctx.api.forecastSelection(ready.items[0],run.data.as_of.slice(0,7))),run.selection)}
 assert.ok(runs.some(r=>r.selection.learning?.state==='applied'))
 assert.ok(runs.every(r=>!r.selection.learning||Math.abs(r.selection.learning.factor-1)<=.15+1e-12))
})
test('pattern break health and re-selection parity, drift alone changes no quantities',()=>{
 vm.runInContext(fs.readFileSync(new URL('../standalone/design/health.js',import.meta.url),'utf8')+'\nthis.dataHealth=dataHealth',ctx)
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json
from tests.phase3b_fixtures import dataset,raw,diary_rows
from health import data_health
d=dataset(raw([100,110]*24)); diary=diary_rows(d,100); d['items'][0]['monthly_sales'][-6:]=[100,100,100,180,180,180]
r=engine.prepare_learning(d,diary,{})
print(json.dumps(dict(data=d,diary=diary,health=data_health(r),selection=engine.forecast_selection(r['items'][0],'2026-10'))))`],{encoding:'utf8'})
 assert.equal(p.status,0,p.stderr);const x=JSON.parse(p.stdout),ready=ctx.api.prepareLearning(x.data,x.diary,{})
 near(plain(ctx.dataHealth(ready)),x.health);near(plain(ctx.api.forecastSelection(ready.items[0],'2026-10')),x.selection)
 const a=ctx.api.calculate(x.data.items,x.data.months,x.data.as_of,3),b=ctx.api.calculate(ready.items,x.data.months,x.data.as_of,3)
 near(plain(b).map(r=>r.projection),plain(a).map(r=>r.projection))
 assert.ok(x.health.warnings.some(w=>w.code==='pattern_changed'))
})
test('learning UI is tap-only and opt-in on Desktop and A3',()=>{
 assert.ok(src.includes("'data-learning-panel': true"))
 assert.ok(src.includes("ctx.storage.set('forecast_diary'"))
 const controls=fs.readFileSync(new URL('../standalone/design/controls-a3.html',import.meta.url),'utf8')
 assert.match(controls,/<details id="accuracy-panel">/)
 assert.doesNotMatch(controls,/<details id="accuracy-panel" open/)
})
test('learning events have identical IDs, capped records and append-only undo parity',()=>{
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json
from tests.phase3b_fixtures import dataset,raw
diary=[]; log=[]; runs=[]
for t in range(12):
 d=dataset(raw([10000]+[100*1.01**i for i in range(1,36+t)]),engine.month_after('2026-01',t))
 d['items'].append(raw([100,110]*18+[105]*min(t,6)+[300]*max(0,t-6),'BREAK'))
 settings=dict(learning_enabled=True)
 events=engine.learning_events(d,diary,settings,log)
 runs.append(dict(data=d,diary=list(diary),log=list(log),settings=settings,events=events))
 log.extend(e for e in events if e['id'] not in {x['id'] for x in log})
 diary.extend(engine.forecast_diary(engine.prepare_learning(d,diary,settings)))
print(json.dumps(runs))`],{encoding:'utf8',maxBuffer:10*1024*1024})
 assert.equal(p.status,0,p.stderr);const runs=JSON.parse(p.stdout)
 for(const r of runs)near(plain(ctx.api.learningEvents(r.data,r.diary,r.settings,r.log)),r.events)
 assert.ok(runs.flatMap(r=>r.events).some(e=>e.state==='applied'))
 assert.ok(runs.flatMap(r=>r.events).some(e=>e.kind==='pattern_changed'))
})
test('owner controls are tap-only and decisions have Python parity',()=>{
 const learningUI=fs.readFileSync(new URL('../standalone/design/learning-a3.js',import.meta.url),'utf8')
 assert.match(learningUI,/dataset\.approveProposal/);assert.match(learningUI,/dataset\.dismissProposal/)
 vm.runInContext('this.api.learningDecision=learningDecision;this.api.learningSettingsFromLog=learningSettingsFromLog;this.api.normalizeLearningSettings=normalizeLearningSettings',ctx)
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json
from tests.phase3b_fixtures import dataset,raw,diary_rows
d=dataset(raw([100+i*10 for i in range(60)]));diary=diary_rows(d,600);settings=dict(learning_enabled=True)
log=engine.learning_events(d,diary,settings);report=engine.learning_report(d,diary,settings,log);id=report['pending'][0]['id']
a=engine.learning_decision(d,diary,settings,log,id,'approve');b=engine.learning_decision(d,diary,settings,log,id,'dismiss')
print(json.dumps(dict(data=d,diary=diary,settings=settings,log=log,report=report,approved=a,dismissed=b)))`],{encoding:'utf8'})
 assert.equal(p.status,0,p.stderr);const x=JSON.parse(p.stdout),report=ctx.api.learningReport(x.data,x.diary,x.settings,x.log)
 near(plain(report),x.report)
 for(const [action,expected] of [['approve',x.approved],['dismiss',x.dismissed]])near(plain(ctx.api.learningDecision(x.data,x.diary,x.settings,x.log,report.pending[0].id,action)),expected)
 const normalized=ctx.api.normalizeLearningSettings(x.approved.settings)
 const selection=ctx.api.forecastSelection(ctx.api.prepareLearning(x.data,x.diary,normalized).items[0],x.data.as_of.slice(0,7))
 assert.equal(selection.method,x.approved.events[0].method_after)
 assert.equal(selection.method_change.reason,'Owner approved')
 assert.throws(()=>ctx.api.learningDecision(x.data,x.diary,x.settings,x.log,'missing','approve'))
})
export {ctx,plain,near}
