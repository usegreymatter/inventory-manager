/* STOCK_RUNWAY_FULL_CHART_START */
const A3_KEYS = Object.freeze({down:'ArrowDown',right:'ArrowRight',up:'ArrowUp',left:'ArrowLeft',enter:'Enter',escape:'Escape'})
// A3 changes presentation only. Monthly demand, month-end stock and the
// fractional run-out point are the exact series used by Desktop's Chart.
function axisUnit(unit) {
  const labels = {m:STRINGS.metres,'m²':STRINGS.square_metres,m2:STRINGS.square_metres,kg:STRINGS.kilograms,g:STRINGS.grams,l:STRINGS.litres,ml:STRINGS.millilitres,units:STRINGS.units,unit:STRINGS.units,ea:STRINGS.units}
  const key=unit.trim().toLowerCase()
  return Object.hasOwn(labels,key)?labels[key]:STRINGS.units
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
// Geometry-only annotation; keeps the recorded sales bars untouched.
function drawStockoutHatching(svg,item,months,bottom){
  svg.querySelectorAll('[data-stockout-month]').forEach(e=>e.remove())
  const capped=new Map(detectStockoutMonths(item,months.at(-1)).flagged.map(f=>[f.month,f]))
  for(const bar of svg.querySelectorAll('[data-period="sold"]'))if(capped.has(bar.dataset.month)){
    const start=Number(bar.getAttribute('x')),bw=Number(bar.getAttribute('width')),h=Math.max(32,Number(bar.getAttribute('height'))),base=bottom-h,flag=capped.get(bar.dataset.month)
    const mark=svgNode('g',{'data-stockout-month':flag.month,role:'img','aria-label':label(flag.month)+' · '+(flag.confidence==='known'?'known stock-out':'likely stock-out')})
    mark.append(svgNode('title',{},label(flag.month)+' · suspected capped sales'))
    mark.append(svgNode('rect',{x:start,y:base,width:bw,height:h,fill:'var(--bg)',opacity:.8}))
    for(let t=0;t<bw+h;t+=6){const x1=Math.max(0,t-h),x2=Math.min(bw,t);if(x2>x1)mark.append(svgNode('line',{'data-stockout-stripe':true,x1:start+x1,y1:bottom-(t-x1),x2:start+x2,y2:bottom-(t-x2),stroke:'var(--ink)','stroke-width':1.2}))}
    mark.append(svgNode('rect',{x:start,y:base,width:bw,height:h,fill:'none',stroke:'var(--muted)','stroke-width':.8}));svg.append(mark)
  }
}
function inventorySvg(item,months,measuredWidth,window,cachedSeries,measuredHeight) {
  const series=cachedSeries||a2Series(item,months), {timeline,points,deliveries,n,slots,crossing}=series
  const view=window||a2Window(slots,n),width=Math.max(200,measuredWidth)
  let peak=Math.max(1,item.stock)
  for(const r of timeline)peak=Math.max(peak,r.demand,r.receipts||0)
  for(const p of points)peak=Math.max(peak,p.stock)
  const step=Math.max(1,niceStep(peak*1.1/4)),max=Math.max(4*step,Math.ceil(peak*1.1/step)*step)
  const ticks=Array.from({length:Math.round(max/step)+1},(_,i)=>i*step)
  const left=ticks.reduce((v,t)=>Math.max(v,tickLabel(t).length),0)*7+14,right=width-20,top=42
  const fitPlot=measuredHeight>=220?Math.min(560,measuredHeight-top-52):0
  const bottom=top+(fitPlot||(width<500?145:190)),height=bottom+52
  const x=t=>left+(t-view.start)*(right-left)/view.count,y=v=>bottom-Math.max(0,v)/max*(bottom-top)
  const inRange=t=>t>view.start&&t<=view.end,visible=timeline.map((r,i)=>({...r,i})).slice(view.start,view.end)
  const svg=svgNode('svg',{'data-chart':'demand-stock','data-visible-months':view.count,'data-total-months':slots,'data-window-start':view.start,'data-window-end':view.end,role:'group',tabindex:0,viewBox:`0 0 ${width} ${height}`,width:'100%',height,'aria-label':S('monthly_demand_and_month_end_stock_in_v0_v',{v0:(item.unit),v1:(label(visible[0].month)),v2:(label(visible.at(-1).month))})})
  const add=(tag,attrs,text)=>{const el=svgNode(tag,attrs,text);svg.append(el);return el}
  for(const value of ticks){add('line',{x1:left,x2:right,y1:y(value),y2:y(value),stroke:'var(--line)','stroke-width':value===0?1.5:1});add('text',{x:left-8,y:y(value)+4,'text-anchor':'end',fill:'var(--muted)','font-size':11},tickLabel(value))}
  add('text',{'data-axis-unit':true,x:left,y:14,fill:'var(--muted)','font-size':11},axisUnit(item.unit))
  const bw=Math.min(48,(right-left)/view.count*.58)
  for(const r of visible)add('rect',{'data-period':r.past?'sold':'forecast','data-month':r.month,'data-value':r.demand,x:x(r.i+.5)-bw/2,y:y(r.demand),width:bw,height:bottom-y(r.demand),fill:'var(--demand)',opacity:r.past?1:.6})
  drawStockoutHatching(svg,item,months,bottom)
  if(n>=view.start&&n<=view.end){const nx=x(n);add('line',{'data-now-divider':true,x1:nx,x2:nx,y1:top-4,y2:bottom,stroke:'var(--muted)','stroke-dasharray':'4 5'});add('text',{x:Math.max(left+14,Math.min(right-14,nx)),y:30,'text-anchor':'middle',fill:'var(--ink)','font-size':11,'font-weight':600},STRINGS.now)}
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
  add('path',{'data-inventory-line':true,d:segments.map(([a,b])=>`M${x(a.t)},${y(a.stock)}L${x(b.t)},${y(b.stock)}`).join(' '),fill:'none',stroke:'var(--accent)','stroke-width':2.3,'stroke-linejoin':'round'})
  for(const p of points)if(p.month&&inRange(p.t))add('circle',{'data-inventory-dot':true,'data-month':p.month,'data-value':p.stock,cx:x(p.t),cy:y(p.stock),r:2.5,fill:'var(--accent)'})
  if(crossing&&n+crossing.month>=view.start&&n+crossing.month<=view.end){
    const cx=x(n+crossing.month)
    add('circle',{'data-runout':true,cx,cy:bottom,r:4,fill:'var(--red)'})
    // Date lives in the separate header chip; the chart marker stays uncluttered.
    add('text',{'data-runout-label':true,x:Math.max(left+24,Math.min(right-24,cx)),y:bottom+40,'text-anchor':'middle',fill:'var(--red)','font-size':10,'font-weight':600},STRINGS.runout)
  }
  if(view.count<=6&&(right-left)/view.count>=38){
    const occupied=[]
    const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y
    const stockHits=box=>segments.some(([a,b])=>{
      const ax=x(a.t),ay=y(a.stock),bx=x(b.t),by=y(b.stock)
      const inside=(px,py)=>px>=box.x&&px<=box.x+box.w&&py>=box.y&&py<=box.y+box.h
      if(inside(ax,ay)||inside(bx,by))return true
      if(ax!==bx)for(const edge of [box.x,box.x+box.w]){const t=(edge-ax)/(bx-ax);if(t>=0&&t<=1&&inside(edge,ay+t*(by-ay)))return true}
      if(ay!==by)for(const edge of [box.y,box.y+box.h]){const t=(edge-ay)/(by-ay);if(t>=0&&t<=1&&inside(ax+t*(bx-ax),edge))return true}
      return false
    })
    for(const r of visible){
      const text=tickLabel(r.demand),px=x(r.i+.5),tw=text.length*6+8,barTop=y(r.demand)
      // Conservative glyph bounds include the white text halo. Search upward
      // only; a label is omitted if every above-bar slot meets the stock line.
      for(let ty=barTop-8;ty>=top+6;ty-=14){
        const box={x:px-tw/2,y:ty-12,w:tw,h:16}
        const clearance={x:box.x-5,y:box.y-5,w:box.w+10,h:box.h+10}
        if(box.x<left||box.x+box.w>right||occupied.some(b=>overlaps(b,box))||stockHits(clearance))continue
        add('text',{'data-value-label':'demand','data-month':r.month,x:px,y:ty,'text-anchor':'middle',fill:'var(--muted)','font-size':10,class:'marker-label'},text)
        occupied.push(box);break
      }
    }
  }
  for(const delivery of deliveries.filter(d=>inRange(d.t))){
    const kind=delivery.past?STRINGS.delivery:STRINGS.expected_delivery
    const dot=add('circle',{'data-delivery-marker':true,'data-month':delivery.month,'data-quantity':delivery.quantity,'data-value':delivery.stock,cx:x(delivery.t),cy:y(delivery.stock),r:5,fill:'var(--bg)',stroke:'var(--accent)','stroke-width':2,tabindex:0,role:'button','aria-label':S('v0_v1_v2_v3_monthly_total_exact_date_unava',{v0:(kind),v1:(orderAmount(delivery.quantity)),v2:(item.unit),v3:(label(delivery.month))})})
    dot.append(svgNode('title',{},S('v0_v1_v2_v3_monthly_total',{v0:(kind),v1:(orderAmount(delivery.quantity)),v2:(item.unit),v3:(label(delivery.month))})))
  }
  const stride=Math.max(1,Math.ceil(view.count*65/(right-left)))
  for(let j=0;j<visible.length;j+=stride)add('text',{'data-month-tick':true,x:x(visible[j].i+.5),y:bottom+23,'text-anchor':'middle',fill:'var(--muted)','font-size':10},label(visible[j].month))
  return {...series,svg,view,x,y,left,right,top,bottom,width,height}
}
function fullChart(row){
  const {item}=row,series=seriesFor(item),figure=node('figure'),toolbar=node('div',null,'chart-toolbar'),controls=node('div',null,'zoom-controls'),wrap=node('div',null,'chart-wrap')
  let preset='12',view=a2Window(series.slots,series.n,preset),chart,lastWidth=0,lastHeight=0,start=null
  toolbar.append(node('h2',STRINGS.stock_runway),controls)
  const buttons=[]
  for(const[value,text]of [['6','6M'],['12','1Y'],['24','2Y'],['all',STRINGS.all]]){
    const b=node('button',text);b.type='button';b.dataset.zoom=value;b.setAttribute('aria-label',S('show_v0',{v0:(text)}));b.addEventListener('click',()=>{preset=value;view=a2Window(series.slots,series.n,value);draw()});controls.append(b);buttons.push(b)
  }
  const tooltip=node('div',null,'chart-tooltip');tooltip.hidden=true;tooltip.setAttribute('role','status')
  const hide=()=>{tooltip.hidden=true}
  const show=(i,delivery=false)=>{
    const r=series.timeline[i];if(!r)return
    const stock=i<series.n?series.history.rows[i]?.stock:Math.max(0,series.rows[i-series.n].stock)
    tooltip.replaceChildren(node('strong',label(r.month)))
    if(delivery)tooltip.append(node('span',`${r.past?STRINGS.delivery:STRINGS.expected} ${orderAmount(r.receipts)} ${item.unit}`),node('span',STRINGS.monthly_total_exact_date_unavailable,'precision'))
    else tooltip.append(node('span',`${r.past?STRINGS.demand:STRINGS.forecast} ${orderAmount(r.demand)} ${item.unit}`),node('span',S('stock_v0',{v0:(stock==null?STRINGS.unknown:stockCell(stock)+' '+item.unit)})))
    tooltip.hidden=false
  }
  const draw=()=>{
    const box=wrap.getBoundingClientRect(),width=Math.round(box.width);if(width<50)return
    const fit=(typeof getComputedStyle==='function'&&getComputedStyle(wrap).position==='relative')?Math.round(box.height):0
    lastWidth=width;lastHeight=fit;chart=inventorySvg(item,data.months,width,view,series,fit);wrap.replaceChildren(chart.svg);hide()
    buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.zoom===preset)))
    for(const dot of chart.svg.querySelectorAll('[data-delivery-marker]')){
      const i=series.timeline.findIndex(r=>r.month===dot.dataset.month)
      for(const event of ['pointerenter','focus','click'])dot.addEventListener(event,e=>{e.stopPropagation();show(i,true)})
      dot.addEventListener('keydown',e=>{if([A3_KEYS.enter,' '].includes(e.key)){e.preventDefault();show(i,true)}if(e.key===A3_KEYS.escape)hide()})
    }
  }
  wrap.addEventListener('pointerdown',e=>{if(e.button>0)return;start={x:e.clientX,y:e.clientY,id:e.pointerId,delivery:e.target.hasAttribute('data-delivery-marker')};if(!start.delivery)wrap.setPointerCapture(e.pointerId)})
  wrap.addEventListener('pointerup',e=>{
    if(!start||start.id!==e.pointerId)return
    const dx=e.clientX-start.x,dy=e.clientY-start.y,delivery=start.delivery;start=null
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.4){navigateSku(dx<0?1:-1);return}
    if(!delivery&&Math.abs(dx)<10&&Math.abs(dy)<10&&chart){const rect=wrap.getBoundingClientRect();show(Math.max(view.start,Math.min(view.end-1,Math.floor(view.start+(e.clientX-rect.left-chart.left)/(chart.right-chart.left)*view.count))))}
  })
  wrap.addEventListener('pointercancel',()=>{start=null})
  wrap.addEventListener('keydown',e=>{if(e.key===A3_KEYS.escape)hide()})
  const legend=node('figcaption',null,'legend')
  for(const[text,cls]of [[STRINGS.demand,'demand'],[STRINGS.stock,'stock'],[STRINGS.delivery,'delivery']]){const s=node('span',text);s.prepend(node('i',null,cls));legend.append(s)}
  figure.append(toolbar,wrap,tooltip,legend)
  const observer=new ResizeObserver(()=>{const b=wrap.getBoundingClientRect(),fit=(typeof getComputedStyle==='function'&&getComputedStyle(wrap).position==='relative')?Math.round(b.height):0;if(Math.round(b.width)!==lastWidth||fit!==lastHeight)draw()});observer.observe(wrap);chartObservers.add({observer,wrap});figure.drawChart=draw
  return figure
}
/* STOCK_RUNWAY_FULL_CHART_END */
