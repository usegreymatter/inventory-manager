// Exact owner-authorized display/attribution-only follow-up; restore ce20b2d.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/v12-display-approved-delta.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'f5cce9e9de3ad2108054c4b464870ea0d423816ec8646a9714384429e6d65181');
const delta=JSON.parse(bytes);
module.exports=function beforeReviewedDisplay(source,kind){
  for(const {before,after} of delta[kind]){
    assert.equal(source.split(after).length,2,'exact reviewed '+kind+' display delta required; unknown mutation');
    source=source.replace(after,()=>before);
  }
  return source;
};
