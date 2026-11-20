// Lifecycle: living. Display-only risk adapter; never changes stock, forecasts or orders.
// Load after product-page-gm-b.js. StockRunwayRisk is the shared deterministic model.
const riskCache=new WeakMap()
const riskMetrics=window.riskMetrics={computed:0,active_ms:0,last_product_ms:0,max_product_ms:0,columns:{total:0,processed:0,computed:0,withheld:0,active_ms:0,complete:false},errors:0}
function riskReady(row){return !!row?.item&&!!row.guidance&&!row.item._method_model&&!row.item.held&&!row.guidance.purchase_hold&&row.guidance.status!=='needs-data'&&row.bucket!=='needs-data'}
function riskDate(value){return typeof value==='string'&&value.length===10&&dateOrdinal(value)!==null?value:null}
function riskMonthEnd(month){const day=typeof month==='string'&&month.length===7?monthEndOrdinal(month):null;return day==null?null:ordinalDate(day)}
function riskSpec(row){
 if(!riskReady(row))return null
 const i=row.item,g=row.guidance,asof=riskDate(data.as_of),today=riskDate(currentToday),cutoff=today&&asof?(today>asof?today:asof):null
 const hand=Number.isFinite(i.on_hand)?i.on_hand:i.stock,orderDate=g.order_by==='now'?today:riskDate(g.order_by)||today
 const forecast=(i.projection||[]).map(r=>r.demand),history=(data.months||[]).flatMap((month,n)=>{const end=riskMonthEnd(month),value=i.monthly_sales?.[n];return end&&asof&&end<=asof&&Number.isFinite(value)&&value>=0?[value]:[]})
 if(!asof||!today||!cutoff||!orderDate||!Number.isFinite(hand)||!forecast.length||forecast.some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(g.lead_days)||g.lead_days<0)return null
 const facts=planningEventFacts(i,asof,today)
 // Reuse the planner's exact additive supply contract. Monthly totals follow
 // its start-of-month convention; on_order is separate, never subtracted.
 const receipts=datedSupply(i,asof,facts).map(r=>({date:ordinalDate(r.date),quantity:r.quantity}))
 const local=typeof localOrderFor==='function'?localOrderFor(i.sku):null
 if(local&&!(i.planning_facts?.incoming_pos||[]).some(po=>String(po.po_line_id||'').startsWith('local-device:'))&&local.unit===i.unit&&local.expected_on>=today)receipts.push({date:local.expected_on,quantity:local.qty})
 if(i.on_order>0)receipts.push({date:ordinalDate(dateOrdinal(today)+Math.ceil(g.lead_days)),quantity:i.on_order})
 receipts.sort((a,b)=>a.date.localeCompare(b.date))
 return {sku:i.sku,as_of:asof.slice(0,7),today:ordinalDate(dateOrdinal(asof)+1),history,forecast,on_hand:hand,on_order:0,receipts,order_by:orderDate,lead_days:g.lead_days,cover_months:settings.months_of_cover,quantity:Number.isFinite(g.quantity)?Math.max(0,g.quantity):0,receipt_history:i.receipt_history||[],...(Array.isArray(i.lead_multipliers)?{lead_multipliers:[...i.lead_multipliers]}:{})}
}
function productRisk(row,multiplier=1){
 if(!riskReady(row)||typeof StockRunwayRisk==='undefined'||typeof StockRunwayRisk.simulateRisk!=='function')return null
 const start=performance.now(),spec=riskSpec(row);if(!spec)return null
 const key=JSON.stringify(spec);let cache=riskCache.get(row)
 if(!cache||cache.key!==key){cache={key,values:new Map()};riskCache.set(row,cache)}
 if(cache.values.has(multiplier))return cache.values.get(multiplier)
 let result
 try{result=StockRunwayRisk.simulateRisk(spec,multiplier)}catch{riskMetrics.errors++;return null}
 // The shared API returns probabilities in [0,1], not rounded percentages.
 if(!result||![result.before,result.after].every(v=>Number.isFinite(v)&&v>=0&&v<=1))return null
 if(cache.values.size>=32)cache.values.clear();cache.values.set(multiplier,result)
 const ms=performance.now()-start;riskMetrics.computed++;riskMetrics.active_ms+=ms;riskMetrics.last_product_ms=ms;riskMetrics.max_product_ms=Math.max(riskMetrics.max_product_ms,ms)
 return result
}
function riskPercent(value){return Math.round(value*100)+'%'}
function riskCached(row){const entry=riskCache.get(row);return entry?.values.get(1)||null}

// Product report integration. The range is a scenario, not an editable purchase.
function productRiskPanel(row){
 if(!riskReady(row))return null
 const result=productRisk(row);if(!result)return null
 const section=node('section',null,'product-risk'),line=node('p',null,'product-risk-line'),control=node('div',null,'product-risk-control'),label=node('label','Order amount'),slider=node('input'),output=node('output'),note=node('p','Scenario only · suggested order stays unchanged.','product-risk-note')
 section.setAttribute('aria-label','Run-out risk scenario');section.dataset.sku=row.item.sku
 line.setAttribute('role','status');line.setAttribute('aria-live','polite');line.setAttribute('aria-atomic','true')
 slider.type='range';slider.id='product-risk-amount';slider.min='-50';slider.max='100';slider.step='5';slider.value='0';slider.tabIndex=0;label.htmlFor=slider.id;output.htmlFor=slider.id;slider.setAttribute('aria-describedby','product-risk-scenario-note');note.id='product-risk-scenario-note'
 const show=(risk,delta)=>{line.textContent=row.guidance.quantity>0?`Chance of running out: ${riskPercent(risk.before)} before the order arrives · ${riskPercent(risk.after)} after ordering`:`Chance of running out: ${riskPercent(risk.before)} over lead time · ${riskPercent(risk.after)} during cover (no new order)`;line.dataset.before=String(risk.before);line.dataset.after=String(risk.after);line.title='Model estimate from '+risk.paths+' simulated paths starting after the '+data.as_of+' stock snapshot; no new actuals assumed. Default lead spread and first-of-month dates for monthly receipts are scenario assumptions.'+(risk.thin_history?' · limited sales history':'');section.dataset.paths=String(risk.paths);output.value=(delta>0?'+':delta<0?'−':'')+Math.abs(delta)+'%';slider.setAttribute('aria-valuetext',delta===0?'Suggested order amount, unchanged':Math.abs(delta)+'% '+(delta<0?'less':'more')+' than suggested')}
 let timer=0
 const update=()=>{clearTimeout(timer);const delta=Number(slider.value),risk=productRisk(row,1+delta/100);if(risk)show(risk,delta)}
 slider.addEventListener('input',()=>{const delta=Number(slider.value);output.value=(delta>0?'+':delta<0?'−':'')+Math.abs(delta)+'%';slider.setAttribute('aria-valuetext',delta===0?'Suggested order amount, unchanged':Math.abs(delta)+'% '+(delta<0?'less':'more')+' than suggested');clearTimeout(timer);timer=setTimeout(()=>{if(section.isConnected)update()},16)})
 slider.addEventListener('change',update)
 // The report's generic trap excludes native inputs; include this native range
 // explicitly so Tab and Shift+Tab can never escape the modal at a boundary.
 slider.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const controls=[...productPage.overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(el=>el.checkVisibility()),index=controls.indexOf(slider);if(e.shiftKey&&index===0||!e.shiftKey&&index===controls.length-1){e.preventDefault();controls[e.shiftKey?controls.length-1:0]?.focus()}})
 show(result,0);control.append(label,slider,output);section.append(line);if(row.guidance.quantity>0)section.append(control,note)
 const details=node('details',null,'risk-assumptions'),summary=node('summary','Model assumptions');details.append(summary,node('p','Display only · not a calibrated guarantee. Starts with the '+data.as_of+' stock snapshot, not a new stock count. Three-month blocks of this product’s sales are scaled to each forecast month; seasonality, trend and stock-out zeros may exaggerate or understate risk. Missing lead evidence uses assumed multipliers 0.9–1.5. Monthly receipts use the planner’s first-of-month convention; undated incoming is assumed at nominal lead time. Cover uses 30 days per month. No backorders are carried after stock reaches zero.','product-risk-note'));section.append(details);return section
}
const riskDrawProductBase=drawProductPage
drawProductPage=function(row){riskDrawProductBase(row);const chart=productPage.overlay?.querySelector('.product-page-chart');if(chart){const panel=productRiskPanel(row);if(panel)chart.before(panel)}}

// Risk is a chip in Simple and a percentage in detail; never run simulations inside
// layout, row painting or a sort comparator. Idle batches measure active work
// separately from intentional idle time and stop when their snapshot changes.
WL_NUMERIC.push('risk')
if(!wl.columns.includes('risk')&&['simple','detailed'].includes(wl.mode))wl.columns.push('risk')
// Earlier adapters normalize saved views before this late-loaded column exists.
// Recover only this column's preferences, never reset filters or product state.
try{
 const params=new URLSearchParams(gmBInitialHash.slice(1)),saved=params.has('state')?JSON.parse((params.get('state')||'{}').slice(0,65536)):wlReadStorage()
 if(wl.mode==='custom'&&Array.isArray(saved.columns)&&saved.columns.includes('risk'))wl.columns=wlNormalize(saved.columns)
 for(const key of ['customColumns','customOrder'])if(Array.isArray(saved[key])&&saved[key].includes('risk'))wl[key]=wlNormalize(saved[key])
 if(saved.sort==='risk')wl.sort='risk'
}catch{/* Invalid saved view stays with the worklist's existing recovery. */}
const riskWlValueBase=wlValue
wlValue=function(row,key){return key==='risk'?(riskReady(row)?riskCached(row)?.before??null:null):riskWlValueBase(row,key)}
const riskWlRowBase=wlRow
wlRow=function(row,...args){const element=riskWlRowBase(row,...args),cell=element.querySelector('[data-column=risk]');if(cell){const value=wlValue(row,'risk');cell.classList.add('numeric');paintRiskCell(cell,row,value);cell.title=riskReady(row)?'Modelled chance of running out before the suggested order arrives. Not a guarantee.':'Risk withheld: check product data.'}return element}
let riskColumnJob=null,riskColumnToken=0
function riskScheduleColumns(){
 const enabled=wl.columns.includes('risk')&&typeof StockRunwayRisk!=='undefined'
 if(!enabled){if(riskColumnJob){riskColumnJob=null;riskColumnToken++}return}
 const context=[currentRows,data,settings,currentToday,typeof localOrders==='undefined'?null:localOrders.records]
 if(riskColumnJob&&context.every((v,k)=>riskColumnJob.context[k]===v))return
 const token=++riskColumnToken,job=riskColumnJob={context,index:0,rows:currentRows.slice()},metrics=riskMetrics.columns={total:currentRows.length,processed:0,computed:0,withheld:0,active_ms:0,complete:false}
 const defer=fn=>typeof requestIdleCallback==='function'?requestIdleCallback(fn,{timeout:150}):setTimeout(()=>fn({timeRemaining:()=>8}),16)
 const batch=deadline=>{
  if(token!==riskColumnToken)return
  const start=performance.now();let count=0
  while(job.index<job.rows.length&&(count===0||performance.now()-start<8&&deadline.timeRemaining()>1)){
   const row=job.rows[job.index++],result=productRisk(row);metrics.processed++;if(result)metrics.computed++;else metrics.withheld++;count++
  }
  metrics.active_ms+=performance.now()-start
  // Update mounted risk text in place: idle work must not detach a focused
  // or pointer-targeted product row while the user is interacting with it.
  for(const element of wlScroll.querySelectorAll('.work-row[data-sku]')){
   const row=rowMap.get(element.dataset.sku),cell=element.querySelector('[data-column=risk]');if(!row||!cell)continue
   const value=wlValue(row,'risk');paintRiskCell(cell,row,value)
  }
  if(job.index<job.rows.length)defer(batch)
  else{metrics.complete=true;if(wl.sort==='risk')buildList({controls:false})}
 }
 defer(batch)
}
const riskWlLayoutBase=wlLayout
wlLayout=function(...args){const result=riskWlLayoutBase(...args);riskScheduleColumns();return result}
// Deep links can have mounted the report before this additive adapter loaded.
if(productPage.overlay)drawProductPage(rowMap.get(selectedSku))
wlLayout();wlRenderRows()
