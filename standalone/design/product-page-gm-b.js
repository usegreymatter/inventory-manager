// Lifecycle: living. Read-only full product report using existing evaluated rows.
const productPage={overlay:null,returnHash:'',trigger:null,inert:[],fromPush:false,queue:[]}
// Freeze navigation IDs for this report session, but always read fresh evaluated rows.
function productNavigationRows(){return productPage.queue.map(sku=>rowMap.get(sku)).filter(Boolean)}
function productHash(sku){return '#product='+encodeURIComponent(sku)}
function productSource(source){return ({'from file':'File','supplier setting':'Supplier','product setting':'Product',default:'Default'})[source]||source}
function productCurrentMethod(item){
 const c=globalThis.StockRunwayForecastMethods.classify(item.monthly_sales||[])
 return c.class[0].toUpperCase()+c.class.slice(1)+' demand — using Current ('+(item.forecast_explanation||'existing forecast')+')'
}
function productArrivalLabel(row){
 const local=localOrderFor(row.item.sku),supplied=data.items.find(i=>i.sku===row.item.sku),confirmed=supplied?.planning_facts?.incoming_pos?.some(p=>p.status==='confirmed'&&p.due_date===row.guidance.delivery_date)
 return local&&!confirmed&&row.guidance.delivery_date===local.expected_on?'Expected (lead-time estimate)':'Confirmed arrival'
}
function productInputs(row){
 const {item:i,guidance:g}=row,{values:v,sources:s}=resolveOrderSettings(i,settings),section=node('section',null,'product-inputs'),grid=node('div',null,'product-input-grid')
 const head=node('div',null,'product-section-head');head.append(node('h2','Inputs & settings'),wlBtn('Change settings for this product',()=>openProductSettings(i.sku)));section.append(head)
 const add=(label,value,source)=>{const r=node('div',null,'product-input');r.append(node('span',label),node('strong',value==null?'Not set':String(value)),node('small',source));grid.append(r)}
 const qty=x=>x==null?'Unknown':orderAmount(x)+' '+i.unit
 add('On hand',qty(i.on_hand),'File');add('On order',qty(localOrderIncoming(i)),localOrderFor(i.sku)?'File + this device':'File')
 const receipts=Object.entries(i.receipts||{}).filter(([month])=>month>data.as_of.slice(0,7)).map(([month,quantity])=>`${label(month)} · ${qty(quantity)} (monthly total)`)
 for(const r of i.planning_facts?.incoming_pos||[])if(r.status==='confirmed')receipts.push(`${r.due_date} · ${qty(r.remaining_qty)}`)
 add('Dated receipts',receipts.length?receipts.join('; '):'None in file',localOrderFor(i.sku)?'File + this device':'File')
 add('Lead time',g.used_default_lead?`Assumed ${g.lead_days} days`:g.lead_days==null?'Not set':`${g.lead_days} days`,productSource(s.supplier_days))
 add('Chance of not running out per order cycle',v.service_level==null?'Not set':`${v.service_level*100}%`,productSource(s.service_level))
 add('Safety stock',qty(g.safety_stock),'Calculated');add('Reorder point',qty(g.reorder_point),'Calculated')
 add('Cover',resolveOrderSettings(i,settings).settings.months_of_cover+' months',Object.hasOwn(settings.product_overrides?.[i.sku]||{},'months_of_cover')?'Product':'Default');add('MOQ',v.minimum_order==null?'Not set':qty(v.minimum_order),productSource(s.minimum_order));add('Pack',v.pack_size==null?'Not set':qty(v.pack_size),productSource(s.pack_size))
 add('Buffer',settings.buffer_days+' days','Default');add('Review period',v.review_days+' days',productSource(s.review_days));add('Safety stock in order',settings.include_backup_in_orders?'Included':'Not included','Default')
 add('Unit cost',v.unit_cost==null?'Not set':orderAmount(v.unit_cost),productSource(s.unit_cost));add('Order cost',settings.order_cost==null?'Not set':orderAmount(settings.order_cost),'Default');add('Holding cost',settings.holding_pct==null?'Not set':settings.holding_pct+'%','Default')
 add('Safety stock basis',g.safety_stock_provenance?.basis==='forecast_misses'?'Past forecast misses (experimental)':settings.safety_stock_basis==='forecast_misses'?'Sales variation (fallback)':'Sales variation (default)','Calculated');add('Stock snapshot',data.as_of,'File');add('Decision date',currentToday,'This device');add('Forecast method',g.forecast_method?.label||i.forecast_method?.label||productCurrentMethod(i),'Calculated')
 section.append(grid,node('p','Planning settings stay on this device. Stock counts and incoming orders are read-only. Service level is model-based, not a guaranteed fill rate.','product-note'));return section
}
function productLedger(row){
 const {item:i,guidance:g}=row,section=node('section',null,'product-ledger'),scroll=node('div',null,'product-ledger-scroll'),table=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody')
 section.append(node('h2','Month by month'),node('p',`Quantities in ${i.unit} · stock is the existing projection without a new suggested order.`,'product-note'))
 for(const t of ['Month','Sales / forecast','Likely range','Incoming','Projected stock','Milestones'])tr.append(node('th',t));head.append(tr);table.append(head,body)
 if(i.held||g.status==='needs-data'){section.append(node('p','Check product data to see the monthly ledger.'));return section}
 const series=seriesFor(i),orderDate=g.order_by==='now'?currentToday:g.order_by
 series.timeline.forEach((r,index)=>{const past=index<series.n,stock=past?series.history.rows[index]?.stock:series.rows[index-series.n].stock,line=node('tr');line.dataset.period=past?'actual':'forecast'
  const markers=[];for(const [date,name]of [[orderDate,'Order by'],[g.delivery_date,productArrivalLabel(row)],[g.runout_date,'Runs out']])if(date?.slice(0,7)===r.month)markers.push(name+' '+shortDate(date))
  line.append(node('th',label(r.month)+(past?'':' · forecast')),node('td',orderAmount(Math.abs(r.demand)>=100?Math.round(r.demand):Math.round(r.demand*10)/10)),node('td',past||!forecastCloud(i)?'—':cloudRange(forecastCloud(i).bands[index-series.n])),node('td',r.receipts?orderAmount(r.receipts):'—'),node('td',stock==null?'Unknown':stockCell(past?stock:Math.max(0,stock))),node('td',markers.join(' · ')||'—'));body.append(line)
 });scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Monthly stock ledger, scroll horizontally');scroll.append(table);section.append(scroll);return section
}
function openProductSettings(sku){
 gmSheetReturnFocus=document.activeElement;gmSettingsScope={group:'product_overrides',id:sku};gmGlobalContent.hidden=true;gmSupplierContent.hidden=false;gmSheetTitle.textContent='Product settings'
 gmSupplierContent.replaceChildren(node('p',rowMap.get(sku).item.name,'setting-title'),node('p','Blank or Reset inherits supplier settings, then the file, then the default. Changes apply live on this device.','setting-meaning'))
 for(const key of OVERRIDE_FIELDS.product_overrides){const field=gmSettingsField(key,gmSettingsScope);for(const el of field.querySelectorAll('[id]'))el.id='sheet-'+el.id;for(const el of field.querySelectorAll('[for]'))el.htmlFor='sheet-'+el.htmlFor;for(const el of field.querySelectorAll('[aria-describedby]'))el.setAttribute('aria-describedby',el.getAttribute('aria-describedby').split(' ').map(id=>'sheet-'+id).join(' '));gmSupplierContent.append(field)}
 gmSyncFields();gmSettingsSheet.showModal()
}
function drawProductPage(row){
 const overlay=productPage.overlay;if(!overlay||!row)return
 if(chartFocus.overlay)closeChartFocus({restore:false})
 const oldScroll=overlay.dataset.sku===row.item.sku?overlay.scrollTop:0;overlay.dataset.sku=row.item.sku
 const {item:i,guidance:g}=row,wrap=node('div',null,'product-page-content'),nav=node('nav',null,'product-page-nav'),pager=node('div'),navigation=productNavigationRows(),index=navigation.findIndex(r=>r.item.sku===i.sku)
 const close=wlBtn('← All products',()=>closeProductPage());close.id='product-page-close'
 const prev=wlBtn('‹',()=>navigateSku(-1)),next=wlBtn('›',()=>navigateSku(1));prev.setAttribute('aria-label','Previous product');next.setAttribute('aria-label','Next product');prev.disabled=index<=0;next.disabled=index<0||index>=navigation.length-1
 pager.append(prev,node('span',`${index+1} / ${navigation.length}`),next)
 const panel=wlBtn('Side panel view',()=>showProductAsPanel(row),'product-view-toggle');panel.title='Open products in a side panel next to the list';const tools=node('div',null,'product-page-tools');tools.append(panel,pager);nav.append(close,tools)
 const header=node('header',null,'product-page-heading'),meta=node('p',null,'product-page-meta'),status=wlStatusCell(row);header.append(node('h1',i.name));meta.append(status,node('span',[i.sku,i.category||'No product type',i.supplier||'Supplier not assigned'].join(' · ')));const ordered=localOrderPill(i.sku);if(ordered)meta.append(ordered);header.append(meta)
 const methodNote=node('p',g.forecast_method?.label||i.forecast_method?.label||productCurrentMethod(i),'product-note');methodNote.dataset.forecastMethod='true';if(i.forecast_method?.requested==='recommended')methodNote.dataset.recommendedMethod='true';header.append(methodNote);if(i._method_model)header.append(node('small','Experimental · method selected explicitly. Forecast ranges and run-out probabilities withheld: Current calibration does not apply.','product-note'))
 const figures=node('div',null,'product-page-figures');for(const [title,value,unit]of [[localOrderFor(i.sku)?'Additional order':'Order qty',g.quantity==null?'—':orderAmount(g.quantity),i.unit],[localOrderFor(i.sku)&&!(g.quantity>0)?'Expected arrival':'Order by',localOrderFor(i.sku)&&!(g.quantity>0)?'~'+gmDate(localOrderFor(i.sku).expected_on):g.order_by==='now'?'Today':g.order_by?gmDate(g.order_by):'Not needed',localOrderFor(i.sku)&&!(g.quantity>0)?'Lead-time estimate':''],['Runs out',g.runout_date?gmDate(g.runout_date):'Not forecast','']]){const figure=node('div');figure.append(node('span',title),node('strong',value),node('small',unit));figures.append(figure)}
 const chart=node('section',null,'product-page-chart');if(i.held||g.status==='needs-data')chart.append(node('p',g.reason||'Check product data'));else chart.append(fullChart(row))
 const capped=detectStockoutMonths(i,data.as_of.slice(0,7))
 if(capped.flagged.length){
  const before=orderGuidance(i,currentToday,{...settings,stockout_adjust:false},data.as_of),after=orderGuidance(i,currentToday,{...settings,stockout_adjust:true},data.as_of)
  const names=capped.flagged.map(f=>label(f.month)).join(', '),note=node('p',null,'product-note stockout-note');note.dataset.stockoutNote=i.sku
  const estimates=before.quantity!=null&&after.quantity!=null
  note.textContent=`Sales look capped by stock-outs in ${names}`+(estimates?` — with correction, order would be ${orderAmount(after.quantity)} instead of ${orderAmount(before.quantity)} ${i.unit}.`:' — not enough data to estimate a corrected order.')+` ${settings.stockout_adjust?'Correction ON for orders.':'Advisory only · correction OFF.'} Hatched months: ${capped.flagged.every(f=>f.confidence==='known')?'known stock-out':'likely stock-out · not confirmed by stock history'}.`
  chart.prepend(note)
 }else if(settings.stockout_adjust){const note=node('p','Stock-out correction ON · no capped months detected.','product-note');note.dataset.stockoutNote=i.sku;chart.prepend(note)}

 if(wl.status!=='all'&&wl.mode!=='simple')status.append(node('span',wlStatus.find(c=>c[0]===row.bucket)?.[1]||bucketNames[row.bucket]));
 const action=node('div',null,'product-order-action'),copy=wlBtn('Copy order',async()=>{
  const text=wlOrderText([row]);let message=action.querySelector('[role=status]');if(!message){message=node('span');message.setAttribute('role','status');action.append(message)}
  try{await navigator.clipboard.writeText(text);message.textContent='Order copied.'}catch{let input=action.querySelector('textarea');if(!input){input=node('textarea');input.readOnly=true;input.setAttribute('aria-label','Order text — select and copy');action.append(input)}input.value=text;input.focus();input.select();message.textContent='Select and copy the order text below.'}
 });const draft=wlBtn('Draft email',()=>wlDraftEmail([row]),'product-draft-email');draft.disabled=!wlEmailGroups([row]).length;copy.disabled=!(g.quantity>0);action.append(copy,draft,localOrderActions([row]),node('p',localOrderFor(i.sku)?localOrderDisplay(localOrderFor(i.sku))+' · '+orderAmount(localOrderFor(i.sku).qty)+' '+i.unit+' · not in your ERP.':g.reason||chartKeyline(row),'product-note'))
 const large=bigOrderWarning(g,settings);if(large){const note=node('p',large,'product-note');note.dataset.bigOrder=i.sku;action.prepend(note)}
 const inputWarnings=itemInputWarnings(i);if(inputWarnings)action.append(inputWarnings)
 if(localOrderFor(i.sku)){if((i.on_order||0)>0||Object.values(i.receipts||{}).some(v=>v>0))action.append(node('p','Existing incoming stock has no exact PO dates. The shared planner holds mixed incoming data for review; no file stock was replaced.','product-note'))}
 wrap.append(nav,header,figures,chart,productLedger(row),productInputs(row),action);overlay.replaceChildren(wrap);overlay.scrollTop=oldScroll;chart.querySelector('figure')?.drawChart();cleanupCharts();syncProductSettingSources()
}
function openProductPage(row,{push=true}={}){
 if(!row)return
 if(!productPage.overlay){productPage.queue=filteredRows.map(r=>r.item.sku);if(!productPage.queue.includes(row.item.sku))productPage.queue.push(row.item.sku);productPage.returnHash=location.hash.includes('product=')?'':location.hash;productPage.trigger=document.activeElement;const overlay=node('section',null,'product-page');overlay.id='product-page';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Full product page');productPage.overlay=overlay
  productPage.inert=[...document.body.children].filter(e=>!['SCRIPT','DIALOG'].includes(e.tagName)).map(e=>[e,e.inert]);for(const [e]of productPage.inert)e.inert=true;document.body.append(overlay)
 }
 selectedSku=row.item.sku;selectItem(row,{hash:false})
 if(push){productPage.fromPush=true;history.pushState(null,'',productHash(row.item.sku))}else history.replaceState(null,'',productHash(row.item.sku))
 $('product-page-close').focus({preventScroll:true})
}
function removeProductPage(){
 if(!productPage.overlay)return
 closeChartFocus({restore:false});productPage.overlay.remove();productPage.overlay=null;productPage.queue=[];for(const [e,value]of productPage.inert)e.inert=value;productPage.inert=[];cleanupCharts()
}
function closeProductPage(){
 const returnHash=productPage.returnHash,pushed=productPage.fromPush;productPage.fromPush=false
 if(pushed)history.back();else{removeProductPage();history.replaceState(null,'',returnHash||'#');wlHash();restoreProductFocus()}
}
const productNavigateBase=navigateSku
navigateSku=function(delta){
 if(!productPage.overlay)return productNavigateBase(delta)
 const rows=productNavigationRows(),row=rows[rows.findIndex(r=>r.item.sku===selectedSku)+delta];if(!row)return
 const focused=!!chartFocus.overlay;openProductPage(row,{push:false});if(focused)openChartFocus(productPage.overlay.querySelector('figure'))
}
const productSelectBase=selectItem
selectItem=function(row,options={}){productSelectBase(row,options);if(productPage.overlay)drawProductPage(row)}
const productChartBase=fullChart
fullChart=function(row){const figure=productChartBase(row);if(!productPage.overlay){const old=figure.querySelector('.chart-expand'),expand=wlBtn('⤢',()=>{setProductView('page');openProductPage(row)},'chart-expand');expand.setAttribute('aria-label','Open full product page');expand.title='Full product page · F';old.replaceWith(expand)}return figure}
// Preserve graph-only focus inside the report, with Escape returning to the report.
const productFocusBase=openChartFocus
openChartFocus=function(figure){if(!productPage.overlay)return openProductPage(figure?.chartRow);return productFocusBase(figure)}
function restoreProductFocus(){const trigger=productPage.trigger?.isConnected?productPage.trigger:wl.drawer?$('main').querySelector('.chart-expand'):wlScroll;trigger?.focus({preventScroll:true})}
function syncProductSettingSources(){
 if(!gmSettingsSheet.open||gmSettingsScope?.group!=='product_overrides')return
 const effective=resolveOrderSettings(rowMap.get(gmSettingsScope.id)?.item||{},settings)
 for(const source of gmSupplierContent.querySelectorAll('[data-provenance]')){const key=source.dataset.provenance,value=effective.values[key];source.textContent=`${value==null?'Not set':key==='service_level'?value*100+'%':value+(['supplier_days','review_days'].includes(key)?' days':'')} · ${productSource(effective.sources[key])}`}
}
gmSettingsSheet.addEventListener('close',()=>{if(productPage.overlay)productPage.overlay.querySelector('.product-section-head button')?.focus({preventScroll:true})})
window.addEventListener('hashchange',e=>{
 const params=new URLSearchParams(location.hash.slice(1)),sku=params.get('product');if(!params.has('product')&&!productPage.overlay)return
 e.stopImmediatePropagation()
 if(sku&&rowMap.has(sku)){openProductPage(rowMap.get(sku),{push:false});return}
 if(params.has('product'))history.replaceState(null,'','#')
 removeProductPage();productPage.fromPush=false;wlRestore(location.hash);buildList();if(wl.drawer)selectItem(rowMap.get(selectedSku),{hash:false});else wlCloseDrawer();restoreProductFocus()
},true)
document.addEventListener('keydown',e=>{
 if(!productPage.overlay||chartFocus.overlay||document.querySelector('dialog[open]')||e.metaKey||e.ctrlKey||e.altKey||e.target.closest('input,textarea,select'))return
 if(['ArrowUp','ArrowDown'].includes(e.key)){e.stopImmediatePropagation();return}
 if(e.target.closest('.product-ledger-scroll')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.stopImmediatePropagation();return}
 if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();const tooltip=productPage.overlay.querySelector('.chart-tooltip:not([hidden])');if(tooltip){tooltip.hidden=true;productPage.overlay.querySelector('[data-crosshair]')?.remove()}else closeProductPage()}
 else if(e.key.toLowerCase()==='f'){e.preventDefault();e.stopImmediatePropagation();openChartFocus(productPage.overlay.querySelector('figure'))}
 else if(['j','k','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();navigateSku(['j','ArrowRight'].includes(e.key)?1:-1)}
 else if(e.key==='Tab'){const controls=[...productPage.overlay.querySelectorAll('button:not([disabled]),summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(e=>e.checkVisibility());const index=controls.indexOf(document.activeElement);if(e.shiftKey&&index<=0||!e.shiftKey&&index===controls.length-1){e.preventDefault();controls[e.shiftKey?controls.length-1:0]?.focus()}}
},true)
function restoreInitialProductPage(hash){
 const params=new URLSearchParams(hash.slice(1)),sku=params.get('product')
 if(rowMap.has(sku))openProductPage(rowMap.get(sku),{push:false})
 else{if(params.has('product')){history.replaceState(null,'','#');wlHash()}if(wl.drawer)selectItem(rowMap.get(selectedSku),{hash:false})}
}
if(!gmBInitialRestorePending)restoreInitialProductPage(gmBInitialHash)

// Product view preference: full page (default) or side panel. Remembered on this device.
const PRODUCT_VIEW_KEY='stock-runway.product-view'
function productView(){try{return localStorage.getItem(PRODUCT_VIEW_KEY)==='panel'?'panel':'page'}catch{return 'page'}}
function setProductView(v){try{localStorage.setItem(PRODUCT_VIEW_KEY,v)}catch{}}
const wlOpenBase=wlOpen
wlOpen=function(row){if(!row)return;if(productView()==='page')return openProductPage(row);return wlOpenBase(row)}
function showProductAsPanel(row){setProductView('panel');productPage.fromPush=false;const returnHash=productPage.returnHash;removeProductPage();history.replaceState(null,'',returnHash||'#');wlHash();wlOpenBase(row)}
