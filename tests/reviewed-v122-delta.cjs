// Exact v1.2.2 safety delta: reconstruct 047f95a, retain unknown-byte detection.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v122-approved-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'732245526649bf45efd08e04ed5afce1cdf8e626fb79d70db3e8c9efc6662c0f');
const delta=JSON.parse(bytes);
function beforeV122Delta(source,kind){
 assert.ok(Object.hasOwn(delta.baseline_sha256,kind),'known v1.2.2 surface required');
 for(const {before,after}of delta[kind]){
  assert.equal(source.split(after).length,2,'exact reviewed '+kind+' v1.2.2 delta required; unknown mutation');
  source=source.replace(after,()=>before);
 }
 return source;
};
module.exports=(source,kind)=>beforeV122Delta(require('./reviewed-v130-delta.cjs')(source,kind),kind);
module.exports.previous=beforeV122Delta;
