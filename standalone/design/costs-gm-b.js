// Display-only valuation adapter. Every string enters the DOM as text.
const COST_COLUMNS=[['money_tied_up','Money tied up',140],['incoming_value','Incoming value',168],['margin_unit','Margin / unit',128],['margin_pct','Margin %',112],['lost_profit_est','Lost profit estimate',168],['expiry_value_at_risk','Expiry value at risk',168],['money_cover_weeks','Weeks cover (money)',160]]
for(const column of COST_COLUMNS){wlColumns.push(column);WL_NUMERIC.push(column[0])}
const costCache=new WeakMap()
function costForRow(row){
 const risk=typeof riskCached==='function'?riskCached(row):null,old=costCache.get(row);
 if(old&&old.risk===risk)return old.value;
 const item={...row.item,unit_cost:resolveOrderSettings(row.item,settings).values.unit_cost};let guidance=row.guidance;
 if(Number.isFinite(item.on_order)&&item.on_order>=0){const facts=planningEventFacts(item,data.as_of,currentToday);guidance={...guidance,incoming_qty:item.on_order+datedSupply(item,data.as_of,facts).filter(r=>r.date>dateOrdinal(data.as_of)).reduce((n,r)=>n+r.quantity,0)}}
 const value=StockRunwayCosts.costMetrics(item,guidance,risk);
 costCache.set(row,{risk,value});return value;
}
function costText(key,value){if(!Number.isFinite(value))return '—';return key==='margin_pct'?value.toLocaleString('en-US',{maximumFractionDigits:1})+'%':key==='money_cover_weeks'?value.toLocaleString('en-US',{maximumFractionDigits:1})+' wk':(typeof settings.currency==='string'&&settings.currency?settings.currency+' ':'')+value.toLocaleString('en-US',{maximumFractionDigits:2})}
function costRenderTotals(){
 let section=$('cost-totals');if(!section){section=node('section',null,'cost-totals');section.id='cost-totals';section.setAttribute('aria-label','Cost and profit totals');wlSummary.after(section)}
 // Totals describe the whole loaded snapshot, not only mounted/filtered rows.
 const metrics=currentRows.map(costForRow),total=StockRunwayCosts.costTotals(metrics);section.replaceChildren();
 const labels=[['money_tied_up','Money tied up'],['incoming_value','Incoming value'],['order_value','Order value (all suggestions)'],['margin_pct','Stock-weighted margin'],['lost_profit_est','Lost profit estimate'],['expiry_value_at_risk','Expiry value at risk'],['money_cover_weeks','Weeks of cover in money']];
 for(const [key,label]of labels){if(!Number.isFinite(total[key]))continue;const card=node('div');card.append(node('span',label),node('strong',costText(key,total[key])));const count=key==='margin_pct'?total.coverage.stock_sale_value:key==='money_cover_weeks'?total.coverage.money_cover_weeks:total.coverage[key];if(count<total.count)card.append(node('small','Known for '+count+' / '+total.count+' products'));section.append(card)}
 section.hidden=!section.children.length;if(section.children.length)section.append(node('p','All loaded products · same currency only; no conversion. Estimates, not guarantees. Unknown inputs are excluded, not zero.','product-note'));
}
function costProductPanel(row){
 const metrics=costForRow(row);if(!Object.keys(metrics).length)return null;
 const section=node('section',null,'product-costs');section.dataset.costDetail=row.item.sku;section.append(node('h2','Cost & profit'));
 const grid=node('div',null,'cost-grid');for(const [key,label]of [['money_tied_up','Money tied up'],['incoming_value','Incoming value'],['order_value','Order value'],['margin_unit','Margin per unit'],['margin_pct','Margin %'],['lost_profit_est','Lost profit estimate'],['expiry_value_at_risk','Expiry value at risk'],['money_cover_weeks','Weeks of cover in money']])if(Number.isFinite(metrics[key])){const cell=node('div');cell.append(node('span',label),node('strong',costText(key,metrics[key])));grid.append(cell)}
 section.append(grid,node('p','Display only. Margin excludes tax, fees and overhead. Lost profit estimate = average unmet units before arrival across the existing 1,000 risk paths × positive unit margin. No valid risk output: estimate omitted. Expiry uses supplied at-risk quantity only.','product-note'));return section;
}
const costWlValue=wlValue;wlValue=function(row,key){return COST_COLUMNS.some(c=>c[0]===key)?costForRow(row)[key]??null:costWlValue(row,key)};
const costWlRow=wlRow;wlRow=function(row,...args){const element=costWlRow(row,...args);for(const [key]of COST_COLUMNS){const cell=element.querySelector('[data-column="'+key+'"]');if(cell){cell.textContent=costText(key,costForRow(row)[key]);cell.classList.add('numeric')}}return element};
const costControls=wlRenderControls;wlRenderControls=function(...args){const result=costControls(...args);costRenderTotals();return result};
const costDraw=drawProductPage;drawProductPage=function(row){costDraw(row);const panel=costProductPanel(row);if(panel)productPage.overlay?.querySelector('.product-page-chart')?.before(panel)};
const costSelect=selectItem;selectItem=function(...args){const result=costSelect(...args),row=args[0];$('main')?.querySelector('.product-costs')?.remove();if(row){const panel=costProductPanel(row);if(panel)$('main')?.append(panel)}return result};
// Restore only newly added custom columns; never change Simple or Detailed defaults.
try{const params=new URLSearchParams(gmBInitialHash.slice(1)),saved=params.has('state')?JSON.parse((params.get('state')||'{}').slice(0,65536)):wlReadStorage();if(wl.mode==='custom'&&saved.columns?.some(k=>COST_COLUMNS.some(c=>c[0]===k)))wl.columns=wlNormalize(saved.columns);for(const key of ['customColumns','customOrder'])if(Array.isArray(saved[key]))wl[key]=wlNormalize([...saved[key],...(key==='customOrder'?wlColumns.map(c=>c[0]):[])]);if(COST_COLUMNS.some(c=>c[0]===saved.sort))wl.sort=saved.sort}catch{/* Existing recovery handles malformed saved settings. */}
// Idle risk fills an already displayed model; refresh amounts without rebuilding rows.
let costRiskComputed=-1;setInterval(()=>{if(costRiskComputed===riskMetrics.computed)return;costRiskComputed=riskMetrics.computed;costRenderTotals();for(const element of wlScroll.querySelectorAll('.work-row[data-sku]')){const row=rowMap.get(element.dataset.sku);if(row)for(const [key]of COST_COLUMNS){const cell=element.querySelector('[data-column="'+key+'"]');if(cell)cell.textContent=costText(key,costForRow(row)[key])}}},500);
costRenderTotals();
