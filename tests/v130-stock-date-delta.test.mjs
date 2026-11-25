// Stock count date delta guard: reviewed spans restore b721363 and reject unknown bytes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import beforeStockDate from './reviewed-v130-stock-date-delta.cjs'
const read=p=>fs.readFileSync(p,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex'),{delta}=beforeStockDate
for(const [kind,file]of Object.entries(delta.files))test(`v1.3.0 stock date ${kind}: exact reviewed spans restore baseline and detect unknown bytes`,()=>{
 const source=read(file)
 assert.equal(sha(beforeStockDate(source,kind)),delta.baseline_sha256[kind])
 for(const {after}of delta[kind])assert.throws(()=>beforeStockDate(source.replace(after,'UNKNOWN'+after.slice(1)),kind))
 assert.notEqual(sha(beforeStockDate(source+'\nUNKNOWN',kind)),delta.baseline_sha256[kind])
})
