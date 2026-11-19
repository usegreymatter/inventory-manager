import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
import {ctx,plain,near} from './phase3b.test.mjs'
vm.runInContext('this.fix={learningSettingsFromLog,learningDecision,approvalMatches,normalizeLearningSettings}',ctx)
test('report-card words are plain and percentages only describe bias changes',()=>{
 vm.runInContext('this.fix.learningChangeText=learningChangeText',ctx)
 for(const [state,label] of Object.entries({applied:'Applied',proposal:'Needs OK',rejected:'Not better',withdrawn:'Undone',disabled:'Turned off',approved_not_tested:'Approved, not tested'})){
  const text=ctx.fix.learningChangeText({kind:state==='disabled'?'correction_disabled':'bias_correction',state,reason:'Check',factor:1.1})
  assert.ok(text.includes(label),text)
  if(['withdrawn','disabled','approved_not_tested'].includes(state))assert.ok(!text.includes('%'),text)
 }
 assert.ok(!ctx.fix.learningChangeText({kind:'method_switch',state:'applied',factor:1}).includes('%'))
 assert.ok(ctx.fix.learningChangeText({kind:'bias_correction',state:'applied',factor:1.1}).includes('10.0%'))
})
test('hysteresis retains the prior absolute factor and still rejects clear harm, with parity',()=>{
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,learning,json
from tests.phase3b_fixtures import raw
sales=[100,110]*24;rows=[dict(month=f'2026-{m:02d}',prediction=100,actual=105,error=5,scale=10) for m in range(5,11)]
folds=[dict(origin=o,actual=[105]*3,prediction=[100]*3,errors=[5]*3) for o in range(12,20)]
item=raw(sales);item['_learning_context']=dict(entries=rows,enabled=True,prior_correction=dict(state='applied',factor=1.1));runs=[]
for perfect in (False,True):
 fs=[dict(r,prediction=r['actual'],errors=[0]*3) for r in folds] if perfect else folds
 selected=dict(forecast=[100]*12,folds=fs,method='champion',adopted=False,candidates={})
 runs.append(dict(item=item,selected=selected,sales=sales,folds=fs,result=learning.bias_correction(item,selected,sales,fs,fs)))
print(json.dumps(runs))`],{encoding:'utf8'})
 assert.equal(p.status,0,p.stderr);const runs=JSON.parse(p.stdout)
 for(const r of runs)near(plain(ctx.api.biasCorrection(r.item,r.selected,r.sales,r.folds,r.folds)),r.result)
 assert.equal(runs[0].result.learning.state,'applied');assert.equal(runs[1].result.learning.state,'rejected')
})
test('latest correction toggle persists, with Python parity',()=>{
 const data={as_of:'2026-10-31'},settings={learning_enabled:true},log=[{sku:'X',when:data.as_of,kind:'correction_disabled',state:'disabled'}]
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import json,engine;print(json.dumps(engine.learning_settings_from_log(${JSON.stringify(data)}, {'learning_enabled':True}, ${JSON.stringify(log)})))`],{encoding:'utf8'})
 assert.equal(p.status,0,p.stderr);near(plain(ctx.fix.learningSettingsFromLog(data,settings,log)),JSON.parse(p.stdout))
 assert.deepEqual(plain(ctx.fix.learningSettingsFromLog(data,settings,log)).learning_disabled_skus,['X'])
 log.push({...log[0],kind:'correction_enabled',state:'enabled'})
 assert.deepEqual(plain(ctx.fix.learningSettingsFromLog(data,settings,log)).learning_disabled_skus,[])
})
test('durable owner decisions across monthly snapshots have Python parity',()=>{
 const p=spawnSync(process.env.PYTHON||'/usr/bin/python3',['-c',`import engine,json
from tests.phase3b_fixtures import dataset,raw,diary_rows
d=dataset(raw([100]*48));diary=diary_rows(d,70);settings={'learning_enabled':True}
proposal=engine.learning_report(d,diary,settings)['pending'][0];runs=[]
for action in ('approve','dismiss'):
 log=engine.learning_decision(d,diary,settings,[],proposal['id'],action)['events']
 for prediction in (70,50):
  newer=dataset(raw([101]*49),'2026-11');rows=diary_rows(newer,prediction)
  restored=engine.learning_settings_from_log(newer,settings,log)
  runs.append(dict(data=newer,diary=rows,settings=restored,log=log,report=engine.learning_report(newer,rows,restored,log),selection=engine.forecast_selection(engine.prepare_learning(newer,rows,restored)['items'][0],'2026-11')))
print(json.dumps(runs))`],{encoding:'utf8',maxBuffer:5*1024*1024})
 assert.equal(p.status,0,p.stderr)
 for(const r of JSON.parse(p.stdout)){
  near(plain(ctx.api.learningReport(r.data,r.diary,r.settings,r.log)),r.report)
  near(plain(ctx.api.forecastSelection(ctx.api.prepareLearning(r.data,r.diary,r.settings).items[0],'2026-11')),r.selection)
 }
})
