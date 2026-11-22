import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import test from 'node:test'
import beforeReviewedFeatures from './reviewed-v12-delta.cjs'
const sha=value=>createHash('sha256').update(value).digest('hex')
// Exact reviewed settings-only delta, not an open-ended exclusion. Reconstruct
// the previous checkpoint so every protected mathematical digest stays frozen.
const deltaBytes=fs.readFileSync('tests/fixtures/preset-approved-delta.json')
assert.equal(sha(deltaBytes),'a1286b842b5d2ea318c257af0c5c4d5276d2b7c33c3b84315ebcc584113b0dfa')
const reviewedDelta=JSON.parse(deltaBytes)
// Exact owner-authorized import helper delta; original maths digest stays locked.
const importDeltaBytes=fs.readFileSync('tests/fixtures/import-safety-approved-delta.json')
assert.equal(sha(importDeltaBytes),'086573da22589146173f4010752ebd77cfe3dce7534511367dfa29cc5b80338f')
const importDelta=JSON.parse(importDeltaBytes)
function beforeReviewedImport(source){
 for(const {before,after}of importDelta.plugin){
  assert.equal(source.split(after).length,2,'exact reviewed import helper delta required')
  source=source.replace(after,before)
 }
 return source
}
function beforeReviewedPresets(source,kind){
 for(const {before,after}of reviewedDelta[kind]){
  assert.equal(source.split(after).length,2,'exact reviewed '+kind+' settings delta required')
  source=source.replace(after,before)
 }
 return source
}
// Round 3 changes only workbook join, input review, and CSV import eligibility.
// Exclude those exact import spans; this digest was verified identical at c54b645
// and current source. Every purchase/forecast/attribution/order byte stays pinned.
test('round-two protected maths: all plugin pure bytes outside input meaning match approved v1.2 integration',()=>{
 const source=beforeReviewedFeatures(fs.readFileSync('desktop/plugin.js','utf8'),'plugin'),pure=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle ='))
 assert.equal(pure.split('// INPUT_MEANING_START').length,2);assert.equal(pure.split('// INPUT_MEANING_END').length,2)
 let protectedCore=pure
 for(const [start,end]of [['// SMART_WORKBOOK_START','// SMART_WORKBOOK_END'],['// INPUT_MEANING_START','// INPUT_MEANING_END'],['export function parseCsv(text,','// SDK tones:']]){
  const i=protectedCore.indexOf(start),j=protectedCore.indexOf(end,i);assert.ok(i>=0&&j>i);protectedCore=protectedCore.slice(0,i)+'IMPORT_REVIEW_ONLY'+protectedCore.slice(j)
 }
 protectedCore=beforeReviewedPresets(beforeReviewedImport(protectedCore),'plugin')
 assert.equal(sha(protectedCore),'0d80862e43d6e32be9f36d8a021e749f12a4f7d2babe012bca3c93dccacc1ea2')
 assert.notEqual(sha(protectedCore+'mutation'),'0d80862e43d6e32be9f36d8a021e749f12a4f7d2babe012bca3c93dccacc1ea2')
})
test('reviewed import helper reconstruction fails closed on changed approved text',()=>{
 const snippet=importDelta.plugin[0].after
 assert.equal(beforeReviewedImport(snippet),importDelta.plugin[0].before)
 assert.throws(()=>beforeReviewedImport(snippet.replace('missing lot quantity','UNKNOWN MUTATION')))
 assert.notEqual(sha(beforeReviewedImport(snippet+'mutation')),sha(importDelta.plugin[0].before))
})
test('reviewed preset normalization rejects changed settings and retains unknown-byte mutations',()=>{
 for(const kind of ['plugin','engine']){
  const snippets=reviewedDelta[kind].map(p=>p.after).join('\n')
  assert.doesNotThrow(()=>beforeReviewedPresets(snippets,kind))
  assert.throws(()=>beforeReviewedPresets(snippets.replace(reviewedDelta[kind][0].after,'UNREVIEWED SETTINGS MUTATION'),kind))
 }
 const source=beforeReviewedFeatures(fs.readFileSync('engine.py','utf8'),'engine')
 assert.notEqual(sha(beforeReviewedPresets(source+'mutation','engine')),'a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d')
})
test('round-two protected maths: engine.py outside exact reviewed settings delta matches approved v1.2 integration',()=>{
 assert.equal(sha(beforeReviewedPresets(beforeReviewedFeatures(fs.readFileSync('engine.py','utf8'),'engine'),'engine')),'a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d')
})
