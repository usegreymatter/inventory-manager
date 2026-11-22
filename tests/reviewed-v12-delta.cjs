// Exact owner-authorized H1/M1 seams; restore 44eba83 for immutable maths guards.
// This is not a hash refresh or an exclusion: unknown bytes remain detectable.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v12-feature-approved-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'001604801eab89af6b013a6298adaa8e171f48823220943f1be48eefe386893b');
const delta=JSON.parse(bytes);
module.exports=function beforeReviewedFeatures(source,kind){
  source=require('./reviewed-display-delta.cjs')(source,kind);
  for(const {before,after} of delta[kind]){
    assert.equal(source.split(after).length,2,'exact reviewed '+kind+' H1/M1 delta required; changed from import snapshot');
    source=source.replace(after,()=>before);
  }
  return source;
};
