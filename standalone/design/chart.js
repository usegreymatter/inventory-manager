/* STOCK_RUNWAY_FULL_CHART_START */
// Faithful vanilla port of Desktop Chart. Data choices and geometry stay paired
// with desktop/plugin.js; tests compare rendered bars, points and SVG geometry.
function axisUnit(unit) {
  const labels = { m: 'Metres', 'm²': 'Square metres', m2: 'Square metres', kg: 'Kilograms',
    g: 'Grams', l: 'Litres', ml: 'Millilitres', units: 'Units', unit: 'Units', ea: 'Units' }
  const key = unit.trim().toLowerCase()
  return Object.hasOwn(labels, key) ? labels[key] : 'Units'
}
function inventorySvg(item, months, measuredWidth) {
  const width = Math.max(200, measuredWidth), n = months.length
  const history = inventoryHistory(item, months)
  const rows = item.projection, slots = n + rows.length
  const { crossing } = stockPath(item)
  const timeline = [...months.map((month, i) => ({ month, demand: item.monthly_sales[i], receipts: history.rows[i]?.delivered ?? 0, past: true })), ...rows]
  let peak = Math.max(1, item.stock)
  for (const row of timeline) peak = Math.max(peak, row.demand, row.receipts || 0)
  for (const row of history.rows) peak = Math.max(peak, row.stock)
  for (const row of rows) peak = Math.max(peak, row.stock)
  peak *= 1.1
  const step = Math.max(1, niceStep(peak / 4)), max = Math.max(4 * step, Math.ceil(peak / step) * step)
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const left = ticks.reduce((longest, v) => Math.max(longest, tickLabel(v).length), 0) * 7 + 16, right = width - 18, top = 46
  const bottom = top + Math.max(230, (right - left) / 2), height = bottom + 46
  const x = month => left + month * (right - left) / slots
  const y = value => bottom - Math.max(0, value) / max * (bottom - top)
  const futureX = month => x(n + month)
  const barWidth = (right - left) / slots * 0.34
  const stride = Math.max(1, Math.ceil(slots * 60 / (right - left)))
  const points = history.rows.map((r, i) => ({ x: x(i + 1), stock: r.stock }))
  const roundedStart = history.rows.length > 0 && item.on_hand !== item.stock
  if (!history.rows.length || roundedStart) points.push({ x: x(n), stock: item.stock })
  rows.forEach((row, i) => {
    if (crossing && crossing.month > i && crossing.month < i + 1) points.push({ x: futureX(crossing.month), stock: 0 })
    points.push({ x: futureX(i + 1), stock: Math.max(0, row.stock) })
  })
  const crossingLabel = item.on_hand === 0 ? 'Out of stock' : crossing ? `Runs out ${label(crossing.label).split(' ')[0]}` : null
  const shortSegments = points.slice(1).map((p, i) => ({ p, prev: points[i] })).filter(({p, prev}) => p.x > x(n) && p.stock === 0 && prev.stock === 0)
  const asOfLabel = new Date(Date.parse(`${rows[0].month}-01T00:00:00Z`) - 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const historyStatus = history.warning ? `Historical inventory and deliveries unknown or incomplete. ${history.warning}`
    : history.rows.length ? 'Historical inventory reconstructed from deliveries and sales.'
      : 'Historical inventory and deliveries unknown; delivery history is unavailable.'
  const svg = svgNode('svg', {role:'img', 'data-chart':'supply-demand-inventory', tabindex:0, viewBox:`0 0 ${width} ${height}`, width:'100%', height,
    'aria-label':`Supply, demand and inventory: past sold and deliveries, future forecast demand and listed receipts; ${historyStatus}. As of ${asOfLabel}. Unit: ${item.unit}. Use left and right arrows to explore months.`})
  const add = (tag, attrs, text) => { const el=svgNode(tag,attrs,text); svg.append(el); return el }
  add('path', {'data-forecast-region':true, d:`M${x(n)} ${top}H${right}V${bottom}H${x(n)}Z`, fill:'var(--ink)', opacity:.06})
  for (const value of ticks) {
    add('line', {x1:left,x2:right,y1:y(value),y2:y(value),stroke:'var(--line)','stroke-width':value===0?1.5:1})
    add('text', {x:left-8,y:y(value)+4,'text-anchor':'end',fill:'var(--muted)','font-size':12},tickLabel(value))
  }
  timeline.forEach((row,i) => {
    add('rect', {'data-period':row.past?'sold':'forecast','data-month':row.month,'data-value':row.demand,
      x:x(i+.5)-barWidth,y:y(row.demand),width:barWidth,height:bottom-y(row.demand),opacity:1,
      fill:row.past?'var(--accent)':'var(--bg)',stroke:row.past?'none':'var(--muted)','stroke-width':1})
    add('rect', {'data-period':'supply','data-month':row.month,'data-value':row.receipts||0,
      x:x(i+.5),y:y(row.receipts||0),width:barWidth,height:bottom-y(row.receipts||0),fill:'var(--supply)',opacity:1})
  })
  add('line', {'data-now-divider':true,x1:x(n),x2:x(n),y1:top,y2:bottom,stroke:'var(--muted)','stroke-width':1.5,'stroke-dasharray':'5 5'})
  add('text', {x:x(n),y:36,'text-anchor':'middle',fill:'var(--ink)','font-size':11,'font-weight':600},'Now')
  add('polyline', {'data-inventory-line':true,class:'inventory-line',pathLength:1,points:points.map(p=>`${p.x},${y(p.stock)}`).join(' '),fill:'none',stroke:'var(--ink)','stroke-width':2.5,'stroke-linejoin':'round'})
  for (const {p,prev} of shortSegments) add('line', {'data-short':true,x1:prev.x,x2:p.x,y1:bottom,y2:bottom,stroke:'var(--red)','stroke-width':3,'stroke-dasharray':'2 5'})
  history.rows.forEach((row,i) => add('circle', {'data-inventory-dot':true,'data-month':months[i],cx:x(i+1),cy:y(row.stock),r:2.5,fill:'var(--ink)'}))
  rows.forEach((row,i) => add('circle', {'data-inventory-dot':true,'data-month':row.month,cx:futureX(i+1),cy:y(row.stock),r:2.5,fill:'var(--ink)'}))
  timeline.forEach((row,i) => {if(i%stride===0)add('text', {x:x(i+.5),y:bottom+23,'text-anchor':'middle','font-size':10,fill:'var(--muted)'},label(row.month))})
  add('text', {'data-axis-unit':true,x:left,y:13,fill:'var(--muted)','font-size':12},axisUnit(item.unit))
  if(crossing) {
    add('circle', {'data-runout':true,cx:futureX(crossing.month),cy:bottom,r:4,fill:'var(--red)',stroke:'var(--ink)'})
    add('text', {'data-runout-label':true,x:Math.max(left,Math.min(right-crossingLabel.length*7,futureX(crossing.month)+7)),y:bottom-34,fill:'var(--ink)','font-size':12,'font-weight':600,class:'marker-label'},crossingLabel)
    if(shortSegments.length)add('text', {x:right-4,y:bottom-10,'text-anchor':'end',fill:'var(--red)','font-size':12,class:'marker-label'},'Out of stock')
  }
  return {svg, timeline, history, rows, points, roundedStart, x, y, n, slots, left, right, top, bottom, width, height}
}
function fullChart(row) {
  const {item}=row, figure=node('figure',null,'inventory-figure'), wrap=node('div',null,'chart-wrap')
  figure.append(node('h3','Supply, demand and inventory'),wrap)
  const legend=node('figcaption',null,'legend inventory-legend')
  for (const [text,cls] of [['Past demand','past-demand'],['Forecast demand','forecast-demand'],['Deliveries','deliveries'],['Stock on hand','stock-on-hand']]) {
    const span=node('span',text), key=node('i',null,cls);span.prepend(key);legend.append(span)
  }
  figure.append(legend,node('p','Dots show month-end stock · left of Now: history; right: forecast.','chart-note'))
  const about=node('details',null,'about-chart');about.append(node('summary','About this chart'))
  const body=node('div',null,'detail-body'), history=inventoryHistory(item,data.months)
  body.append(node('p',`${item.forecast_explanation || SEASONAL_REASON}.${item.seasonal?' Seasonal factors are limited to 0.5–2 times average demand because one year is noisy.':''}`))
  if(history.rows.length>0&&item.on_hand!==item.stock)body.append(node('p',`History ends at exact stock (${format(item.on_hand)} ${item.unit}). Forecast starts from rounded-down stock (${format(item.stock)} ${item.unit}) at Now.`))
  body.append(node('p',`Now is the stock snapshot (${formatDate(data.as_of)}), not today's date. Forecast excludes the suggested new order.`));about.append(body);figure.append(about)
  let lastWidth=0
  const draw=()=>{
    const width=Math.round(wrap.getBoundingClientRect().width);if(width<50||width===lastWidth)return;lastWidth=width
    const chart=inventorySvg(item,data.months,width),{svg,timeline,history,rows,x,y,n,slots,left,right,top,bottom}=chart
    wrap.replaceChildren(svg)
    const cross=svgNode('g',{class:'crosshair',visibility:'hidden'}), line=svgNode('line',{x1:0,x2:0,y1:top,y2:bottom,stroke:'var(--ink)','stroke-width':1,'stroke-dasharray':'2 3'}),dot=svgNode('circle',{cx:0,cy:0,r:4,fill:'var(--accent)',stroke:'var(--bg)','stroke-width':2})
    cross.append(line,dot);svg.append(cross)
    const tooltip=node('div',null,'chart-tooltip inventory-tooltip');tooltip.hidden=true;tooltip.setAttribute('role','status');wrap.append(tooltip)
    let index=n-1
    const show=i=>{
      index=Math.max(0,Math.min(timeline.length-1,i));const month=timeline[index],stock=index<n?history.rows[index]?.raw_stock:rows[index-n].stock,px=x(index+1),py=stock==null?top:y(stock)
      cross.setAttribute('visibility','visible');cross.setAttribute('transform',`translate(${px} 0)`);dot.setAttribute('cy',py);dot.setAttribute('r',stock==null?0:4)
      tooltip.replaceChildren(node('strong',label(month.month)),node('span',`${month.past?'Demand':'Forecast demand'}  ${orderAmount(month.demand)} ${item.unit}`),node('span',`Deliveries  ${orderAmount(month.receipts||0)} ${item.unit}`),node('span',`Stock  ${stock==null?'Unknown':stockCell(stock)+' '+item.unit}`));tooltip.hidden=false
      const tw=tooltip.offsetWidth,th=tooltip.offsetHeight;tooltip.style.left=`${Math.max(0,Math.min(width-tw,px+12))}px`;tooltip.style.top=`${py<top+th?Math.min(bottom-th,py+18):Math.max(0,py-th-16)}px`
    }
    const point=e=>show(Math.floor((e.clientX-svg.getBoundingClientRect().left-left)/(right-left)*slots))
    svg.addEventListener('pointermove',point);svg.addEventListener('pointerdown',point)
    const hide=()=>{tooltip.hidden=true;cross.setAttribute('visibility','hidden')}
    svg.addEventListener('pointerleave',hide);svg.addEventListener('blur',hide)
    svg.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape')hide();else show(index+(e.key==='ArrowRight'?1:-1))}})
  }
  const observer=new ResizeObserver(draw);observer.observe(wrap);chartObservers.add({observer,wrap});requestAnimationFrame(draw)
  return figure
}
/* STOCK_RUNWAY_FULL_CHART_END */
