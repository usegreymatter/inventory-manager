// Lifecycle: living. Read-only weekly digest; no engine, storage or ERP writes.
// Integration: embed after worklist/local-orders/xlsx, include the sibling CSS,
// then bind a View-menu button to weeklySummaryOpen(). No automatic menu patch.
// Pure API: weeklySummaryModel({rows:[{item,guidance,bucket,meta}],asOf,today,
// currency,source,localOrders,localOrderError}); metadata comes from wlMeta.
function weeklySummaryDay(value){
 if(typeof value!=='string'||value.length!==10||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null
 const stamp=Date.parse(value+'T00:00:00Z')
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?stamp/86400000:null
}
function weeklySummaryModel({rows=[],asOf='',today='',currency='',source='',localOrders=[],localOrderError=''}={}){
 const snapshot=weeklySummaryDay(asOf),decision=weeklySummaryDay(today),orders=new Map(localOrders.map(o=>[o.sku,o]))
 const finite=n=>Number.isFinite(n)&&n>=0?n:null
 const products=rows.map(r=>{
  const i=r.item,g=r.guidance,m=r.meta||{},value=finite(m.value),excess=finite(m.excess),runout=weeklySummaryDay(g.runout_date)
  // Match the core's confirmed-PO status; malformed facts may be held rows.
  const pos=i.planning_facts?.incoming_pos
  const datedIncoming=Array.isArray(pos)&&pos.some(p=>p?.remaining_qty>0&&p.status==='confirmed')
  return {sku:i.sku,name:i.name,unit:i.unit,supplier:m.supplier||i.supplier||'Supplier not assigned',bucket:r.bucket,
   quantity:finite(g.quantity),value,excess,orderBy:g.order_by==='now'?today:g.order_by||null,runout:g.runout_date||null,
   days:runout===null||snapshot===null?null:runout-snapshot,reason:g.reason||i.reason||'Check product data',
   ordered:orders.has(i.sku)||i.on_order>0||datedIncoming,incomingUnknown:i.on_order==null&&!datedIncoming&&!orders.has(i.sku)}
 })
 const compare=(a,b)=>(weeklySummaryDay(a.orderBy)??Infinity)-(weeklySummaryDay(b.orderBy)??Infinity)||(weeklySummaryDay(a.runout)??Infinity)-(weeklySummaryDay(b.runout)??Infinity)||a.sku.localeCompare(b.sku)
 const orderNow=products.filter(r=>r.bucket==='order').sort(compare)
 const totals=group=>({count:group.length,value:group.reduce((n,r)=>n+(r.value??0),0),costed:group.filter(r=>r.value!==null).length,missingCost:group.filter(r=>r.value===null).length,
  units:[...group.reduce((m,r)=>{if(r.quantity!==null)m.set(r.unit,(m.get(r.unit)||0)+r.quantity);return m},new Map())].map(([unit,quantity])=>({unit,quantity}))})
 const suppliers=[...orderNow.reduce((m,r)=>{if(!m.has(r.supplier))m.set(r.supplier,[]);m.get(r.supplier).push(r);return m},new Map())].map(([supplier,group])=>({supplier,...totals(group)})).sort((a,b)=>b.value-a.value||a.supplier.localeCompare(b.supplier))
 const bySku=new Map(products.map(r=>[r.sku,r]))
 const late=localOrders.filter(o=>decision!==null&&weeklySummaryDay(o.expected_on)!==null&&weeklySummaryDay(o.expected_on)<decision).map(o=>({sku:o.sku,name:bySku.get(o.sku)?.name||'Product not in current file',supplier:o.supplier||'Supplier not assigned',quantity:o.qty,unit:o.unit,expected:o.expected_on,daysLate:decision-weeklySummaryDay(o.expected_on)})).sort((a,b)=>a.expected.localeCompare(b.expected)||a.sku.localeCompare(b.sku))
 return {asOf,today,currency,source,total:products.length,orderNow,totals:totals(orderNow),suppliers,urgent:orderNow.slice(0,10),
  runningOut:products.filter(r=>r.bucket!=='needs-data'&&r.days!==null&&r.days<=14&&!r.ordered).sort((a,b)=>a.days-b.days||a.sku.localeCompare(b.sku)),late,
  excess:products.filter(r=>r.excess>0&&r.bucket!=='needs-data').sort((a,b)=>b.excess-a.excess||a.sku.localeCompare(b.sku)).slice(0,5),
  needingData:products.filter(r=>r.bucket==='needs-data').sort((a,b)=>a.sku.localeCompare(b.sku)),
  caveat:'Snapshot-based forecasts are estimates, not purchase instructions; confirm stock and lead times (local orders are not in your ERP).'+(localOrderError?' Local order tracking unavailable: '+localOrderError+' The no-order list may be incomplete.':'')}
}
function weeklySummaryNumber(n){return Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:3}):'—'}
// Money: whole amounts at 2 decimals for consistency (quantities keep up to 3).
function weeklySummaryMoney(model,n){return (model.currency?model.currency+' ':'')+(Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—')}
function weeklySummaryValue(model,total){return total.costed?weeklySummaryMoney(model,total.value)+(total.missingCost?' (known costs only; '+total.missingCost+' missing)':''):total.count?'Unknown — costs missing':'—'}
function weeklySummaryUnits(total){return total.units.map(r=>weeklySummaryNumber(r.quantity)+' '+r.unit).join(' · ')||'—'}
// Shared report projection: DOM, copied text and Excel all retain the same meaning.
function weeklySummarySections(m){
 const product=r=>r.name+' ('+r.sku+')'
 return [
  {name:'Overview',columns:['Measure','Value'],rows:[['Stock snapshot',m.asOf||'Unknown'],['Decision date',m.today||'Unknown'],['Data source',m.source],['Products',m.total],['Order now',m.totals.count],['Order value',weeklySummaryValue(m,m.totals)],['Order quantities',weeklySummaryUnits(m.totals)]]},
  {name:'Supplier totals',columns:['Supplier','Products','Order quantities','Order value'],rows:m.suppliers.map(s=>[s.supplier,s.count,weeklySummaryUnits(s),weeklySummaryValue(m,s)])},
  {name:'Top 10 by urgency',columns:['Product','Supplier','Order quantity','Order by','Runs out','Order value'],rows:m.urgent.map(r=>[product(r),r.supplier,weeklySummaryNumber(r.quantity)+' '+r.unit,r.orderBy||'—',r.runout||'—',r.value===null?'Unknown':weeklySummaryMoney(m,r.value)]),note:m.orderNow.length+' order-now products; earliest order date, then run-out date.'},
  {name:'Running out without an order',columns:['Product','Supplier','Runs out','Incoming stock'],rows:m.runningOut.map(r=>[product(r),r.supplier,r.runout,r.incomingUnknown?'Unknown — check file':'No order recorded']),note:m.runningOut.length+' products within 14 days of the stock snapshot, including already out. No positive file order or local order recorded; unknown incoming stock is flagged.'},
  {name:'Late local orders',columns:['Product','Supplier','Quantity','Expected','Days late'],rows:m.late.map(r=>[product(r),r.supplier,weeklySummaryNumber(r.quantity)+' '+r.unit,r.expected,r.daysLate]),note:m.late.length+' local orders late as of '+(m.today||'unknown')+'; not ERP confirmation.'},
  {name:'Top 5 excess stock',columns:['Product','Supplier','Excess value'],rows:m.excess.map(r=>[product(r),r.supplier,weeklySummaryMoney(m,r.excess)]),note:'Known costs only. Reuses the worklist estimate; products with missing cost are not ranked.'},
  {name:'Needing data',columns:['Product','Reason'],rows:m.needingData.map(r=>[product(r),r.reason]),note:m.needingData.length+' products held for data checks.'},
  {name:'Caveat',columns:['Read before ordering'],rows:[[m.caveat]]}
 ]
}
function weeklySummaryText(model){
 // Keep each cell on one line so imported text cannot masquerade as report headings.
 const cell=v=>String(v??'').slice(0,32767).replace(/[\r\n\u2028\u2029]+/g,' ')
 return ['WEEKLY STOCK SUMMARY',...weeklySummarySections(model).map(s=>[s.name,s.note||'',s.columns.join(' · '),...(s.rows.length?s.rows.map(r=>r.map(cell).join(' · ')):['None'])].filter(Boolean).join('\n'))].join('\n\n')
}
function weeklySummarySheets(model){return weeklySummarySections(model).map(s=>({name:s.name,rows:[s.columns,...s.rows,...(s.note?[[s.note]]:[])]}))}
function weeklySummaryOpen(){
 const existing=document.getElementById('weekly-summary')
 if(existing){existing.querySelector('button').focus();return existing}
 // Refresh through the canonical render path only if the decision day changed.
 if(currentToday!==localToday())render()
 wlRefresh()
 const model=weeklySummaryModel({rows:currentRows.map(r=>({...r,meta:wlMeta(r)})),asOf:data.as_of,today:currentToday,currency:settings.currency||'',source:sourceName==='demo'?'Synthetic demo — fictional products':sourceName==='sample'?'Sample data — not real stock':'Local CSV — stays on this device',localOrders:localOrders.records,localOrderError:localOrders.error})
 const trigger=document.activeElement,dialog=node('dialog',null,'weekly-summary'),header=node('header',null,'weekly-summary-header'),title=node('h1','Weekly stock summary'),actions=node('div',null,'weekly-summary-actions'),report=node('article',null,'weekly-summary-report'),status=node('p',null,'weekly-summary-status'),fallback=node('textarea',null,'weekly-summary-copy')
 dialog.id='weekly-summary';title.id='weekly-summary-title';dialog.setAttribute('aria-labelledby',title.id);status.setAttribute('role','status');fallback.hidden=true;fallback.readOnly=true;fallback.setAttribute('aria-label','Weekly summary text — select and copy')
 const text=weeklySummaryText(model)
 const copy=wlBtn('Copy text',async()=>{try{await navigator.clipboard.writeText(text);status.textContent='Summary copied. Nothing sent.'}catch{fallback.hidden=false;fallback.value=text;fallback.focus();fallback.select();status.textContent='Clipboard unavailable. Select and copy the summary below.'}})
 copy.className='weekly-summary-primary'
 const excel=wlBtn('Download Excel',()=>{try{const bytes=wlXlsxWorkbook(weeklySummarySheets(model));wlDownload(bytes,'inventory-manager-weekly-'+(model.asOf||'snapshot')+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');status.textContent='Excel prepared from this summary.'}catch{status.textContent='Excel could not be prepared. Copy text instead.'}})
 excel.disabled=typeof wlXlsxWorkbook!=='function'
 const print=wlBtn('Print / Save PDF',()=>{document.body.classList.add('weekly-summary-printing');try{window.print()}finally{document.body.classList.remove('weekly-summary-printing')}})
 const close=wlBtn('Close',()=>dialog.close());close.setAttribute('aria-label','Close weekly stock summary')
 actions.append(copy,excel,print,close);header.append(title,actions)
 const meta=node('p','Stock snapshot '+(model.asOf||'unknown')+' · Decision date '+(model.today||'unknown')+' · '+model.source,'weekly-summary-meta')
 const lead=node('div',null,'weekly-summary-lead');lead.append(node('strong',String(model.totals.count)),node('div','products to order now'),node('p',weeklySummaryValue(model,model.totals)+' · '+model.suppliers.length+' suppliers'))
 report.append(meta,lead)
 for(const section of weeklySummarySections(model).slice(1)){
  const el=node('section',null,'weekly-summary-section');el.append(node('h2',section.name));if(section.note)el.append(node('p',section.note,'weekly-summary-note'))
  if(section.name==='Caveat')el.append(node('p',model.caveat))
  else if(!section.rows.length)el.append(node('p','None.','weekly-summary-note'))
  else{
   const wrap=node('div',null,'weekly-summary-table-wrap'),table=node('table'),head=node('thead'),headRow=node('tr'),body=node('tbody')
   table.setAttribute('aria-label',section.name)
   for(const label of section.columns){const th=node('th',label);th.scope='col';headRow.append(th)}head.append(headRow)
   // Keep very large imports readable; full lists remain in Copy text and Excel.
   for(const row of section.rows){const tr=node('tr');for(const cell of row)tr.append(node('td',String(cell??'—')));body.append(tr)}
   table.append(head,body);wrap.append(table);el.append(wrap)
   if(section.rows.length>20)el.append(node('p','Showing 20 of '+section.rows.length+'. Print, copy text or download Excel for the full list.','weekly-summary-note weekly-summary-screen-only'))
  }
  report.append(el)
 }
 dialog.append(header,report,status,fallback)
 dialog.addEventListener('close',()=>{document.body.classList.remove('weekly-summary-printing');dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true})},{once:true})
 // Escape and focus trapping are supplied by the native dialog. No app state,
 // view filters, selections, URL or persisted orders are changed.
 document.body.append(dialog);dialog.showModal();copy.focus();return dialog
}
