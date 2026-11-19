// Lifecycle: living. Device-local purchase intent, never an ERP write.
// Adapt input only. The shared standaloneRows/evaluateDataset/orderGuidance path
// owns all stock, dated-receipt, late-PO, quantity and status calculations.
const localOrders={dataset:null,key:'',records:[],error:'',blocked:false,raw:null,filter:'all'}
function localOrderKey(dataset){
 const catalog=dataset.items.map(i=>[i.sku,i.unit]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0)
 return 'stock-runway.local-orders.v1:'+gmSettingsKey({identity:dataset.dataset_id||'',catalog})
}
function localOrderValid(r){return r&&typeof r.sku==='string'&&r.sku.length<=512&&Number.isFinite(r.qty)&&r.qty>0&&r.qty<=1e12&&typeof r.unit==='string'&&r.unit.length<=128&&dateOrdinal(r.ordered_on)!==null&&dateOrdinal(r.expected_on)!==null&&r.expected_on>=r.ordered_on&&typeof r.supplier==='string'&&r.supplier.length<=512&&typeof r.note==='string'&&r.note.length<=1000}
function localOrderLoad(){
 if(localOrders.dataset===data)return
 localOrders.dataset=data;localOrders.key=localOrderKey(data);localOrders.records=[];localOrders.error='';localOrders.blocked=false;localOrders.raw=null;localOrders.filter='all'
 try{const raw=localStorage.getItem(localOrders.key);if(raw&&raw.length>8000000)throw Error('Saved orders are too large.');const saved=JSON.parse(raw||'[]');if(!Array.isArray(saved)||saved.length>20000)throw Error('Saved orders need checking.');const seen=new Set();if(saved.some(r=>!localOrderValid(r)||seen.has(r.sku)||!seen.add(r.sku)))throw Error('Saved order record needs checking.');localOrders.raw=raw;localOrders.records=saved.map(r=>({sku:r.sku,qty:r.qty,unit:r.unit,ordered_on:r.ordered_on,expected_on:r.expected_on,supplier:r.supplier,note:r.note}))}catch{localOrders.blocked=true;localOrders.error='Local orders could not be loaded. Nothing cleared; changes blocked until storage is repaired.'}
 evaluationSnapshot=null
}
function localOrderFor(sku){return localOrders.records.find(r=>r.sku===sku)}
function localOrderLate(r){return localToday()>r.expected_on}
function localOrderReconcile(r){const i=data.items.find(i=>i.sku===r.sku);return !!i&&(i.on_order>=r.qty||data.as_of>r.expected_on)}
function localOrderInput(dataset,records=localOrders.records){
 const orders=new Map(records.map(r=>[r.sku,r]));if(!orders.size)return dataset
 return {...dataset,items:dataset.items.map(item=>{
  const r=orders.get(item.sku);if(!r||r.unit!==item.unit)return item
  // The core deliberately holds mixed undated/detailed incoming stock. Preserve
  // that protection: never erase file stock or invent dates for existing POs.
  const facts=item.planning_facts;if(facts&&(!Array.isArray(facts.incoming_pos)&&facts.incoming_pos!=null||!Array.isArray(facts.warehouses)&&facts.warehouses!=null))return item
  const warehouse=facts?.warehouses?.[0]||'Local device',ids=new Set((facts?.incoming_pos||[]).map(p=>p.po_line_id));let id='local-device:'+r.sku;while(ids.has(id))id+=':local'
  return {...item,planning_facts:{...(facts||{version:'1.0'}),warehouses:facts?.warehouses?.length?[...facts.warehouses]:[warehouse],incoming_pos:[...(facts?.incoming_pos||[]),{po_line_id:id,sku:r.sku,warehouse,supplier:r.supplier.trim()||'Supplier not assigned',remaining_qty:r.qty,due_date:r.expected_on,status:'confirmed'}]}}
 })}
}
const localOrderBaseRows=standaloneRows
standaloneRows=function(dataset,today,options){return localOrderBaseRows(localOrderInput(dataset),today,options)}
const localOrderBaseRender=render
render=function(...args){localOrderLoad();return localOrderBaseRender(...args)}
function localOrderSave(next){
 // Fail closed on storage failure: do not claim persistence or replace old state.
 if(localOrders.blocked){wlMessage(localOrders.error);return false}
 try{if(localStorage.getItem(localOrders.key)!==localOrders.raw){localOrders.error='Local orders changed in another tab. Reload before making changes.';wlMessage(localOrders.error);return false}const raw=JSON.stringify(next);localStorage.setItem(localOrders.key,raw);localOrders.raw=raw}catch{localOrders.error='Could not save local orders. No changes made.';wlMessage(localOrders.error);return false}
 localOrders.records=next;localOrders.error='';evaluationSnapshot=null;render();return true
}
function localOrderMark(rows,note=''){
 const eligible=attentionRows(rows).filter(r=>r.guidance.quantity>0&&!localOrderFor(r.item.sku)&&Number.isFinite(r.guidance.lead_days))
 if(!eligible.length){wlMessage('No unmarked purchase quantities in this selection.');return false}
 const ordered_on=localToday(),next=eligible.map(({item:i,guidance:g})=>({sku:i.sku,qty:g.quantity,unit:i.unit,ordered_on,expected_on:ordinalDate(dateOrdinal(ordered_on)+g.lead_days),supplier:String(i.supplier||'').slice(0,512),note:String(note).slice(0,1000)}))
 if(!next.every(localOrderValid)){wlMessage('Order dates or quantities need checking. Nothing marked.');return false}
 const ok=localOrderSave([...localOrders.records,...next]);if(ok)wlMessage(next.length+' orders marked on this device — not in your ERP.');return ok
}
function localOrderClear(rows,{received=false,reconcile=false}={}){
 const skus=new Set(rows.map(r=>r.item.sku)),records=localOrders.records.filter(r=>skus.has(r.sku));if(!records.length)return
 const question=reconcile?'This looks received/in your ERP now — clear? File stock and orders will not change.':received?'Mark '+records.length+' '+(records.length===1?'order':'orders')+' received and clear local tracking? Import fresh stock counts next. This does not change stock on hand or your ERP.':null
 if(question&&!confirm(question))return
 if(localOrderSave(localOrders.records.filter(r=>!skus.has(r.sku))))wlMessage(received?'Local tracking cleared. Import fresh stock counts; no ERP or stock count changed.':'Local order mark removed. File stock and orders unchanged.')
}
function localOrderIncoming(i){const r=localOrderFor(i.sku);return i.on_order==null&&!r?null:(i.on_order||0)+(r?.qty||0)}
function localOrderPill(sku){const r=localOrderFor(sku);if(!r)return null;const p=node('span',(localOrderLate(r)?'Late · ':'')+'Ordered '+shortDate(r.ordered_on),'local-order-pill');p.dataset.late=String(localOrderLate(r));p.title=orderAmount(r.qty)+' '+r.unit+' · expected '+r.expected_on+' · marked on this device — not in your ERP';return p}
function localOrderActions(rows){
 const wrap=node('div',null,'local-order-actions'),marked=rows.filter(r=>localOrderFor(r.item.sku)),eligible=attentionRows(rows).some(r=>r.guidance.quantity>0&&!localOrderFor(r.item.sku));
 if(eligible)wrap.append(wlBtn('Mark as ordered',()=>localOrderMark(rows)))
 if(marked.length){wrap.append(wlBtn('Mark received',()=>localOrderClear(marked,{received:true})),wlBtn('Undo',()=>localOrderClear(marked)));if(marked.some(r=>localOrderReconcile(localOrderFor(r.item.sku))))wrap.append(wlBtn('This looks received/in your ERP now — clear?',()=>localOrderClear(marked.filter(r=>localOrderReconcile(localOrderFor(r.item.sku))),{reconcile:true})))}
 return wrap
}
function localOrderSummary(){const n=localOrders.records.length,late=localOrders.records.filter(localOrderLate).length;return n?n+' orders placed here · '+late+' late · marked on this device — not in your ERP':''}
function localOrderFilters(){
 const content=node('div',null,'local-order-filter');for(const [key,label]of [['all','All products'],['ordered','Ordered by you'],['late','Late orders']]){const b=wlBtn(label,()=>{localOrders.filter=key;wl.status='all';wl.metric='';buildList()});b.setAttribute('aria-pressed',String(localOrders.filter===key));content.append(b)}
 content.append(node('p','Marked on this device — not in your ERP.','product-note'))
 const reconcile=localOrders.records.filter(localOrderReconcile);if(reconcile.length)content.append(wlBtn(reconcile.length+' may now be received / in your ERP — review',()=>{const rows=currentRows.filter(r=>reconcile.some(o=>o.sku===r.item.sku));localOrderClear(rows,{reconcile:true})}))
 if(localOrders.error)content.append(node('p',localOrders.error,'product-note'));return content
}
// Midnight/focus refresh uses the same evaluation key as stock decisions.
window.addEventListener('storage',event=>{if(event.key===localOrders.key){localOrders.dataset=null;render()}})
window.addEventListener('focus',()=>{if(currentToday!==localToday())render()})
setInterval(()=>{if(currentToday!==localToday())render()},60000)
localOrderLoad();render()
