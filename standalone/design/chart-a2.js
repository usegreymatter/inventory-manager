/* STOCK_RUNWAY_FULL_CHART_START */
// A2 changes presentation only. Monthly demand, month-end stock and the
// fractional run-out point are the exact series used by Desktop's Chart.
function axisUnit(unit) {
  const labels = {m:'Metres','m²':'Square metres',m2:'Square metres',kg:'Kilograms',g:'Grams',l:'Litres',ml:'Millilitres',units:'Units',unit:'Units',ea:'Units'}
  const key=unit.trim().toLowerCase()
  return Object.hasOwn(labels,key)?labels[key]:'Units'
}
/* STOCK_RUNWAY_A2_SERIES_START */
function a2Series(item, months) {
  const history=inventoryHistory(item,months), n=months.length, rows=item.projection, {crossing}=stockPath(item)
  const timeline=[...months.map((month,i)=>({month,demand:item.monthly_sales[i],receipts:history.rows[i]?.delivered??0,past:true})),...rows]
  const points=history.rows.map((r,i)=>({t:i+1,stock:r.stock,month:months[i]}))
  const roundedStart=history.rows.length>0 && item.on_hand!==item.stock
  if(!history.rows.length || roundedStart)points.push({t:n,stock:item.stock,snapshot:true})
  rows.forEach((row,i)=>{
    if(crossing && crossing.month>i && crossing.month<i+1)points.push({t:n+crossing.month,stock:0,crossing:true})
    points.push({t:n+i+1,stock:Math.max(0,row.stock),month:row.month})
  })
  // Sources only specify monthly receipt totals. Do not fabricate a day or an
  // intra-month stock balance. Mark the existing month-end stock point instead.
  const deliveries=timeline.flatMap((r,i)=>r.receipts>0?[{t:i+1,month:r.month,quantity:r.receipts,stock:i<n?history.rows[i].stock:Math.max(0,r.stock),past:!!r.past}]:[])
  return {history,n,rows,timeline,points,roundedStart,crossing,deliveries,slots:timeline.length}
}
function a2Window(slots,n,preset=12,start) {
  const count=preset==='all'?slots:Math.min(slots,Math.max(Math.min(3,slots),Math.round(Number(preset))))
  const first=Math.max(0,Math.min(slots-count,Math.round(start??(n-count/2))))
  return {start:first,end:first+count,count}
}
/* STOCK_RUNWAY_A2_SERIES_END */
function inventorySvg(item,months,measuredWidth,window) {
  const series=a2Series(item,months), {timeline,points,deliveries,n,slots,crossing}=series
  const view=window||a2Window(slots,n),width=Math.max(200,measuredWidth)
  let peak=Math.max(1,item.stock)
  for(const r of timeline)peak=Math.max(peak,r.demand,r.receipts||0)
  for(const p of points)peak=Math.max(peak,p.stock)
  const step=Math.max(1,niceStep(peak*1.1/4)),max=Math.max(4*step,Math.ceil(peak*1.1/step)*step)
  const ticks=Array.from({length:Math.round(max/step)+1},(_,i)=>i*step)
  const left=ticks.reduce((v,t)=>Math.max(v,tickLabel(t).length),0)*7+14,right=width-20,top=42
  const bottom=top+Math.max(220,Math.min(310,(right-left)/2)),height=bottom+44
  const x=t=>left+(t-view.start)*(right-left)/view.count,y=v=>bottom-Math.max(0,v)/max*(bottom-top)
  const inRange=t=>t>view.start&&t<=view.end,visible=timeline.map((r,i)=>({...r,i})).slice(view.start,view.end)
  const svg=svgNode('svg',{'data-chart':'demand-stock','data-visible-months':view.count,'data-total-months':slots,'data-window-start':view.start,'data-window-end':view.end,role:'group',tabindex:0,viewBox:`0 0 ${width} ${height}`,width:'100%',height,'aria-label':`Monthly demand and month-end stock in ${item.unit}. ${label(visible[0].month)} to ${label(visible.at(-1).month)}. Plus and minus zoom, left and right pan. Delivery dots are monthly totals, not exact receipt dates.`})
  const add=(tag,attrs,text)=>{const el=svgNode(tag,attrs,text);svg.append(el);return el}
  for(const value of ticks){add('line',{x1:left,x2:right,y1:y(value),y2:y(value),stroke:'var(--line)','stroke-width':value===0?1.5:1});add('text',{x:left-8,y:y(value)+4,'text-anchor':'end',fill:'var(--muted)','font-size':11},tickLabel(value))}
  add('text',{'data-axis-unit':true,x:left,y:14,fill:'var(--muted)','font-size':11},axisUnit(item.unit))
  const bw=Math.min(48,(right-left)/view.count*.58)
  for(const r of visible)add('rect',{'data-period':r.past?'sold':'forecast','data-month':r.month,'data-value':r.demand,x:x(r.i+.5)-bw/2,y:y(r.demand),width:bw,height:bottom-y(r.demand),fill:'var(--accent)',opacity:r.past?1:.27})
  if(n>=view.start&&n<=view.end){const nx=x(n);add('line',{'data-now-divider':true,x1:nx,x2:nx,y1:top-4,y2:bottom,stroke:'var(--muted)','stroke-dasharray':'4 5'});add('text',{x:Math.max(left+14,Math.min(right-14,nx)),y:30,'text-anchor':'middle',fill:'var(--ink)','font-size':11,'font-weight':600},'Now')}
  // Clip via geometric line segments, not CSS/SVG URL resources (offline).
  // Preserve offscreen neighbours at boundaries so panning never breaks the line.
  const segments=[]
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i]
    if(b.t<view.start||a.t>view.end)continue
    if(a.t===b.t){if(a.t>=view.start&&a.t<=view.end)segments.push([a,b]);continue}
    const at=t=>({t,stock:a.stock+(b.stock-a.stock)*(t-a.t)/(b.t-a.t)})
    segments.push([at(Math.max(view.start,a.t)),at(Math.min(view.end,b.t))])
  }
  add('path',{'data-inventory-line':true,d:segments.map(([a,b])=>`M${x(a.t)},${y(a.stock)}L${x(b.t)},${y(b.stock)}`).join(' '),fill:'none',stroke:'var(--ink)','stroke-width':2.3,'stroke-linejoin':'round'})
  for(const p of points)if(p.month&&inRange(p.t))add('circle',{'data-inventory-dot':true,'data-month':p.month,'data-value':p.stock,cx:x(p.t),cy:y(p.stock),r:2.5,fill:'var(--ink)'})
  const occupied=[]
  const stockLineHits=box=>segments.some(([a,b])=>{
    const ax=x(a.t),ay=y(a.stock),bx=x(b.t),by=y(b.stock)
    const inside=(px,py)=>px>=box.x&&px<=box.x+box.w&&py>=box.y&&py<=box.y+box.h
    if(inside(ax,ay)||inside(bx,by))return true
    if(ax!==bx)for(const edge of [box.x,box.x+box.w]){const t=(edge-ax)/(bx-ax);if(t>=0&&t<=1&&inside(edge,ay+t*(by-ay)))return true}
    if(ay!==by)for(const edge of [box.y,box.y+box.h]){const t=(edge-ay)/(by-ay);if(t>=0&&t<=1&&inside(ax+t*(bx-ax),edge))return true}
    return false
  })
  const valueText=(text,px,py,kind)=>{
    const tw=text.length*6+6,tx=Math.max(left+tw/2,Math.min(right-tw/2,px))
    const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y
    for(const delta of [0,-15,15,-30,30,-45,45]){
      const ty=Math.max(top+13,Math.min(bottom-8,py+delta)),box={x:tx-tw/2,y:ty-11,w:tw,h:14}
      if(occupied.some(b=>overlap(b,box))||stockLineHits(box))continue
      occupied.push(box);add('text',{'data-value-label':kind,x:tx,y:ty,'text-anchor':'middle',fill:kind==='demand'?'var(--accent)':'var(--ink)','font-size':10,class:'marker-label'},text);return
    }
  }
  if(crossing&&n+crossing.month>=view.start&&n+crossing.month<=view.end){
    const cx=x(n+crossing.month),text=item.on_hand===0?'Out of stock':`Runs out ${item.runout_day?shortDate(item.runout_day):label(crossing.label)}`
    const tw=text.length*6.1,tx=Math.max(left,Math.min(right-tw,cx+8))
    occupied.push({x:tx,y:bottom-41,w:tw,h:15})
    add('circle',{'data-runout':true,cx,cy:bottom,r:4,fill:'var(--red)'})
    add('text',{'data-runout-label':true,x:tx,y:bottom-28,fill:'var(--ink)','font-size':11,'font-weight':600,class:'marker-label'},text)
  }
  if(view.count<=6&&(right-left)/view.count>=38){
    for(const r of visible)valueText(tickLabel(r.demand),x(r.i+.5),y(r.demand)-8,'demand')
    for(const p of points)if(p.month&&inRange(p.t)&&p.stock>0)valueText(tickLabel(p.stock),x(p.t),y(p.stock)-10,'stock')
  }
  for(const delivery of deliveries.filter(d=>inRange(d.t))){
    const kind=delivery.past?'Delivery':'Expected delivery'
    const dot=add('circle',{'data-delivery-marker':true,'data-month':delivery.month,'data-quantity':delivery.quantity,'data-value':delivery.stock,cx:x(delivery.t),cy:y(delivery.stock),r:5,fill:'var(--bg)',stroke:'var(--ink)','stroke-width':2,tabindex:0,role:'button','aria-label':`${kind} ${orderAmount(delivery.quantity)} ${item.unit}, ${label(delivery.month)}; monthly total, exact date unavailable`})
    dot.append(svgNode('title',{},`${kind}: ${orderAmount(delivery.quantity)} ${item.unit} · ${label(delivery.month)} (monthly total)`))
  }
  const stride=Math.max(1,Math.ceil(view.count*65/(right-left)))
  for(let j=0;j<visible.length;j+=stride)add('text',{'data-month-tick':true,x:x(visible[j].i+.5),y:bottom+23,'text-anchor':'middle',fill:'var(--muted)','font-size':10},label(visible[j].month))
  return {...series,svg,view,x,y,left,right,top,bottom,width,height}
}
function fullChart(row) {
  const {item}=row,series=a2Series(item,data.months),figure=node('figure',null,'inventory-figure'),wrap=node('div',null,'chart-wrap'),toolbar=node('div',null,'chart-toolbar'),controls=node('div',null,'zoom-controls')
  let view=a2Window(series.slots,series.n),wheelView=view,chart,lastWidth=0,preset='12',index=series.n-1
  toolbar.append(node('h3','Demand & stock'),controls)
  const buttons=[]
  for(const [value,text]of [['6','6M'],['12','1Y'],['24','2Y'],['all','All'],['reset','Reset']]){
    const button=node('button',text);button.type='button';button.dataset.zoom=value;button.setAttribute('aria-label',value==='reset'?'Reset chart view':`Show ${text==='All'?'all months':text}`)
    button.addEventListener('click',()=>{preset=value==='reset'?'12':value;view=a2Window(series.slots,series.n,preset);wheelView=view;draw()});controls.append(button);buttons.push(button)
  }
  figure.append(toolbar,wrap)
  const legend=node('figcaption',null,'legend inventory-legend')
  for(const [text,cls]of [['Demand','past-demand'],['Stock on hand','stock-on-hand'],['Delivery','delivery-dot']]){const span=node('span',text);span.prepend(node('i',null,cls));legend.append(span)}
  figure.append(legend,node('p','Faded bars: forecast · delivery dots: monthly totals.','chart-note'))
  const about=node('details',null,'about-chart');about.append(node('summary','About this chart'))
  const body=node('div',null,'detail-body');body.append(node('p','Stock points are month-end balances. Delivery dots mark months with receipts; exact delivery dates are unavailable. Zoom changes the view, not the monthly data.'),node('p','Scroll / pinch to zoom · drag / swipe to pan · + / − and arrow keys on the chart.'),node('p',`Now is the stock snapshot (${formatDate(data.as_of)}). Forecast excludes the suggested new order.`),node('p',`${item.forecast_explanation||SEASONAL_REASON}.`))
  if(series.history.warning)body.append(node('p',series.history.warning))
  if(series.roundedStart)body.append(node('p',`Historical stock ends at ${format(item.on_hand)} ${item.unit}; forecast starts rounded down to ${format(item.stock)} at Now.`))
  about.append(body);figure.append(about)
  const tooltip=node('div',null,'chart-tooltip inventory-tooltip');tooltip.hidden=true;tooltip.setAttribute('role','status')
  const hide=()=>{tooltip.hidden=true}
  const show=(i,delivery=false)=>{
    index=Math.max(view.start,Math.min(view.end-1,i));const r=series.timeline[index],t=index+1,stock=index<series.n?series.history.rows[index]?.stock:Math.max(0,series.rows[index-series.n].stock)
    tooltip.replaceChildren(node('strong',delivery?`${r.past?'Delivery':'Expected delivery'} · ${label(r.month)}`:label(r.month)))
    if(delivery){tooltip.append(node('span',`${orderAmount(r.receipts)} ${item.unit}`),node('span','Monthly total · exact date unavailable'))}
    else tooltip.append(node('span',`${r.past?'Demand':'Forecast demand'}  ${orderAmount(r.demand)} ${item.unit}`),node('span',`Stock  ${stock==null?'Unknown':stockCell(stock)+' '+item.unit}`))
    tooltip.hidden=false
    const px=chart.x(t),py=stock==null?chart.top:chart.y(stock),tw=tooltip.offsetWidth,th=tooltip.offsetHeight
    tooltip.style.left=`${Math.max(chart.left+6,Math.min(chart.width-tw,px-tw/2))}px`;tooltip.style.top=`${Math.max(chart.top+6,Math.min(chart.bottom-th,py-th-14))}px`
  }
  const draw=()=>{
    const width=Math.round(wrap.getBoundingClientRect().width);if(width<50)return
    lastWidth=width;chart=inventorySvg(item,data.months,width,view);wrap.replaceChildren(chart.svg,tooltip);hide()
    for(const b of buttons)if(b.dataset.zoom!=='reset')b.setAttribute('aria-pressed',String(b.dataset.zoom===preset))
    for(const dot of chart.svg.querySelectorAll('[data-delivery-marker]')){
      const i=series.timeline.findIndex(r=>r.month===dot.dataset.month)
      for(const event of ['pointerenter','focus','click'])dot.addEventListener(event,e=>{e.stopPropagation();show(i,true)})
      dot.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show(i,true)}if(e.key==='Escape')hide()})
    }
  }
  const change=(count,start)=>{view=a2Window(series.slots,series.n,count,start);wheelView=view;preset='custom';draw()}
  const zoom=(factor,anchor=.5)=>{const count=Math.max(3,Math.min(series.slots,Math.round(view.count*factor)));change(count,view.start+(view.count-count)*anchor)}
  wrap.addEventListener('wheel',e=>{
    if(!chart||!e.deltaY)return
    // Keep page scrolling at a zoom bound, but never let ctrl-pinch zoom the page.
    if((e.deltaY<0&&view.count===Math.min(3,series.slots))||(e.deltaY>0&&view.count===series.slots)){
      wheelView=view;if(e.ctrlKey)e.preventDefault();return
    }
    e.preventDefault()
    const rect=wrap.getBoundingClientRect(),anchor=Math.max(0,Math.min(1,(e.clientX-rect.left-chart.left)/(chart.right-chart.left)))
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?rect.height:1)
    // Retain fractional count/start between events; round only the rendered window.
    const count=Math.max(Math.min(3,series.slots),Math.min(series.slots,wheelView.count*Math.exp(delta*(e.ctrlKey?.01:.002))))
    const start=Math.max(0,Math.min(series.slots-count,wheelView.start+(wheelView.count-count)*anchor))
    if(Math.round(count)!==view.count)change(count,start+(count-Math.round(count))*anchor)
    wheelView={count,start}
  },{passive:false})
  const pointers=new Map();let gesture=null,moved=false
  wrap.addEventListener('pointerdown',e=>{
    if(e.button>0)return
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});wrap.setPointerCapture(e.pointerId);moved=false
    const ps=[...pointers.values()];gesture={start:view.start,count:view.count,x:e.clientX,distance:ps.length===2?Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y):0,delivery:e.target.hasAttribute('data-delivery-marker')}
    if(e.target.hasAttribute('data-delivery-marker'))show(series.timeline.findIndex(r=>r.month===e.target.dataset.month),true)
  })
  wrap.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const ps=[...pointers.values()]
    if(ps.length===2&&gesture?.distance){
      const distance=Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y),count=Math.max(3,Math.min(series.slots,Math.round(gesture.count*gesture.distance/Math.max(1,distance))))
      moved=true;change(count,gesture.start+(gesture.count-count)/2)
    }else if(gesture&&Math.abs(e.clientX-gesture.x)>5){moved=true;change(gesture.count,gesture.start-(e.clientX-gesture.x)/(chart.right-chart.left)*gesture.count)}
  })
  const finish=e=>{
    const was=pointers.has(e.pointerId);pointers.delete(e.pointerId)
    if(was&&!moved&&!gesture?.delivery){const rect=wrap.getBoundingClientRect();show(Math.floor(view.start+(e.clientX-rect.left-chart.left)/(chart.right-chart.left)*view.count))}
    const remaining=[...pointers.values()];gesture=remaining.length?{start:view.start,count:view.count,x:remaining[0].x,distance:0}:null
  }
  wrap.addEventListener('pointerup',finish);wrap.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);gesture=null;hide()});wrap.addEventListener('pointerleave',()=>{if(!pointers.size)hide()})
  wrap.addEventListener('keydown',e=>{
    if(['+','=','-','_','ArrowLeft','ArrowRight','Escape','Home'].includes(e.key)){
      e.preventDefault();if(e.key==='Escape')hide();else if(e.key==='Home'){view=a2Window(series.slots,series.n);wheelView=view;preset='12';draw()}
      else if(e.key.startsWith('Arrow'))change(view.count,view.start+(e.key==='ArrowRight'?1:-1))
      else zoom(['+','='].includes(e.key)?.8:1.2)
      // A redraw replaces the SVG, so keep the keyboard interaction anchored.
      if(e.key!=='Escape')chart.svg.focus({preventScroll:true})
    }
  })
  const observer=new ResizeObserver(()=>{if(Math.round(wrap.getBoundingClientRect().width)!==lastWidth)draw()});observer.observe(wrap);chartObservers.add({observer,wrap});requestAnimationFrame(draw)
  return figure
}
/* STOCK_RUNWAY_FULL_CHART_END */
