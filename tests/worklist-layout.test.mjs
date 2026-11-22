// Lifecycle: living. QA-P2-002 observer scheduling; browser geometry lives in
// standalone/capture-layout-regression.cjs (QA-P1-001 / real Chromium + WebKit).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source=fs.readFileSync(process.env.QA_WORKLIST_SOURCE||new URL('../standalone/design/worklist-gm-b.js',import.meta.url),'utf8')
function observerHarness(){
 const frames=[],calls={layout:0,controls:0,rows:0,close:0},wl={phone:true,columnPopup:null},scroll={clientWidth:358,clientHeight:300,addEventListener(){}}
 let deliver
 const context=vm.createContext({wl,wlScroll:scroll,ResizeObserver:class{constructor(callback){deliver=callback}observe(target){assert.equal(target,scroll)}},requestAnimationFrame:fn=>{frames.push(fn);return frames.length},wlLayout(){calls.layout++},wlRenderControls(){calls.controls++},wlRenderRows(){calls.rows++},wlCloseHeaderColumns(){calls.close++}})
 const start=source.indexOf("wlScroll.addEventListener('scroll'"),end=source.indexOf("document.addEventListener('click'",start)
 assert.ok(start>=0&&end>start,'extract the real scroll/resize adapter')
 vm.runInContext(source.slice(start,end),context)
 return {calls,scroll,wl,frames,deliver:()=>deliver([{target:scroll}]),flush:()=>{const pending=frames.splice(0);pending.forEach(fn=>fn())}}
}
test('resize delivery never writes layout synchronously; repeated deliveries share a frame',()=>{
 const a=observerHarness();a.deliver();a.deliver();a.deliver()
 assert.deepEqual(a.calls,{layout:0,controls:0,rows:0,close:0})
 assert.equal(a.frames.length,1);a.flush()
 assert.deepEqual(a.calls,{layout:1,controls:1,rows:1,close:0})
})
test('cost/clearance height-only changes refresh rows without rebuilding phone controls',()=>{
 const a=observerHarness();a.deliver();a.flush()
 a.scroll.clientHeight=208;a.deliver();a.flush()
 assert.deepEqual(a.calls,{layout:1,controls:1,rows:2,close:0})
})
test('same-size feedback is a no-op, while width changes refresh layout and close stale column popups',()=>{
 const a=observerHarness();a.deliver();a.flush();a.deliver();a.flush()
 assert.deepEqual(a.calls,{layout:1,controls:1,rows:1,close:0})
 a.wl.columnPopup={};a.scroll.clientWidth=1408;a.deliver();a.flush()
 assert.deepEqual(a.calls,{layout:2,controls:2,rows:2,close:1})
})
