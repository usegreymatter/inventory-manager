import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import test from 'node:test'
const sha=value=>createHash('sha256').update(value).digest('hex')
// Round 3 changes only workbook join, input review, and CSV import eligibility.
// Exclude those exact import spans; this digest was verified identical at c54b645
// and current source. Every purchase/forecast/attribution/order byte stays pinned.
test('round-two protected maths: all plugin pure bytes outside input meaning unchanged',()=>{
 const source=fs.readFileSync('desktop/plugin.js','utf8'),pure=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle ='))
 assert.equal(pure.split('// INPUT_MEANING_START').length,2);assert.equal(pure.split('// INPUT_MEANING_END').length,2)
 let protectedCore=pure
 for(const [start,end]of [['// SMART_WORKBOOK_START','// SMART_WORKBOOK_END'],['// INPUT_MEANING_START','// INPUT_MEANING_END'],['export function parseCsv(text,','// SDK tones:']]){
  const i=protectedCore.indexOf(start),j=protectedCore.indexOf(end,i);assert.ok(i>=0&&j>i);protectedCore=protectedCore.slice(0,i)+'IMPORT_REVIEW_ONLY'+protectedCore.slice(j)
 }
 assert.equal(sha(protectedCore),'ab516ecff178109f1dfa20a71fed792027d2d33fddaff12d4adf37d021d4ffa0')
 assert.notEqual(sha(protectedCore+'mutation'),'ab516ecff178109f1dfa20a71fed792027d2d33fddaff12d4adf37d021d4ffa0')
})
test('round-two protected maths: every engine.py byte remains d272f95',()=>{
 assert.equal(sha(fs.readFileSync('engine.py')),'5dd43283a2628db577fd3a055e7619f1398e8095bf7403882a6c4f4414831945')
})
