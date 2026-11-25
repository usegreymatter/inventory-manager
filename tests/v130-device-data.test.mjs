import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import pythonStdin from './python-stdin.cjs'
const source=fs.readFileSync(new URL('../standalone/design/first-run-gm-b.js',import.meta.url),'utf8')
const key='inventory-manager.device-data.v1'
function setup(saved=null,{denySave=false,denyForget=false,bootSource='sample'}={}){
 const nodes=new Map(),storage=new Map(saved===null?[]:[[key,saved]]),writes=[]
 function node(tag,text){return {tag,textContent:text||'',hidden:false,checked:false,children:[],listeners:{},append(...children){this.children.push(...children)},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn},click(){this.listeners.click?.()},set id(v){nodes.set(v,this)},get id(){return [...nodes].find(([,n])=>n===this)?.[0]}}}
 const c=vm.createContext({node,$:id=>({title:'',childNodes:[]}),firstRun:node('section'),wlBtn:(text,fn)=>{const n=node('button',text);n.addEventListener('click',fn);return n},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(denySave)throw Error('quota');writes.push(k);storage.set(k,v)},removeItem:k=>{if(denyForget)throw Error('denied');storage.delete(k)}},firstRunSync(){},stockImportStatus(){},firstRunSource:node('span'),validateDataset:d=>{if(!d.items.length||!d.months)throw Error('invalid')},render(){},smartImportUI:{status(){}},firstRunMethodSync(){},gmSnapshotLabel(){},data:{items:[{sku:'SYNTHETIC',monthly_sales:[1,1,1]}],months:['2020-08','2020-09','2020-10'],as_of:'2020-10-31'},sourceName:bootSource})
 vm.runInContext(source.slice(source.indexOf('// Imported rows persist')),c)
 return {c,nodes,storage,writes,import(){vm.runInContext("sourceName='synthetic.csv';stockImportStatus({parsed:data},{name:sourceName})",c)},tick(checked=true){nodes.get('remember-device').checked=checked;nodes.get('remember-device').listeners.change()}}
}
test('device storage requires a fresh opt-in after successful import, forget clears and prevents re-save',()=>{
 const h=setup();assert.equal(h.writes.length,0);h.import();assert.equal(h.nodes.get('remember-device').checked,false);assert.equal(h.writes.length,0)
 h.tick();assert.equal(h.writes.length,1);const saved=h.storage.get(key);assert.match(saved,/SYNTHETIC/)
 const demo=setup(saved,{bootSource:'demo'});assert.equal(demo.c.sourceName,'demo');assert.doesNotMatch(demo.c.firstRunSource.textContent,/Restored/);assert.equal(demo.storage.get(key),saved);assert.equal(demo.writes.length,0)
 const reload=setup(saved);assert.match(reload.c.firstRunSource.textContent,/Restored from this device · imported/);assert.equal(reload.writes.length,0);assert.equal(reload.nodes.get('remember-device').checked,true);assert.equal(reload.nodes.get('forget-device-data').hidden,false)
 reload.nodes.get('forget-device-data').click();assert.equal(reload.storage.has(key),false);assert.equal(reload.nodes.get('remember-device').checked,false);assert.equal(reload.writes.length,0)
 reload.import();assert.equal(reload.writes.length,0);assert.equal(reload.storage.has(key),false)
})
test('new unconsented imports cannot overwrite previously saved data; unchecking forgets',()=>{
 const h=setup();h.import();h.tick();const saved=h.storage.get(key);h.import();assert.equal(h.nodes.get('remember-device').checked,false);assert.equal(h.storage.get(key),saved);assert.equal(h.writes.length,1)
 h.tick();h.tick(false);assert.equal(h.storage.has(key),false)
})
test('oversized data, unavailable storage and corrupted restores are explicit, not silent',()=>{
 const big=setup();big.import();vm.runInContext("data.note='x'.repeat(2*1024*1024)",big.c);big.tick();assert.equal(big.writes.length,0);assert.match(big.nodes.get('device-data-notice').textContent,/too big/);assert.equal(big.nodes.get('remember-device').checked,false)
 const denied=setup(null,{denySave:true});denied.import();denied.tick();assert.equal(denied.writes.length,0);assert.match(denied.nodes.get('device-data-notice').textContent,/Could not save/)
 const invalid=setup('{bad');assert.match(invalid.nodes.get('device-data-notice').textContent,/Could not restore/);assert.equal(invalid.writes.length,0);assert.equal(invalid.nodes.get('forget-device-data').hidden,false)
 const forget=setup('{bad',{denyForget:true});forget.nodes.get('forget-device-data').click();assert.equal(forget.storage.has(key),true);assert.match(forget.nodes.get('device-data-notice').textContent,/Could not forget/)
})
test('test-only Python stdin has deterministic EOF for large inputs, cleans up, and times out',()=>{
 const root=fs.mkdtempSync('.scratch/python-stdin-check-'),payload=JSON.stringify({synthetic:'a'.repeat(256*1024)})
 try{
  for(let i=0;i<4;i++){const r=pythonStdin(['-c','import json,sys; print(len(json.load(sys.stdin)["synthetic"]))'],payload,{cwd:root});assert.equal(r.status,0,r.error?.message||r.stderr);assert.equal(Number(r.stdout.trim()),256*1024)}
  const timeout=pythonStdin(['-c','import time; time.sleep(10)'],'{}',{cwd:root,timeout:30});assert.equal(timeout.error?.code,'ETIMEDOUT')
  assert.deepEqual(fs.readdirSync(root+'/.scratch'),[])
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
