// Lifecycle: living. Arctic-only presentation; core, guidance and source series stay verbatim.
// Relative physical run-out uses the snapshot, never the wall-clock decision date.
gmRelative=function(date){
  const days=Math.round((new Date(date+A3_DATE_SUFFIX)-new Date(data.as_of+A3_DATE_SUFFIX))/86400000)
  return days===0?'On snapshot date':days>0?`In ${days} ${days===1?'day':'days'}`:`${-days} ${days===-1?'day':'days'} before snapshot`
}
gmSnapshotLabel=function(){
  $('snapshot').textContent=`As of ${gmDate(data.as_of)} · ${sourceName==='sample'?'Sample data':'Local CSV'}`
}
// delivery_date is a confirmed gap-ending receipt, not a calculated new-order arrival.
// Keep confirmed delivery separate from the chart-focus suggested-order overlay.
function gmBLeadNotice(g){
  if(!g.used_default_lead)return null
  return g.delivery_date?`Supplier lead time missing: using the default ${g.lead_days} days`:`Supplier lead time missing; order date assumes the default ${g.lead_days} days`
}
// Retain the supplied logo and keyboard support, with their quiet home in the sidebar/menu.
const gmBFooter=document.querySelector('.list-footer')
gmBFooter.removeAttribute('aria-hidden');gmBFooter.replaceChildren(document.querySelector('.gm-by'))
const gmBKeys=node('p','Keyboard: J / K or arrow keys to change product.','keyboard-help')
document.querySelector('.tools-body').append(gmBKeys)
$('prev-sku').textContent='‹';$('next-sku').textContent='›'
$('prev-sku').title='Previous product · K / ←';$('next-sku').title='Next product · J / →'
// The Arctic browsing adapter is appended by build.py after these chart adapters.
const gmBFullChart=fullChart
fullChart=function(row){
  const figure=gmBFullChart(row),legend=figure.querySelector('.legend'),toolbar=figure.querySelector('.chart-toolbar')
  legend.replaceChildren()
  for(const [text,cls]of [['Stock','stock'],['Monthly demand','demand'],['Forecast (dashed)','forecast']]){
    const entry=node('span',text);entry.prepend(node('i',null,cls));legend.append(entry)
  }
  toolbar.after(legend)
  for(const button of figure.querySelectorAll('[data-zoom]')){
    button.textContent=({'6':'6M','12':'1Y','24':'2Y',all:'All'})[button.dataset.zoom]
    button.setAttribute('aria-label','Show '+({'6':'6 months','12':'1 year','24':'2 years',all:'all months'})[button.dataset.zoom])
  }
  return figure
}
const gmBPanel=chartPanel
chartPanel=function(row){
  const panel=gmBPanel(row),g=row.guidance
  panel.querySelector('.quantity-label').textContent='Suggested order'
  for(const [i,stat] of [...panel.querySelectorAll('.date-stat')].entries()){
    const strong=stat.querySelector('strong')
    if(strong.textContent===STRINGS.unknown){
      strong.textContent='Not set'
      if(i===1)stat.append(node('small','No confirmed arrival date','date-relative'))
    }
  }
  const context=panel.querySelector('.context-row'),about=context.querySelector('.about'),body=about.querySelector('.detail-body'),messages=[]
  for(const warning of context.querySelectorAll('.warning-detail')){
    const label=warning.querySelector('summary').textContent.replace(STRINGS.copy,'').trim()
    if(label!==STRINGS.default_delivery)messages.push(label)
    body.prepend(node('p',warning.querySelector('p').textContent));warning.remove()
  }
  const leadNotice=gmBLeadNotice(g)
  if(leadNotice)messages.unshift(leadNotice)
  if(!messages.length)messages.push('Receipts shown as monthly totals; exact date unavailable')
  context.prepend(node('p',messages.join('. ')+'.','chart-note'))
  about.querySelector('summary').textContent='About this estimate';about.querySelector('summary').title='Chart details, warnings and assumptions'
  panel.querySelector('.gm-precision').remove()
  return panel
}
const gmBBaseSvg=inventorySvg
inventorySvg=function(item,months,measuredWidth,window,cachedSeries,measuredHeight){
  // Render the exact A3 series with an Arctic-only viewport scale and annotations.
  const series=cachedSeries||a2Series(item,months),view=window||a2Window(series.slots,series.n)
  const visible=series.timeline.slice(view.start,view.end)
  let peak=Math.max(1,...visible.map(r=>r.demand))
  const visibleStock=[]
  for(let i=1;i<series.points.length;i++){
    const a=series.points[i-1],b=series.points[i]
    if(b.t<view.start||a.t>view.end)continue
    const stockAt=t=>a.t===b.t?Math.max(a.stock,b.stock):a.stock+(b.stock-a.stock)*(t-a.t)/(b.t-a.t)
    visibleStock.push(stockAt(Math.max(a.t,view.start)),stockAt(Math.min(b.t,view.end)))
  }
  // Optional Arctic display-only scenario scale; source projections stay untouched.
  peak=Math.max(peak,...visibleStock,series.orderDisplayPeak||0)
  // Decimal nice-number ceiling, at most four labelled gridlines including zero.
  const raw=peak/3,power=10**Math.floor(Math.log10(raw)),step=([1,2,2.5,5,10].find(v=>v*power>=raw)||10)*power
  const max=Math.ceil(peak/step)*step,ticks=Array.from({length:Math.round(max/step)+1},(_,i)=>i*step)
  const width=Math.max(200,measuredWidth),left=Math.max(40,...ticks.map(t=>tickLabel(t).length*7+16)),right=width-24,top=series.orderDisplayPeak!==undefined?96:48
  // Two annotation rows above the plot: Today first, run-out right or stacked.
  // This reserved band is outside all bars, stock marks and axis ticks.
  const height=measuredHeight>=220?measuredHeight:measuredWidth<500?180:320,bottom=height-44
  const x=t=>left+(t-view.start)*(right-left)/view.count,y=v=>bottom-Math.max(0,v)/max*(bottom-top)
  // A3 constructs and clips every stock segment and retains the native marker hooks.
  // Reproject its geometry, not its data: no new stock points or quantities.
  const chart=gmBBaseSvg(item,months,measuredWidth,view,series,height),svg=chart.svg
  const px=v=>left+(v-chart.left)/(chart.right-chart.left)*(right-left)
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('height',height);svg.dataset.axisMax=String(max)
  // Remove the old axes, direct names, monthly stock dots and optional bar values.
  // Keep the exact monthly numeric audit surface without drawing per-point markers.
  for(const dot of svg.querySelectorAll('[data-inventory-dot]')){
    const metadata=svgNode('g',{'data-stock-value':true,'data-month':dot.dataset.month,'data-value':dot.dataset.value,'aria-hidden':true})
    dot.replaceWith(metadata)
  }
  svg.querySelectorAll('text,line:not([data-now-divider])').forEach(e=>e.remove())
  // Clip the unchanged monthly segments in data space (as A3 does), then scale.
  // Never invert old SVG y coordinates: huge offscreen peaks can erase small values.
  const past=[],future=[],segment=(a,b)=>`M${x(a.t)},${y(a.stock)}L${x(b.t)},${y(b.stock)}`
  for(let i=1;i<series.points.length;i++){
    const a=series.points[i-1],b=series.points[i]
    // Stop only the drawn forecast at first run-out; all source points survive.
    const forecastEnd=series.crossing?series.n+series.crossing.month:Infinity
    if(b.t<view.start||a.t>view.end||a.t>=forecastEnd)continue
    const at=t=>({t,stock:a.stock+(b.stock-a.stock)*(t-a.t)/(b.t-a.t)})
    const p=a.t===b.t?a:at(Math.max(view.start,a.t)),q=a.t===b.t?b:at(Math.min(view.end,b.t,forecastEnd))
    if(q.t<=series.n)past.push(segment(p,q))
    else if(p.t>=series.n)future.push(segment(p,q))
    else{const boundary=at(series.n);past.push(segment(p,boundary));future.push(segment(boundary,q))}
  }
  svg.querySelector('[data-inventory-past]').setAttribute('d',past.join(' '))
  svg.querySelector('[data-inventory-line]').setAttribute('d',future.join(' '))
  svg.querySelectorAll('[data-gm-delivery-diamond]').forEach(e=>e.remove())
  for(const e of svg.querySelectorAll('[data-period]')){
    const oldWidth=Number(e.getAttribute('width')),newX=px(Number(e.getAttribute('x'))),newY=y(Number(e.dataset.value))
    e.setAttribute('x',newX);e.setAttribute('width',oldWidth*(right-left)/(chart.right-chart.left));e.setAttribute('y',newY);e.setAttribute('height',bottom-newY)
    e.setAttribute('opacity','1');e.setAttribute('stroke','var(--demand-edge)');e.setAttribute('stroke-width','1')
    if(e.dataset.period==='forecast'){e.setAttribute('stroke-dasharray','3 2');e.setAttribute('fill','none')}
  }
  const add=(tag,attrs,text)=>{const e=svgNode(tag,attrs,text);svg.append(e);return e}
  for(const value of ticks){
    const line=svgNode('line',{'data-gridline':value,x1:left,x2:right,y1:y(value),y2:y(value),stroke:'var(--line)','stroke-width':1});svg.prepend(line)
    add('text',{'data-axis-tick':value,x:left-8,y:y(value)+4,'text-anchor':'end',fill:'var(--muted)'},tickLabel(value))
  }
  const now=svg.querySelector('[data-now-divider]')
  let todayRight=null
  if(now){
    const nx=px(Number(now.getAttribute('x1'))),tx=Math.max(left+20,Math.min(right-20,nx))
    now.setAttribute('x1',nx);now.setAttribute('x2',nx);now.setAttribute('y1',top);now.setAttribute('y2',bottom)
    add('text',{'data-today-label':true,x:tx,y:12,'text-anchor':'middle',fill:'var(--muted)'},'Today');todayRight=tx+20
  }
  const runout=svg.querySelector('[data-runout]')
  if(runout){
    const cx=px(Number(runout.getAttribute('cx'))),text=item.runout_day?`Runs out ${new Date(item.runout_day+A3_DATE_SUFFIX).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:A3_TIMEZONE})}`:'Runs out',half=text.length*3.6
    const tx=right-half,ty=todayRight!==null&&todayRight+12>tx-half?32:12
    runout.setAttribute('cx',cx);runout.setAttribute('cy',bottom)
    add('path',{'data-runout-leader':true,d:`M${tx},${ty+4}V${top-8}H${cx}V${bottom-5}`,fill:'none',stroke:'var(--red)','stroke-width':1,'pointer-events':'none'})
    add('text',{'data-runout-label':true,x:tx,y:ty,'text-anchor':'middle',fill:'var(--red)',class:'gm-direct-label'},text)
  }
  // Sparse calendar labels: first tick includes year; January always includes year.
  const indices=measuredWidth<500?[0,Math.floor((visible.length-1)/2),visible.length-1]:visible.map((_,i)=>i).filter(i=>i%Math.max(1,Math.ceil(visible.length*64/(right-left)))===0)
  const occupied=[]
  for(const i of new Set(indices)){
    const month=visible[i].month,[year,m]=month.split('-'),name=new Date(month+'-01T00:00:00Z').toLocaleDateString('en',{month:'short',timeZone:'UTC'})
    const text=i===0||m==='01'?`${name} ${year}`:name,tw=text.length*7,cx=Math.max(left+tw/2,Math.min(right-tw/2,x(view.start+i+.5)))
    add('text',{'data-month-tick':true,x:cx,y:bottom+40,'text-anchor':'middle',fill:'var(--muted)'},text)
  }
  for(const dot of svg.querySelectorAll('[data-delivery-marker]')){
    const cx=px(Number(dot.getAttribute('cx'))),cy=y(Number(dot.dataset.value)),r=5
    dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('r',measuredWidth<500?22:12);dot.setAttribute('stroke-width',0)
    add('path',{'data-gm-delivery-diamond':true,d:`M${cx},${cy-r}L${cx+r},${cy}L${cx},${cy+r}L${cx-r},${cy}Z`,fill:'var(--fine)','pointer-events':'none'})
    const past=series.timeline.find(r=>r.month===dot.dataset.month)?.past,text=`${past?'Received':'Arrives'} ${orderAmount(Number(dot.dataset.quantity))}`
    // Centre labels 8px above the diamond. Phone retains the tap/focus tooltip.
    if(measuredWidth<500)continue
    const tw=text.length*8,ty=cy-r-8,box={left:cx-tw/2,right:cx+tw/2,y:ty}
    const otherLabels=[...svg.querySelectorAll('[data-today-label],[data-runout-label]')].map(e=>({left:Number(e.getAttribute('x'))-e.textContent.length*3.6,right:Number(e.getAttribute('x'))+e.textContent.length*3.6,y:Number(e.getAttribute('y'))}))
    if(ty>=top&&box.left>=left&&box.right<=right&&![...occupied,...otherLabels].some(b=>box.left<b.right+8&&box.right+8>b.left&&Math.abs(ty-b.y)<20)){
      add('text',{'data-gm-receipt-label':true,x:cx,y:ty,'text-anchor':'middle','dominant-baseline':'text-after-edge',fill:'var(--muted)',class:'gm-direct-label'},text);occupied.push(box)
    }
  }
  drawStockoutHatching(svg,item,months,bottom)
  return {...chart,svg,view,x,y,left,right,top,bottom,width,height}
}
gmSnapshotLabel();buildList();selectItem(rowMap.get(selectedSku),{hash:false})
