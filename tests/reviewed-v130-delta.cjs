// Exact v1.3.0 presentation delta. Restore bef15f7, never ignore unknown bytes.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v130-approved-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'2a0c975bd86355187e74b139edfc5c7bc68194a646744d6ce170073ad69ae3d8');
const delta=JSON.parse(bytes);
const beforeStockDate=require('./reviewed-v130-stock-date-delta.cjs');
module.exports=function beforeV130(source,kind){
 assert.ok(Object.hasOwn(delta.baseline_sha256,kind),'known v1.3.0 surface required');
 source=beforeStockDate(source,kind);
 for(const {before,after}of delta[kind]){
  assert.equal(source.split(after).length,2,'exact reviewed '+kind+' v1.3.0 delta required; unknown mutation');
  source=source.replace(after,()=>before);
 }
 return source;
};
