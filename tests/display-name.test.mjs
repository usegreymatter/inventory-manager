import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import beforeRename from './reviewed-rename-delta.cjs'
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const oldName=/stock runway/i,brand='Inventory Manager'
test('CLI help, command answers and authored display strings use the new name',()=>{
 const r=spawnSync(process.env.PYTHON||'/usr/bin/python3',['stock_runway.py','--help'],{encoding:'utf8',cwd:new URL('..',import.meta.url)})
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Inventory Manager/);assert.doesNotMatch(r.stdout,oldName)
 for(const file of ['desktop/plugin.js','commands.py','stock_runway.py','standalone/template.html','standalone/design/template.html','standalone/design/template-gm.html','standalone/design/strings-a3.js','standalone/design/chart-focus-gm-b.js']){
  assert.doesNotMatch(read(file),oldName,file);assert.ok(read(file).includes(brand),file)
 }
 assert.match(read('README.md'),/\*\*Beta:\*\*/)
})
test('exact SHA-pinned rename reconstructs pre-rename plugin bytes and rejects unknown changes',()=>{
 const source=read('desktop/plugin.js'),before=beforeRename(source,'plugin')
 assert.equal(createHash('sha256').update(before).digest('hex'),'43e46a82fcd8a4cd2b6174f08650227a51d8cf0f386be075fd9913c4d5aeb5c9')
 assert.throws(()=>beforeRename(source.replace("name: 'Inventory Manager'","name: 'UNKNOWN BRAND'"),'plugin'))
 assert.notEqual(createHash('sha256').update(beforeRename(source+'UNKNOWN','plugin')).digest('hex'),'43e46a82fcd8a4cd2b6174f08650227a51d8cf0f386be075fd9913c4d5aeb5c9')
 assert.match(source,/id: 'stock-runway', name: 'Inventory Manager'/)
 assert.match(source,/path: '\/stock-runway'/)
 assert.match(source,/name: 'stock-runway', render/)
 assert.match(beforeRename(read('tools.py'),'tools'),/Stock runway could not read/)
})
