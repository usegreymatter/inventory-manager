// Exact display-name migration only. Stable identities and historical pins survive.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v12-rename-approved-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'db0212e8db5191c13f541ea4f970df8d6bba6dc20d147f2644164518aa25a8ea');
const delta=JSON.parse(bytes);
module.exports=function beforeRename(source,kind){
 assert.ok(Object.hasOwn(delta,kind),'known rename surface required');
 for(const {before,after}of delta[kind]){
  assert.equal(source.split(after).length,2,'exact reviewed '+kind+' display-name delta required');
  source=source.replace(after,()=>before);
 }
 return source;
};
