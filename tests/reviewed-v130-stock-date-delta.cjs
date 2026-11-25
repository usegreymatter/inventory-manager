// Exact v1.3.0 stock count date delta: reconstruct b721363, never ignore unknown bytes.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v130-stock-date-approved-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'c7a1eaa04831f0fe6d8de05fed9389828d179ce8369fc0f2683691b916846855');
const delta=JSON.parse(bytes);
module.exports=function beforeStockDate(source,kind){
 if(!Object.hasOwn(delta.baseline_sha256,kind))return source;
 for(const {before,after}of delta[kind]){
  assert.equal(source.split(after).length,2,'exact reviewed '+kind+' stock count date delta required; unknown mutation');
  source=source.replace(after,()=>before);
 }
 return source;
};
module.exports.delta=delta;
