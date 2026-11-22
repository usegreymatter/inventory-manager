import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import beforeV121 from './reviewed-v121-delta.cjs'
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const sha=s=>createHash('sha256').update(s).digest('hex')
const delta=JSON.parse(read('tests/fixtures/v121-approved-delta.json'))
for(const [kind,file]of [['plugin','desktop/plugin.js'],['csv','csv_import.py'],['smartImport','standalone/design/smart-import.js']]){
 test(`v1.2.1 ${kind}: exact reviewed deltas reconstruct 8465334 and reject unknown mutations`,()=>{
  const source=read(file),before=beforeV121(source,kind)
  assert.equal(sha(before),delta.baseline_sha256[kind])
  for(const {after}of delta[kind])assert.throws(()=>beforeV121(source.replace(after,'UNKNOWN'+after.slice(1)),kind))
  assert.notEqual(sha(beforeV121(source+'\nUNKNOWN',kind)),delta.baseline_sha256[kind])
 })
}
