// Lifecycle: living. Arctic large-chart presentation only; one unchanged monthly series.
const chartFocus={overlay:null,figure:null,home:null,trigger:null,inert:[]}
function chartKeyline(row){
 const {item:i,guidance:g}=row
 const local=localOrderFor(i.sku)
 if(local)return localOrderDisplay(local)+' · '+(g.runout_date?`Runs out ${shortDate(g.runout_date)}`:'Runs out: not forecast')
 const order=g.quantity>0?`Order ${orderAmount(g.quantity)} ${i.unit} by ${g.order_by==='now'?'Today':g.order_by?gmDate(g.order_by):'not set'}`:g.status==='needs-data'?'Check product data':'No order needed'
 const out=g.runout_date?`Runs out ${shortDate(g.runout_date)}`:'Runs out: not forecast'
 const date=g.order_by==='now'?currentToday:g.order_by,day=dateOrdinal(date),arrival=g.quantity>0&&day!==null&&Number.isFinite(g.lead_days)?ordinalDate(day+g.lead_days):null
 const incoming=arrival?`Suggested arrival ${shortDate(arrival)}${g.used_default_lead?' (assumed)':''}`:g.delivery_date?`Confirmed arrival ${gmDate(g.delivery_date)}`:'No dated arrival'
 return `${order} · ${out} · ${incoming}`
}
const largePanelBase=chartPanel
chartPanel=function(row){
 const panel=largePanelBase(row),heading=panel.querySelector('.product-heading'),section=panel.querySelector('.chart-section'),card=panel.querySelector('.chart-card')
 heading.querySelector('h1').classList.add('detail-product-name')
 heading.append(node('p',chartKeyline(row),'chart-keyline'))
 // Keep quantity/why, status, dates, settings and provenance below the chart.
 panel.prepend(heading);heading.after(section)
 card.after(panel.querySelector('.decision'))
 const meta=heading.querySelector('.product-meta');if(meta)card.after(meta)
 const pill=panel.querySelector(':scope>.pill');if(pill)section.append(pill)
 return panel
}
// A counterfactual display path, never written into item.projection or guidance.
function suggestedOrderScenario(row,series){
 const g=row?.guidance;if(!(g?.quantity>0)||!Number.isFinite(g.lead_days)||g.lead_days<0||!series.rows.length)return null
 const orderDate=g.order_by==='now'?currentToday:g.order_by,orderDay=dateOrdinal(orderDate)
 if(orderDay===null)return null
 const arrivalDate=ordinalDate(orderDay+g.lead_days),arrivalDay=dateOrdinal(arrivalDate),n=series.n
 const time=date=>{const month=date.slice(0,7),[year,m]=month.split('-').map(Number),first=dateOrdinal(month+'-01'),days=new Date(Date.UTC(year,m,0)).getUTCDate();return n+(year-Number(data.as_of.slice(0,4)))*12+m-Number(data.as_of.slice(5,7))-1+(dateOrdinal(date)-first)/days}
 const orderT=time(orderDate),arrivalT=time(arrivalDate),raw=[{t:n,stock:row.item.stock},...series.rows.map((r,k)=>({t:n+k+1,stock:r.stock}))]
 const floor=points=>{const out=[];for(const [k,p]of points.entries()){const prev=points[k-1];if(prev&&prev.stock*p.stock<0){const t=prev.t+(p.t-prev.t)*prev.stock/(prev.stock-p.stock);out.push({t,stock:0})}out.push({t:p.t,stock:Math.max(0,p.stock)})}return out}
 const baseline=floor(raw)
 if(arrivalDay===null||arrivalT<n||arrivalT>n+series.rows.length)return {orderDate,arrivalDate,orderT,arrivalT,baseline,points:[],before:null,after:null}
 // Reuse the chart's exact straight monthly stock segments (demand minus receipts),
 // not a new average demand model. Keep its zero floor; do not invent backorders.
 const a=raw[Math.min(raw.length-2,Math.max(0,Math.floor(arrivalT-n)))],b=raw[raw.indexOf(a)+1],rawArrival=a.stock+(b.stock-a.stock)*(arrivalT-a.t)/(b.t-a.t),before=Math.max(0,rawArrival),after=before+g.quantity
 const initial=[...raw.filter(p=>p.t<arrivalT),{t:arrivalT,stock:rawArrival}],future=[{t:arrivalT,stock:after},...raw.filter(p=>p.t>arrivalT).map(p=>({t:p.t,stock:after+p.stock-rawArrival}))]
 return {orderDate,arrivalDate,orderT,arrivalT,before,after,baseline,points:[...floor(initial),...floor(future)]}
}
// Show the policy threshold even when no purchase is suggested. The band is
// a quiet, clipped reference, not a new demand/supply or safety calculation.
function drawSafetyStock(c,row){
 const safety=row?.guidance?.safety_stock
 if(!Number.isFinite(safety)||safety<0)return
 const {svg,left,right,top,bottom,y}=c,sy=y(safety)
 if(!Number.isFinite(sy)||sy<top||sy>bottom)return
 const bandTop=Math.max(top,sy-5),bandBottom=Math.min(bottom,sy+5),ly=top-6
 svg.prepend(svgNode('rect',{'data-safety-band':true,x:left,y:bandTop,width:right-left,height:bandBottom-bandTop,fill:'var(--accent)',opacity:.13,'pointer-events':'none'}))
 svg.append(svgNode('line',{'data-safety-stock':safety,x1:left,x2:right,y1:sy,y2:sy,stroke:'var(--accent)','stroke-width':1,'stroke-dasharray':'3 5',opacity:.65,'pointer-events':'none'}))
 svg.append(svgNode('rect',{x:right-84,y:ly-12,width:84,height:16,fill:'var(--bg)',opacity:.95,'pointer-events':'none'}))
 svg.append(svgNode('line',{'data-safety-key':true,x1:right-108,x2:right-90,y1:ly-4,y2:ly-4,stroke:'var(--accent)','stroke-dasharray':'3 5',opacity:.65}))
 svg.append(svgNode('text',{'data-safety-label':true,x:right-4,y:ly,'text-anchor':'end',fill:'var(--muted)','font-size':12,class:'order-graph-label'},'Safety stock'))
}
function drawSuggestedOrder(c,row,scenario){
 if(!scenario)return
 const {svg,left,right,top,bottom,x,y,view}=c,g=row.guidance,add=(tag,attrs,text)=>{const el=svgNode(tag,attrs,text);svg.append(el);return el},visible=t=>t>=view.start&&t<=view.end
 const runout=svg.querySelector('[data-runout]'),leader=svg.querySelector('[data-runout-leader]');if(runout&&leader){leader.setAttribute('d',`M${runout.getAttribute('cx')},${top}V${bottom-5}`);leader.setAttribute('stroke-dasharray','3 5');leader.setAttribute('opacity','.55')}
 const label=(key,t,text,py)=>{if(!visible(t))return;const cx=x(t),half=text.length*3.1,tx=Math.max(left+half,Math.min(right-half,cx));add('line',{[key]:true,x1:cx,x2:cx,y1:top,y2:bottom,stroke:'var(--accent)','stroke-width':1,'stroke-dasharray':'3 4',opacity:.65});add('text',{[key+'-label']:true,x:tx,y:py,'text-anchor':'middle',fill:'var(--accent)','font-size':12,class:'order-graph-label'},text)}
 // Separate two quiet rows above all plot marks, below Today/run-out labels.
 label('data-order-by',scenario.orderT,g.order_by==='now'?'Order today':'Order by '+shortDate(scenario.orderDate),top-46)
 label('data-suggested-arrival',scenario.arrivalT,'Arrives '+shortDate(scenario.arrivalDate)+(g.used_default_lead?' (assumed)':''),top-26)

 const path=points=>{const segments=[];for(let k=1;k<points.length;k++){const a=points[k-1],b=points[k];if(b.t<view.start||a.t>view.end)continue;const at=t=>({t,stock:a.stock+(b.stock-a.stock)*(t-a.t)/(b.t-a.t)}),p=a.t===b.t?a:at(Math.max(view.start,a.t)),q=a.t===b.t?b:at(Math.min(view.end,b.t));segments.push(`M${x(p.t)},${y(p.stock)}L${x(q.t)},${y(q.stock)}`)}return segments.join(' ')}
 add('path',{'data-if-order':true,d:path(scenario.points),fill:'none',stroke:'var(--accent)','stroke-width':2.5,'stroke-dasharray':'6 4','data-arrival-before':scenario.before,'data-arrival-after':scenario.after,'data-quantity':g.quantity,'aria-label':'If you order: '+orderAmount(g.quantity)+' '+row.item.unit+' arriving '+scenario.arrivalDate+(g.used_default_lead?' using assumed lead time':'')})
 if(visible(scenario.arrivalT)&&scenario.after!==null)add('circle',{'data-order-jump':true,cx:x(scenario.arrivalT),cy:y(scenario.after),r:4,fill:'var(--bg)',stroke:'var(--accent)','stroke-width':2})
 svg.querySelector('[data-inventory-line]')?.setAttribute('aria-label',"If you don't order");svg.querySelector('[data-inventory-line]')?.removeAttribute('stroke-dasharray')
}
// Demand uncertainty belongs around the unchanged monthly demand forecast, not
// around the stock balance. Memoized per evaluated item; no new observations.
const forecastCloudCache=new WeakMap()
function forecastCloud(item){
 if(item.held||item._method_model||!item.projection?.length)return null
 if(forecastCloudCache.has(item))return forecastCloudCache.get(item)
 let result=null
 try{
  const last=data.as_of.slice(0,7),base=baseAdoptedDemandHistory(item,last),history=base.adjusted??base.after_projects??base.corrected??item.monthly_sales
  const selected=forecastSelection(item,last,base),adopted=selected.adopted===true
  // Committed-order additions have no comparable own one-step error history.
  const committed=(item.planning_facts?.customer_orders||[]).some(o=>o.remaining_qty>0)
  if(!committed){
   const method=adopted?selected.method:(base.eligible??[true]).every(Boolean)?'champion':'baseline'
   const errors=adopted?selected.folds.map(f=>Math.abs(f.errors[0])):null
   const own=history.filter((_,k)=>base.eligible?.[k]!==false)
   result=StockRunwayRisk.predictionBands(own,item.projection.map(r=>r.demand),method,last,errors)
  }
 }catch{/* Context-dependent/unsafe estimates stay absent rather than fabricated. */}
 forecastCloudCache.set(item,result);return result
}
function cloudRange(b){return `${orderAmount(Math.round(b.lo50))}–${orderAmount(Math.round(b.hi50))}`}
function cloudTooltip(b){return `Expected ${orderAmount(Math.round(b.p50))} · likely ${cloudRange(b)} · wide ${orderAmount(Math.round(b.lo90))}–${orderAmount(Math.round(b.hi90))}`}
function drawForecastCloud(c,item,cloud){
 if(!cloud)return
 const {svg,x,y,n,view}=c,points=cloud.bands.map((b,k)=>({...b,t:n+k+.5})).filter(b=>b.t+.5>=view.start&&b.t-.5<=view.end)
 if(!points.length)return
 // Flat half-month ends keep even a one-month band visible at narrow zoom.
 const all=[{...points[0],t:Math.max(view.start,points[0].t-.5)},...points,{...points.at(-1),t:Math.min(view.end,points.at(-1).t+.5)}]
 const layer=svgNode('g',{'data-forecast-cloud':true,'pointer-events':'none','aria-label':'Demand prediction ranges: 50% likely, 90% wide'+(cloud.thin_history?' · thin history':'')})
 for(const [level,opacity]of [[90,.14],[50,.30]]){
  const d=all.map((b,k)=>`${k?'L':'M'}${x(b.t)},${y(b['hi'+level])}`).join(' ')+all.slice().reverse().map(b=>`L${x(b.t)},${y(b['lo'+level])}`).join(' ')+'Z'
  layer.append(svgNode('path',{'data-prediction-band':level,d,fill:'var(--accent)',opacity}))
 }
 layer.append(svgNode('path',{'data-demand-forecast-line':true,d:all.map((b,k)=>`${k?'L':'M'}${x(b.t)},${y(b.p50)}`).join(' '),fill:'none',stroke:'var(--accent)','stroke-width':1.6}))
 const first=svg.querySelector('[data-period]');if(first)first.before(layer);else svg.append(layer)
}
function declutterChartLabels(c){
 const {svg,left,right,top}=c,lanes=[]
 // Receipt amounts remain exact on hover/tap; none compete with the data paths.
 svg.querySelectorAll('[data-gm-receipt-label],[data-gm-leader]').forEach(e=>e.remove())
 const selectors=['[data-today-label]','[data-runout-label]','[data-order-by-label]','[data-suggested-arrival-label]']
 for(const selector of selectors){
  const el=svg.querySelector(selector);if(!el)continue
  const half=Math.min((right-left)/2,el.textContent.length*3.2),cx=Math.max(left+half,Math.min(right-half,Number(el.getAttribute('x'))))
  let lane=0;while(lanes[lane]?.some(b=>cx-half<b[1]+8&&cx+half+8>b[0]))lane++
  ;(lanes[lane]||= []).push([cx-half,cx+half]);el.setAttribute('x',cx);el.setAttribute('y',12+lane*18);el.setAttribute('font-size',12)
 }
 for(const el of svg.querySelectorAll('text'))el.setAttribute('font-size',Math.min(12,Number(el.getAttribute('font-size'))||12))
}
const largeSvgBase=inventorySvg
inventorySvg=function(...args){
 const row=rowMap.get(args[0].sku),series=args[4]||seriesFor(args[0]),scenario=suggestedOrderScenario(row,series),view=args[3]||a2Window(series.slots,series.n)
 const safety=row?.guidance?.safety_stock,cloud=forecastCloud(args[0]),bandPeak=Math.max(0,...(cloud?.bands||[]).filter((_,k)=>series.n+k+.5>=view.start&&series.n+k+.5<=view.end).map(b=>b.hi90))
 if(scenario||cloud||Number.isFinite(safety)&&safety>=0){const values=(scenario?.points||[]).filter(p=>p.t>=view.start-1&&p.t<=view.end+1).map(p=>p.stock);args[4]={...series,orderDisplayPeak:Math.max(bandPeak,Number.isFinite(safety)?safety:0,...values)*1.08}}
 const c=largeSvgBase(...args),{svg,left,right,top,bottom,x,n}=c
 const add=(tag,attrs,text)=>svgNode(tag,attrs,text)
 // Fill the exact existing clipped stock paths; no new observations/interpolation.
 const shadeStart=svg.querySelector('[data-now-divider]')?.getAttribute('x1')
 if(shadeStart!=null){const start=Math.max(left,Math.min(right,Number(shadeStart)));svg.prepend(add('rect',{'data-forecast-shade':true,x:start,y:top,width:right-start,height:bottom-top,fill:'var(--accent)',opacity:.04,'pointer-events':'none'}))}
 for(const p of svg.querySelectorAll('[data-inventory-past],[data-inventory-line]')){
  const d=p.getAttribute('d')||''
  const area=d.replace(/M([-\d.e+]+),([-\d.e+]+)L([-\d.e+]+),([-\d.e+]+)/g,(_,ax,ay,bx,by)=>`M${ax},${bottom}L${ax},${ay}L${bx},${by}L${bx},${bottom}Z`)
  p.before(add('path',{'data-stock-area':true,d:area,fill:'var(--accent)',opacity:.12,'pointer-events':'none'}))
  p.setAttribute('stroke-width','2.5')
 }
 const runout=svg.querySelector('[data-runout]');if(runout){
  runout.setAttribute('r','6');runout.setAttribute('stroke','var(--bg)');runout.setAttribute('stroke-width','2')
  // Anchor the direct label near its own event rather than across the forecast.
  const label=svg.querySelector('[data-runout-label]'),leader=svg.querySelector('[data-runout-leader]')
  if(label&&leader&&right-left>500){const cx=Number(runout.getAttribute('cx')),half=label.textContent.length*3.6,tx=Math.max(left+half,Math.min(right-half,cx+half+16)),ty=svg.querySelector('[data-today-label]')&&Math.abs(tx-Number(svg.querySelector('[data-today-label]').getAttribute('x')))<half+32?32:Number(label.getAttribute('y'));label.setAttribute('y',ty);label.setAttribute('x',tx);leader.setAttribute('d',`M${tx},${ty+4}V${top-8}H${cx}V${bottom-5}`)}
 }
 // Compact key remains when an end label would collide with a bar/receipt.
 drawForecastCloud(c,args[0],cloud)
 drawSuggestedOrder(c,row,scenario)
 drawSafetyStock(c,row)
 declutterChartLabels(c)
 return c
}
const largeChartBase=fullChart
fullChart=function(row){
 const figure=largeChartBase(row),wrap=figure.querySelector('.chart-wrap'),toolbar=figure.querySelector('.chart-toolbar'),tip=figure.querySelector('.chart-tooltip'),series=seriesFor(row.item)
 figure.classList.add('large-chart');figure.chartRow=row
 if(row.guidance.quantity>0){const legend=figure.querySelector('.legend');legend.classList.add('order-legend');legend.replaceChildren(...[["If you don't order",'stock'],['If you order','forecast'],['Sales','demand']].map(([text,cls])=>{const span=node('span',text);span.prepend(node('i',null,cls));return span}))}
 const legend=figure.querySelector('.legend');legend.tabIndex=0;legend.setAttribute('role','region');legend.setAttribute('aria-label','Chart legend; scroll horizontally for all keys')
 for(const [text,cls]of [...(forecastCloud(row.item)?[['50 / 90% cloud','cloud-key']]:[]),['Stock-out month','hatched-key']]){const entry=node('span',text);entry.prepend(node('i',null,cls));legend.append(entry)}
 if(!forecastCloud(row.item)){legend.append(node('small','Range unavailable','cloud-history-note'))}
 if(forecastCloud(row.item)?.thin_history){const note=node('small','thin history','cloud-history-note');legend.append(note)}
 const expand=wlBtn('⤢',()=>openChartFocus(figure),'chart-expand');expand.setAttribute('aria-label','Expand chart');expand.title='Expand chart · F';toolbar.append(expand)
 // Tooltip uses only the same monthly history/projection already plotted.
 const show=(i,receipt=false)=>{
  const r=series.timeline[i];if(!r)return
  const stock=i<series.n?series.history.rows[i]?.stock:Math.max(0,series.rows[i-series.n].stock)
  tip.replaceChildren(node('strong',label(r.month)),node('span',`${r.past?'Demand (actual)':'Demand (forecast)'} ${orderAmount(Math.round(r.demand))} ${row.item.unit}`),node('span',`Stock ${stock==null?STRINGS.unknown:orderAmount(Math.round(stock))+' '+row.item.unit+(stock<=0?' · out':'')}`),node('span',`${r.past?'Received':'Expected receipts'} ${orderAmount(r.receipts||0)} ${row.item.unit}`))
  const band=i>=series.n?forecastCloud(row.item)?.bands[i-series.n]:null
  if(band)tip.append(node('span',cloudTooltip(band),'cloud-tooltip'))
  if(receipt||r.receipts)tip.append(node('span','Monthly total; exact date unavailable','precision'))
  tip.dataset.tooltipIndex=String(i);tip.hidden=false
  const svg=wrap.querySelector('svg'),bar=svg?.querySelector(`[data-period][data-month="${r.month}"]`)
  svg?.querySelector('[data-crosshair]')?.remove()
  if(bar){const cx=Number(bar.getAttribute('x'))+Number(bar.getAttribute('width'))/2,lines=[...svg.querySelectorAll('[data-gridline]')],ys=lines.map(l=>Number(l.getAttribute('y1')));svg.append(svgNode('line',{'data-crosshair':true,x1:cx,x2:cx,y1:Math.min(...ys),y2:Math.max(...ys),stroke:'var(--accent)','stroke-width':1,'stroke-dasharray':'3 3','pointer-events':'none'}))}
 }
 const point=e=>{
  const svg=wrap.querySelector('svg');if(!svg)return
  const receipt=e.target.closest('[data-delivery-marker]')
  if(receipt){show(series.timeline.findIndex(r=>r.month===receipt.dataset.month),true);return}
  const pos=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()),grids=[...svg.querySelectorAll('[data-gridline]')]
  if(!grids.length)return
  const left=Number(grids[0].getAttribute('x1')),right=Number(grids[0].getAttribute('x2')),ys=grids.map(l=>Number(l.getAttribute('y1')))
  if(pos.x<left||pos.x>right||pos.y<Math.min(...ys)||pos.y>Math.max(...ys))return
  const first=Number(svg.dataset.windowStart),count=Number(svg.dataset.visibleMonths)
  show(Math.min(first+count-1,Math.max(first,Math.floor(first+(pos.x-left)/(right-left)*count))))
 }
 wrap.addEventListener('pointermove',e=>{if(e.pointerType!=='touch')point(e)})
 // Touch pointerleave follows pointerup even when the finger has not moved.
 // Keep the tapped month pinned until redraw, another tap, or Escape.
 wrap.addEventListener('pointerleave',e=>{if(e.pointerType==='touch')return;tip.hidden=true;wrap.querySelector('[data-crosshair]')?.remove()})
 // Own marker activation before the legacy marker's shorter delivery-only tip.
 wrap.addEventListener('click',e=>{if(e.target.closest('[data-delivery-marker]')){e.stopImmediatePropagation();point(e)}},true)
 wrap.addEventListener('keydown',e=>{if(e.target.closest('[data-delivery-marker]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();point(e)}},true)
 wrap.addEventListener('pointerup',e=>{if(e.pointerType==='touch')point(e)})
 wrap.addEventListener('click',e=>{if(e.pointerType==='touch'||chartFocus.overlay){point(e);return}if(e.target.closest('[data-delivery-marker]'))return;openChartFocus(figure)})
 for(const event of ['pointerover','focusin'])wrap.addEventListener(event,e=>{const marker=e.target.closest('[data-delivery-marker]');if(marker)show(series.timeline.findIndex(r=>r.month===marker.dataset.month),true)})
 return figure
}
function closeChartFocus({restore=true}={}){
 if(!chartFocus.overlay)return
 const {figure,home,overlay,trigger}=chartFocus
 if(home?.isConnected)home.append(figure)
 overlay.remove();chartFocus.overlay=null;chartFocus.figure=null
 for(const [el,value]of chartFocus.inert)el.inert=value
 chartFocus.inert=[];document.body.classList.remove('chart-focused')
 figure.drawChart();if(restore)trigger?.focus({preventScroll:true})
}
// The shared chart also navigates on native swipes. Keep every navigation
// entrypoint bound to the same selected product and the one mounted figure.
const focusNavigateBase=navigateSku
navigateSku=function(delta){
 if(!chartFocus.overlay)return focusNavigateBase(delta)
 closeChartFocus({restore:false});focusNavigateBase(delta);openChartFocus(document.querySelector('.product-page figure')||$('hero').querySelector('figure'))
}
function openChartFocus(figure){
 if(chartFocus.overlay||document.querySelector('dialog[open]')||!figure?.isConnected)return
 const row=figure.chartRow,overlay=node('section',null,'chart-focus'),head=node('header',null,'focus-header'),names=node('div'),nav=node('nav')
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Stock Runway chart focus')
 names.append(node('h2',row.item.name),node('p',chartKeyline(row),'focus-keyline'))
 const move=delta=>{closeChartFocus({restore:false});navigateSku(delta);openChartFocus(document.querySelector('.product-page figure')||$('hero').querySelector('figure'))}
 const prev=wlBtn('‹',()=>move(-1)),next=wlBtn('›',()=>move(1)),close=wlBtn('Close',()=>closeChartFocus())
 prev.id='focus-prev';next.id='focus-next';close.id='focus-close';prev.setAttribute('aria-label','Previous product');next.setAttribute('aria-label','Next product');close.setAttribute('aria-label','Close chart');close.title='Close · Esc'
 const index=filteredRows.findIndex(r=>r.item.sku===selectedSku);prev.disabled=index<=0;next.disabled=index>=filteredRows.length-1
 nav.setAttribute('aria-label','Chart product navigation');nav.append(prev,node('span',`${index+1} / ${filteredRows.length}`),next,close);head.append(names,nav);overlay.append(head)
 chartFocus.figure=figure;chartFocus.home=figure.parentElement;chartFocus.trigger=figure.querySelector('.chart-expand');chartFocus.overlay=overlay
 chartFocus.inert=[...document.body.children].filter(el=>el.tagName!=='SCRIPT').map(el=>[el,el.inert]);for(const [el]of chartFocus.inert)el.inert=true
 overlay.append(figure);document.body.append(overlay);document.body.classList.add('chart-focused');figure.drawChart();close.focus()
}
// Capture before worklist Escape and old chart navigation. Trap focus in overlay.
document.addEventListener('keydown',e=>{
 if(e.metaKey||e.ctrlKey||e.altKey||document.querySelector('dialog[open]')||e.target.closest('input,textarea,select,[contenteditable=true]'))return
 if(chartFocus.overlay){
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeChartFocus();return}
  if(e.key==='Tab'){const controls=[...chartFocus.overlay.querySelectorAll('button:not([disabled]),[tabindex="0"]')].filter(el=>el.checkVisibility());const index=controls.indexOf(document.activeElement),next=controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length];e.preventDefault();next?.focus();return}
  if(['j','k','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();$(['k','ArrowLeft','ArrowUp'].includes(e.key)?'focus-prev':'focus-next').click();return}
 }
 if(e.key.toLowerCase()==='f'&&wl.drawer){e.preventDefault();e.stopImmediatePropagation();openChartFocus(document.querySelector('.product-page figure')||$('hero').querySelector('figure'))}
},true)
// Adapt table columns to the space remaining beside the drawer. Persisted column
// choices stay intact; hide category, lead time, supplier in that priority order.
const largeLayoutBase=wlLayout
wlLayout=function(){
 const original=wl.columns
 if(wl.drawer&&!matchMedia('(max-width:1023px)').matches){
  const room=wlScroll.clientWidth-2;let cols=[...original]
  const total=()=>44+wlColumns.filter(c=>cols.includes(c[0])).reduce((n,c)=>n+c[2],0)
  for(const key of ['category','lead','supplier'])if(total()>room)cols=cols.filter(c=>c!==key)
  wl.columns=cols
 }
 largeLayoutBase();wl.effectiveColumns=[...wl.columns];wl.columns=original
 // Keep the narrow dot column sortable and named without zero-size text.
 const statusButton=wlHead.querySelector('[data-column=status] button')
 if(statusButton){statusButton.setAttribute('aria-label','Sort by Status');if(wl.drawer)statusButton.textContent=''}
 if(wl.drawer&&!wl.phone){
  const compact={product:184,status:44,hand:72,incoming:80,days:80,qty:80,due:88},cols=wlColumns.filter(c=>wl.effectiveColumns.includes(c[0])),room=wlScroll.clientWidth-2
  if(44+cols.reduce((n,c)=>n+c[2],0)>room){const widths=cols.map(c=>compact[c[0]]||c[2]);widths[0]=Math.max(140,room-44-widths.slice(1).reduce((n,w)=>n+w,0));wlScroll.style.setProperty('--work-columns','44px '+widths.map(w=>w+'px').join(' '));wlScroll.style.setProperty('--work-min',Math.min(room,44+widths.reduce((n,w)=>n+w,0))+'px')}
 }
}
const largeRowBase=wlRow
wlRow=function(...args){const columns=wl.columns;wl.columns=wl.effectiveColumns||columns;const row=largeRowBase(...args);wl.columns=columns;return row}
const largeOpenBase=wlOpen,largeCloseBase=wlCloseDrawer
wlOpen=function(row){largeOpenBase(row);wlLayout();wlRenderRows()}
wlCloseDrawer=function(){if(chartFocus.overlay)closeChartFocus({restore:false});largeCloseBase();wlLayout();wlRenderRows()}
if(wl.drawer)selectItem(rowMap.get(selectedSku),{hash:false});wlLayout();wlRenderRows()
