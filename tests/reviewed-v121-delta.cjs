// Exact v1.2.1 diagnostics and set-aside display-count changes only.
// Restore 8465334 bytes before older immutable historical guards; no pin refresh.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v121-approved-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'280d6d8c74c0d13ad85c441ceeb76dc2f869b2081be25704fcb627dd2545f340');
const delta=JSON.parse(bytes);
function beforeV121Delta(source,kind){
 assert.ok(Object.hasOwn(delta.baseline_sha256,kind),'known v1.2.1 surface required');
 for(const {before,after}of delta[kind]){
  assert.equal(source.split(after).length,2,'exact reviewed '+kind+' v1.2.1 delta required; changed from import snapshot');
  source=source.replace(after,()=>before);
 }
 return source;
};
module.exports=(source,kind)=>beforeV121Delta(require('./reviewed-v122-delta.cjs')(source,kind),kind);
module.exports.previous=beforeV121Delta;
