// Lifecycle: living. Advisory only: never mutate a product or forecast quantity.
// Pure planner takes already-rounded NEXT orders, not a new demand calculation.
function supplierMinimumPlan({minimumValue=0,minimumQty=0,value=0,qty=0,candidates=[]}){
 const gapValue=Math.max(0,minimumValue-value),gapQty=Math.max(0,minimumQty-qty),lines=[];let addedValue=0,addedQty=0
 for(const c of [...candidates].sort((a,b)=>String(a.runout||'9999').localeCompare(String(b.runout||'9999'))||a.sku.localeCompare(b.sku))){
  if(addedValue+1e-8>=gapValue&&addedQty+1e-8>=gapQty)break
  if(!Number.isFinite(c.cost)||c.cost<0||c.cost===0&&gapQty===0||!Number.isFinite(c.qty)||c.qty<=0||!Number.isFinite(c.cover)||c.cover>12||['no-sales','needs-data','overstocked'].includes(c.bucket))continue
  const pack=Number.isFinite(c.pack)&&c.pack>0?c.pack:1,moq=Number.isFinite(c.moq)&&c.moq>0?c.moq:0
  const quantity=Math.round(Math.ceil((Math.max(c.qty,moq)-1e-9)/pack)*pack*1e6)/1e6
  if(!Number.isFinite(quantity)||quantity<=0||quantity>1e12)continue
  lines.push({...c,qty:quantity});addedQty+=quantity;addedValue+=quantity*c.cost
 }
 return {gapValue,gapQty,lines,addedValue,addedQty,complete:addedValue+1e-8>=gapValue&&addedQty+1e-8>=gapQty}
}
const supplierMinimums={dataset:null,key:'',values:new Map(),accepted:new Map(),source:null,groups:new Map(),contexts:new Map(),error:''}
function supplierMinimumLoad(){
 if(supplierMinimums.dataset===data)return
 supplierMinimums.dataset=data;supplierMinimums.key='stock-runway.supplier-minimums.v1:'+gmSettingsKey(data);supplierMinimums.values=new Map();supplierMinimums.accepted.clear();supplierMinimums.error=''
 try{const saved=JSON.parse(localStorage.getItem(supplierMinimums.key)||'[]');if(!Array.isArray(saved)||saved.length>20000)throw Error();for(const pair of saved){if(!Array.isArray(pair)||typeof pair[0]!=='string'||!pair[1]||!['min_order_value','min_order_qty'].every(k=>pair[1][k]===null||Number.isFinite(pair[1][k])&&pair[1][k]>=0&&pair[1][k]<=1e12))throw Error();supplierMinimums.values.set(pair[0],pair[1])}}catch{supplierMinimums.error='Saved minimums could not be loaded. Changes are blocked; repair local storage first.'}
}
function supplierMinimumRecord(supplier){const records=data.suppliers;return Array.isArray(records)?records.find(s=>s&&[s.name,s.supplier,s.id].includes(supplier)):records&&Object.hasOwn(records,supplier)?records[supplier]:null}
function supplierMinimumGet(supplier){supplierMinimumLoad();const file=supplierMinimumRecord(supplier)||{},saved=supplierMinimums.values.get(supplier);return Object.fromEntries(['min_order_value','min_order_qty'].map(k=>[k,saved&&Object.hasOwn(saved,k)?saved[k]:Number.isFinite(file[k])&&file[k]>=0?file[k]:null]))}
function supplierMinimumSync(){
 supplierMinimumLoad();if(supplierMinimums.source===currentRows)return
 supplierMinimums.source=currentRows;supplierMinimums.accepted.clear();supplierMinimums.contexts.clear();supplierMinimums.groups=new Map()
 for(const r of currentRows){const supplier=gmMeta(r.item.supplier);if(!supplierMinimums.groups.has(supplier))supplierMinimums.groups.set(supplier,[]);supplierMinimums.groups.get(supplier).push(r)}
 supplierMinimums.localSkus=new Set(localOrders.records.map(r=>r.sku))
}
function supplierMinimumContext(supplier,rows){
 supplierMinimumSync();if(supplierMinimums.contexts.has(supplier))return supplierMinimums.contexts.get(supplier)
 // Supplier-wide, independent of table filters: accepting cannot silently change
 // the chosen lines when the user clears a search or changes status tabs.
 const all=supplierMinimums.groups.get(supplier)||[],limits=supplierMinimumGet(supplier),base=attentionRows(all).filter(r=>r.guidance.quantity>0),skus=new Set(base.map(r=>r.item.sku));let qty=0,value=0,missing=0
 for(const r of base){qty+=r.guidance.quantity;const cost=resolveOrderSettings(r.item,settings).values.unit_cost;if(Number.isFinite(cost)&&cost>=0)value+=cost*r.guidance.quantity;else missing++}
 const candidates=all.filter(r=>!skus.has(r.item.sku)&&!supplierMinimums.localSkus.has(r.item.sku)).map(r=>{const v=resolveOrderSettings(r.item,settings).values;return {sku:r.item.sku,qty:r.guidance.quantity,cost:v.unit_cost,pack:v.pack_size,moq:v.minimum_order,cover:r.guidance.overstock_months,bucket:r.bucket,runout:r.guidance.runout_date,row:r}})
 const plan={...supplierMinimumPlan({minimumValue:limits.min_order_value||0,minimumQty:limits.min_order_qty||0,value,qty,candidates}),limits,missing,value,qty};supplierMinimums.contexts.set(supplier,plan);return plan
}
function supplierMinimumRows(supplier,rows){
 supplierMinimumSync()
 const accepted=supplierMinimums.accepted.get(supplier)||[],bySku=new Map(accepted.map(c=>[c.sku,c]))
 const clone=c=>({...c.row,bucket:'order',minimumAdded:true,guidance:{...c.row.guidance,quantity:c.qty,order_by:'now'}})
 const skus=new Set(rows.map(r=>r.item.sku));return [...rows.map(r=>bySku.has(r.item.sku)?clone(bySku.get(r.item.sku)):r),...accepted.filter(c=>!skus.has(c.sku)).map(clone)]
}
function supplierMinimumMoney(n){const currency=settings.currency||'';return (currency?currency+' ':'')+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function supplierMinimumLabel(r){return r.minimumAdded?' (added to reach minimum)':''}
function supplierMinimumHeader(entry){
 const plan=supplierMinimumContext(entry.group,entry.rows),accepted=supplierMinimums.accepted.has(entry.group),chosen=supplierMinimums.accepted.get(entry.group)||plan.lines;if(!accepted&&(!entry.orders||!plan.gapValue&&!plan.gapQty))return null
 const line=node('div',null,'supplier-minimum-line'),parts=[]
 if(plan.gapValue)parts.push('Below '+supplierMinimumMoney(plan.limits.min_order_value)+' minimum by '+supplierMinimumMoney(plan.gapValue))
 if(plan.gapQty)parts.push('Below '+orderAmount(plan.limits.min_order_qty)+' unit minimum by '+orderAmount(plan.gapQty))
 let text=parts.join(' · ')+' · full supplier order'
 if(plan.missing&&plan.limits.min_order_value)text+=' (known costs only; '+plan.missing+' missing)'
 if(chosen.length)text+=' — '+(accepted?'Added to draft: ':'suggestion: add ')+chosen.slice(0,1).map(c=>orderAmount(c.qty)+' × '+c.sku).join(', ')+(chosen.length>1?' + '+(chosen.length-1)+' more':'')+' (next to run out)'+(plan.complete?'':' · minimum still not reached')
 else text+=' — no eligible next order to add'
 const description=node('span',text);description.title=text;line.append(description)
 if(chosen.length){if(chosen.length>1)line.append(wlBtn('Review '+chosen.length+' additions',()=>supplierMinimumReview(plan,chosen)));const add=wlBtn(accepted?'Remove additions':'Add to this order',()=>{if(accepted)supplierMinimums.accepted.delete(entry.group);else supplierMinimums.accepted.set(entry.group,plan.lines);wlLayout();wlRenderRows();wlMessage(accepted?'Minimum additions removed.':'Added to supplier drafts, copy and Excel only. Product quantities unchanged.')});add.dataset.minimumAdd=entry.group;line.append(add)}
 return line
}
function supplierMinimumReview(plan,chosen){
 const dialog=node('dialog',null,'order-email-dialog'),header=node('div',null,'order-email-heading'),title=node('h2','Minimum-order additions'),trigger=document.activeElement
 const close=wlBtn('Close',()=>dialog.close());header.append(title,close);dialog.append(header,node('p','Next orders, earliest run-out first. Draft, copy and Excel only; product suggestions stay unchanged.','product-note'))
 const list=node('ol');for(const c of chosen)list.append(node('li',orderAmount(c.qty)+' × '+c.sku+' · '+supplierMinimumMoney(c.qty*c.cost)+' · runs out '+(c.runout||'unknown')));dialog.append(list,node('p','Additional value: '+supplierMinimumMoney(plan.addedValue)+(plan.complete?' · minimum reached with these additions.':' · not enough eligible next orders to reach the minimum.'),'product-note'))
 dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus()},{once:true});document.body.append(dialog);dialog.showModal();close.focus()
}
function supplierMinimumSettings(){
 supplierMinimumLoad();const section=node('section',null,'settings-group supplier-minimum-settings');section.id='supplier-minimum-settings';section.append(node('h3','Suppliers'),node('p','Optional order minimums — advisory only. Blank disables a minimum. Quantity adds stock units; use only when those units are comparable. These limits never change product suggestions.','setting-meaning'))
 const table=node('table'),head=node('tr');for(const title of ['Supplier','Minimum value','Minimum quantity'])head.append(node('th',title));const thead=node('thead');thead.append(head);table.append(thead);const tbody=node('tbody')
 for(const supplier of [...new Set(data.items.map(i=>gmMeta(i.supplier)).filter(Boolean))].sort((a,b)=>a.localeCompare(b))){const tr=node('tr');tr.append(node('th',supplier));const limits=supplierMinimumGet(supplier)
  for(const key of ['min_order_value','min_order_qty']){const td=node('td'),input=node('input');input.type='number';input.min='0';input.max='1000000000000';input.step='any';input.placeholder='None';input.value=limits[key]??'';input.setAttribute('aria-label',(key==='min_order_value'?'Minimum value for ':'Minimum quantity for ')+supplier);input.dataset.minimumSupplier=supplier;input.dataset.minimumKey=key
   input.addEventListener('change',()=>{const value=input.value===''?null:Number(input.value);if(!input.validity.valid||value!==null&&(!Number.isFinite(value)||value<0||value>1e12)){input.setAttribute('aria-invalid','true');status.textContent='Enter a minimum from 0 to 1,000,000,000,000. Previous value kept.';return}if(supplierMinimums.error){status.textContent=supplierMinimums.error;return}const next=new Map(supplierMinimums.values);next.set(supplier,{...supplierMinimumGet(supplier),[key]:value});try{localStorage.setItem(supplierMinimums.key,JSON.stringify([...next]));supplierMinimums.values=next;supplierMinimums.accepted.clear();supplierMinimums.contexts.clear();input.removeAttribute('aria-invalid');status.textContent='Supplier minimum saved on this device.';wlLayout();wlRenderRows()}catch{status.textContent='Could not save minimum. No changes made.'}});td.append(input);tr.append(td)}tbody.append(tr)
 }
 table.append(tbody);const status=node('p',supplierMinimums.error,'setting-meaning');status.setAttribute('role','status');section.append(table,status);return section
}
const supplierMinimumOpenSettings=gmOpenSettings
gmOpenSettings=function(...args){document.querySelector('#supplier-minimum-settings')?.remove();gmOldBody.append(supplierMinimumSettings());return supplierMinimumOpenSettings(...args)}
