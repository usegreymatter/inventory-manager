// Lifecycle: living. Shared presentation adapter only; A3/core/learning stay verbatim.
// Never replace, round or mutate guidance, projections, demand or stock series.
const gmDate = date => new Date(date+A3_DATE_SUFFIX).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:A3_TIMEZONE})
function gmRelative(date){
  const days=Math.round((new Date(date+A3_DATE_SUFFIX)-new Date(currentToday+A3_DATE_SUFFIX))/86400000)
  return days===0?'today':days>0?`in ${days} ${days===1?'day':'days'}`:`${-days} ${days===-1?'day':'days'} ago`
}
const gmOriginalPanel=chartPanel
chartPanel=function(row){
  const panel=gmOriginalPanel(row),pill=panel.querySelector('.pill'),g=row.guidance
  panel.dataset.gmStatus=row.bucket
  // Move existing nodes, retaining the native why-dialog trigger and its listeners.
  panel.prepend(pill)
  if(['healthy','overstocked','no-sales'].includes(row.bucket))pill.lastElementChild.textContent='OK'
  panel.querySelector('.quantity-label').textContent='Order'
  const dates=[row.item.runout_day,g.delivery_date]
  for(const [i,stat] of [...panel.querySelectorAll('.date-stat')].entries()){
    if(!dates[i])continue
    const strong=stat.querySelector('strong');strong.textContent=gmDate(dates[i]);strong.dir='ltr'
    stat.append(node('small',gmRelative(dates[i]),'date-relative'))
  }
  const context=panel.querySelector('.context-row'),precision=node('p','Arrives estimates a new order. Receipt markers are monthly totals; exact day unavailable.','gm-precision')
  context.after(precision)
  return panel
}
const gmOriginalSvg=inventorySvg
inventorySvg=function(item,months,measuredWidth,window,cachedSeries,measuredHeight){
  const chart=gmOriginalSvg(item,months,measuredWidth,window,cachedSeries,measuredWidth<500?220:measuredHeight)
  const {svg,x,y,n,view,left,right,top,bottom,points,timeline}=chart
  const add=(tag,attrs,text)=>{const e=svgNode(tag,attrs,text);svg.append(e);return e}
  // Keep all axis values, but at most three horizontal rules.
  const grids=[...svg.querySelectorAll(':scope>line:not([data-now-divider])')]
  grids.forEach((line,i)=>{if(![0,Math.floor((grids.length-1)/2),grids.length-1].includes(i))line.remove()})
  svg.querySelectorAll('text').forEach(e=>e.setAttribute('font-size','12'))
  const stock=svg.querySelector('[data-inventory-line]'),past=[],future=[],boundary=x(n)
  // Split the existing geometric path at the snapshot. No series is recomputed.
  for(const match of stock.getAttribute('d').matchAll(/M([-\d.e+]+),([-\d.e+]+)L([-\d.e+]+),([-\d.e+]+)/g)){
    const [ax,ay,bx,by]=match.slice(1).map(Number),segment=`M${ax},${ay}L${bx},${by}`
    if(bx<=boundary)past.push(segment)
    else if(ax>=boundary)future.push(segment)
    else {const cy=ay+(by-ay)*(boundary-ax)/(bx-ax);past.push(`M${ax},${ay}L${boundary},${cy}`);future.push(`M${boundary},${cy}L${bx},${by}`)}
  }
  stock.setAttribute('d',future.join(' '));stock.setAttribute('stroke-width','2');stock.setAttribute('stroke-dasharray','5 4')
  const history=stock.cloneNode();history.removeAttribute('data-inventory-line');history.setAttribute('data-inventory-past','true');history.removeAttribute('stroke-dasharray');history.setAttribute('d',past.join(' '));stock.before(history)
  const now=svg.querySelector('[data-now-divider]')
  if(now){
    const caption=now.nextElementSibling
    // The snapshot boundary begins the forecast, not necessarily today's date.
    const [year,month,day]=currentToday.split('-').map(Number),[fy,fm]=item.projection[0].month.split('-').map(Number)
    const todayT=n+(year-fy)*12+month-fm+(day-1)/new Date(Date.UTC(year,month,0)).getUTCDate()
    if(todayT>=view.start&&todayT<=view.end){const nx=x(todayT);now.setAttribute('x1',nx);now.setAttribute('x2',nx);now.setAttribute('stroke','var(--ink)');now.setAttribute('stroke-width','1');caption.textContent='Today';caption.setAttribute('x',Math.max(left+20,Math.min(right-20,nx)))}
    else {now.remove();caption.remove()}
  }
  const placeText=(text,px,py,attributes={})=>{
    const e=add('text',{x:px,y:py,'font-size':12,fill:'var(--ink)',class:'gm-direct-label',...attributes},text)
    const width=e.getComputedTextLength?.()||text.length*7.5
    if(e.getAttribute('text-anchor')==='middle')e.setAttribute('x',Math.max(left+width/2,Math.min(right-width/2,px)))
    else e.setAttribute('x',Math.max(left,Math.min(right-width,px)))
    return e
  }
  const runout=svg.querySelector('[data-runout-label]')
  if(runout){runout.textContent=item.runout_day?`Runs out ${shortDate(item.runout_day)}`:'Runs out';runout.setAttribute('fill','var(--ink)');const width=runout.getComputedTextLength?.()||140;runout.setAttribute('x',Math.max(left+width/2,Math.min(right-width/2,Number(runout.getAttribute('x')))))}
  const occupied=[]
  for(const dot of svg.querySelectorAll('[data-delivery-marker]')){
    const cx=Number(dot.getAttribute('cx')),cy=Number(dot.getAttribute('cy')),r=5
    // Transform the circle itself so its existing pointer/focus/keyboard hooks survive.
    dot.setAttribute('r',0);dot.setAttribute('fill','var(--fine)');dot.setAttribute('stroke','var(--fine)');dot.setAttribute('stroke-width',0)
    const diamond=add('path',{d:`M${cx},${cy-r}L${cx+r},${cy}L${cx},${cy+r}L${cx-r},${cy}Z`,fill:'var(--fine)','pointer-events':'none','data-gm-delivery-diamond':true})
    dot.setAttribute('r',10);dot.setAttribute('fill','transparent');diamond.before(dot)
    const isPast=timeline.find(r=>r.month===dot.dataset.month)?.past
    const text=`${isPast?'Received':'Arrives'} ${label(dot.dataset.month)}`
    const labelNode=placeText(text,cx,top+16,{'text-anchor':'middle','data-gm-delivery-label':true})
    // SVG is detached during creation; use conservative glyph boxes, not getBBox().
    const width=text.length*7.5,px=Number(labelNode.getAttribute('x'));let py=top+16
    while(occupied.some(b=>px-width/2<b.right+8&&px+width/2+8>b.left&&Math.abs(py-b.y)<18))py+=20
    py=Math.min(bottom-20,py);labelNode.setAttribute('y',py)
    occupied.push({left:px-width/2,right:px+width/2,y:py})
    const leader=add('line',{x1:px,y1:py+4,x2:cx,y2:cy-8,stroke:'var(--rule)','stroke-width':1,'data-gm-leader':true})
    labelNode.before(leader)
  }
  const visiblePoints=points.filter(p=>p.t>=view.start&&p.t<=view.end)
  if(visiblePoints.length){const p=visiblePoints[0];placeText('Stock',x(p.t)+8,Math.max(top+14,Math.min(bottom-16,y(p.stock)-12)),{'data-gm-stock-label':true})}
  const bars=[...svg.querySelectorAll('[data-period]')]
  if(bars.length){const bar=bars.at(-1);placeText('Demand',Number(bar.getAttribute('x')),Math.max(top+14,Number(bar.getAttribute('y'))-12),{'data-gm-demand-label':true})}
  return chart
}
const gmOriginalRender=render
render=function(){const result=gmOriginalRender();gmSnapshotLabel();return result}
function gmSnapshotLabel(){const snapshot=$('snapshot');snapshot.replaceChildren(node('span',sourceName==='sample'?'Sample data':'Local CSV'),node('span',gmDate(data.as_of),'gm-snapshot-date'))}
gmSnapshotLabel()
// A3 has no language toggle. Logical properties prepare RTL without inventing a translation.
selectItem(rowMap.get(selectedSku),{hash:false})
