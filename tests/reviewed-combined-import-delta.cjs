// Restore only exact imported parser deltas for full-file historical display checks.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v12-combined-import-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'a79bdba89bf4129159d884ee2df93cc1669eb5d55c254eab3b633a201144e87a');
const delta=JSON.parse(bytes);
module.exports=function beforeCombinedImports(source){
 for(const {before,after}of delta.plugin){
  assert.equal(source.split(after).length,2,'exact combined import delta required; unknown mutation');
  source=source.replace(after,()=>before);
 }
 return source;
};
