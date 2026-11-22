// Lifecycle: living. Display-only progressive detail; no planning arithmetic.
// Functions are hoisted because the worklist and risk adapters render at startup.
function decisionDetail(){return wl.mode!=='simple'}
function decisionInitialMode(){try{return localStorage.getItem('stock-runway.show-detail')==='true'?'detailed':'simple'}catch{return 'simple'}}
function decisionExpandedMode(){try{return localStorage.getItem('stock-runway.detail-mode')==='custom'?'custom':'detailed'}catch{return 'detailed'}}
function setDecisionDetail(value,mode){try{localStorage.setItem('stock-runway.show-detail',String(value));if(value&&mode)localStorage.setItem('stock-runway.detail-mode',mode)}catch{}}
function riskLevel(value){return riskLabel(value)}
function riskChip(row,value=wlValue(row,'risk'),pending=true){
 const level=riskLevel(value),chip=node('span',level||(pending&&riskReady(row)&&riskSpec(row)&&!riskMetrics.columns.complete?'Calculating…':'Not available'),'decision-risk-chip');chip.dataset.risk=level?.toLowerCase()||'unknown';chip.title='Chance of running out before arrival (or over lead time without an order). Low <10%; Medium 10–40%; High >40%. Model estimate, not a guarantee.';if(level)chip.setAttribute('aria-label',level+' risk');return chip
}
function paintRiskCell(cell,row,value){if(wl.mode==='simple')cell.replaceChildren(riskChip(row,value));else cell.textContent=value==null?(riskReady(row)?'…':'—'):riskPercent(value);const mobile=cell.closest('.work-row')?.querySelector('.work-phone-summary .decision-risk-chip');if(mobile)mobile.replaceWith(riskChip(row,value))}
function decisionToggle(id){const on=decisionDetail(),button=wlBtn(on?'Hide detail':'Show detail',()=>{const next=!decisionDetail();wlSetMode(next?decisionExpandedMode():'simple');if(productPage.overlay)drawProductPage(rowMap.get(selectedSku));else if(wl.drawer)selectItem(rowMap.get(selectedSku),{hash:false});document.getElementById(id)?.focus({preventScroll:true})},'decision-detail-toggle');button.id=id;button.setAttribute('aria-expanded',String(on));return button}
const decisionControlsBase=wlRenderControls
wlRenderControls=function(...args){decisionControlsBase(...args);wlSaved.prepend(decisionToggle('work-show-detail'))}
const decisionRowBase=wlRow,decisionWhyCache=new WeakMap()
function decisionWhy(row){const local=localOrderFor(row.item.sku);if(decisionBeyondView(row))return 'No order within the 6-month view. Replenishment date '+row.guidance.order_by+'.'+(local?' '+localOrderDisplay(local):'');let cached=decisionWhyCache.get(row);if(!cached||cached.settings!==settings||cached.today!==currentToday||cached.asof!==data.as_of){cached={settings,today:currentToday,asof:data.as_of,text:whyThisAmount(row.item,currentToday,settings,data.as_of)};decisionWhyCache.set(row,cached)}return cached.text+(local?' '+localOrderDisplay(local):'')}
function decisionBeyondView(row){const due=dateOrdinal(row.guidance.order_by);return due!=null&&due>monthEndOrdinal(monthAfter(data.as_of.slice(0,7),6))}
wlRow=function(row,...args){const element=decisionRowBase(row,...args),why='Why this amount: '+decisionWhy(row);const quantity=element.querySelector('[data-column=qty]');quantity?.setAttribute('title',why);if(quantity&&decisionBeyondView(row))quantity.textContent='—';const product=element.querySelector('.work-product');product?.setAttribute('aria-description',why);const phone=element.querySelector('.work-phone-summary');if(phone){phone.title=why;if(wl.mode==='simple'){const small=phone.querySelector('small');small.replaceChildren(node('span','On hand '+(row.item.on_hand==null?'Unknown':orderAmount(row.item.on_hand))+' '+row.item.unit),riskChip(row));phone.setAttribute('aria-description',why)}}return element}
// The full exact ledger remains the tooltip/accessibility description; the
// first glance is the engine's rate/lead/cover context, without raw decimals.
function decisionWhyLine(row){const text=decisionWhy(row),start=text.indexOf(' Sells ~');if(start<0)return text;const end=text.indexOf('. ',start),context=text.slice(start+1,end<0?-1:end),notes=end<0?'':text.slice(end+2);return context+' → order '+orderAmount(row.guidance.quantity)+' '+row.item.unit+'.'+(notes?' '+notes:'')}
const decisionDrawBase=drawProductPage
function decisionProduct(row){
 const overlay=productPage.overlay;if(!overlay||!row)return
 const on=decisionDetail(),wrap=overlay.querySelector('.product-page-content'),figures=wrap.querySelector('.product-page-figures'),header=wrap.querySelector('.product-page-heading');overlay.dataset.decisionDetail=String(on)
 if(decisionBeyondView(row)){figures.firstElementChild.querySelector('strong').textContent='—';figures.firstElementChild.querySelector('small').textContent='Beyond 6-month view'}
 const toggle=decisionToggle('product-show-detail');figures.after(toggle)
 for(const el of wrap.querySelectorAll('.product-page-chart,.product-ledger,.product-inputs,.product-risk,[data-forecast-method]:not([data-recommended-method])'))el.hidden=!on
 const runs=figures.lastElementChild;runs.hidden=!on
 const hand=node('div');hand.append(node('span','On hand'),node('strong',row.item.on_hand==null?'Unknown':orderAmount(row.item.on_hand)),node('small',row.item.unit));figures.prepend(hand)
 const result=productRisk(row),risk=node('p',null,'decision-product-risk');risk.append(node('span','Risk '),riskChip(row,result?.before??null,false));header.append(risk)
 const why=node('p','Why this amount: '+decisionWhyLine(row),'decision-why');why.title=decisionWhy(row);why.setAttribute('aria-description',decisionWhy(row));figures.after(why)
 const action=wrap.querySelector('.product-order-action');why.after(action)
 // Keep the existing chart and all advanced controls intact behind one toggle.
 if(on)wrap.querySelector('figure')?.drawChart()
}
drawProductPage=function(row){const overlay=productPage.overlay,scroll=overlay?.dataset.sku===row?.item.sku?overlay.scrollTop:0;decisionDrawBase(row);decisionProduct(row);if(overlay)overlay.scrollTop=scroll}
// Side panel retains the same decision-first disclosure as the full product page.
const decisionPanelBase=chartPanel
chartPanel=function(row){
 const panel=decisionPanelBase(row),section=panel.querySelector('.chart-section'),heading=panel.querySelector('.product-heading'),decision=panel.querySelector('.decision'),on=decisionDetail();if(section)section.hidden=!on
 const why=node('p','Why this amount: '+decisionWhyLine(row),'decision-why');why.title=decisionWhy(row);why.setAttribute('aria-description',decisionWhy(row));heading.after(why,decisionToggle('panel-show-detail'))
 if(!on){heading.after(decision);const dates=decision.querySelector('.dates');dates?.replaceChildren(stat('On hand',row.item.on_hand==null?'Unknown':orderAmount(row.item.on_hand)),stat('Order by',row.guidance.order_by==='now'?'Today':row.guidance.order_by?shortDate(row.guidance.order_by):'Not needed'));const risk=node('p',null,'decision-product-risk');risk.append(node('span','Risk '),riskChip(row,productRisk(row)?.before??null,false));heading.append(risk)}return panel
}
// Shelf-life presentation reads evaluated shared-core guidance, never recalculates caps.
function shelfBadge(row,detail=false){
 if(!row?.guidance.capped)return null
 const g=row.guidance,badge=node(detail?'p':'span','Shelf-life capped · '+orderAmount(g.shelf_cap_qty)+' '+row.item.unit+(detail?' ceiling. '+g.cap_reason:''),'shelf-capped');badge.dataset.shelfCapped='true';badge.title=g.cap_reason||'';return badge
}
function shelfClearanceSection(rows){
 const lots=rows.flatMap(({item,guidance})=>(guidance.expiring||[]).filter(lot=>lot.at_risk_qty>0).map(lot=>({sku:item.sku,name:item.name,unit:item.unit,...lot}))).sort((a,b)=>a.clear_by<b.clear_by?-1:a.clear_by>b.clear_by?1:0)
 if(!lots.length)return null
 const section=node('section',null,'shelf-clearance');section.dataset.clearanceList='true';section.setAttribute('aria-label','Get rid of by')
 section.append(node('h2','Get rid of by'),node('p','Commercial clearance estimate: consider discounting or returning these lots by the dates below. This is not a safety/compliance control.','product-note'))
 const list=node('ul');section.append(list)
 // Bound the initial DOM for large lot ledgers; every row stays reachable.
 let shown=0
 const more=wlBtn('Show next 100 lots',append)
 function append(){const end=Math.min(shown+100,lots.length);for(;shown<end;shown++){const lot=lots[shown],line=node('li',lot.name+' · '+lot.sku+' · lot '+lot.lot+' — '+lot.clear_by+' · '+orderAmount(lot.at_risk_qty)+' '+lot.unit+' at risk (expiry '+lot.expiry+')');line.dataset.clearanceSku=lot.sku;list.append(line)}more.hidden=shown===lots.length}
 section.append(more);append();return section
}
function shelfRenderClearance(){
 $('shelf-clearance')?.remove();const section=shelfClearanceSection(currentRows)
 if(section){section.id='shelf-clearance';section.prepend(node('p','All loaded products · independent of worklist filters.','product-note'));wlSummary.after(section)}
}
const shelfBuildList=buildList
buildList=function(...args){const result=shelfBuildList(...args);shelfRenderClearance();return result}
// Expiry interpretation/quantity warnings belong beside the decision, even in
// Simple mode. node() assigns textContent: imported text is never HTML.
function shelfWarnings(row){
 const warnings=row?.guidance.expiry_warnings||row?.item.expiry_warnings||[];if(!warnings.length)return null
 const box=node('section',null,'expiry-warnings');box.dataset.expiryWarnings='true';box.setAttribute('aria-label','Check expiry data')
 for(const text of warnings){const line=node('p',text,'warning');line.setAttribute('role','status');box.append(line)}return box
}
const shelfWorkRow=wlRow
wlRow=function(row,...args){const element=shelfWorkRow(row,...args),badge=shelfBadge(row),warnings=shelfWarnings(row);if(badge)element.querySelector('.work-sku')?.append(badge);if(warnings)element.querySelector('.work-product')?.append(warnings);return element}
const shelfDrawProduct=drawProductPage
drawProductPage=function(row){shelfDrawProduct(row);if(!row)return;const figures=productPage.overlay?.querySelector('.product-page-figures');if(!figures)return;const badge=shelfBadge(row,true),section=shelfClearanceSection([row]),warnings=shelfWarnings(row);if(section)figures.after(section);if(badge)figures.after(badge);if(warnings)figures.after(warnings)}
const shelfChartPanel=chartPanel
chartPanel=function(row){const panel=shelfChartPanel(row),badge=shelfBadge(row,true),section=shelfClearanceSection([row]),warnings=shelfWarnings(row);if(section)panel.append(section);if(badge)panel.prepend(badge);if(warnings)panel.prepend(warnings);return panel}
shelfRenderClearance()
// Match device preference on a fresh dataset; explicit saved views still win.
// Initial mode is chosen by wlRefresh for every dataset, not only at boot.
wlRenderControls();wlRenderRows();if(productPage.overlay)drawProductPage(rowMap.get(selectedSku))
