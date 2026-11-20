import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
test('display risk thresholds mirror Python exactly and withhold invalid inputs',()=>{
 const source=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8'),scope=vm.createContext({TextEncoder,TextDecoder})
 vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+';this.label=riskLabel',scope)
 const values=[null,false,true,-1,0,.099999,.1,.4,.400001,1,2,'0.1'],result=spawnSync('/usr/bin/python3',['-c','import engine,json,sys;print(json.dumps([engine.risk_label(v) for v in json.load(sys.stdin)]))'],{input:JSON.stringify(values),encoding:'utf8'})
 assert.equal(result.status,0,result.stderr);assert.deepEqual(values.map(scope.label),JSON.parse(result.stdout));assert.deepEqual(values.map(scope.label),[null,null,null,null,'Low','Low','Medium','Medium','High','High',null,null]);assert.equal(scope.label(NaN),null)
})
