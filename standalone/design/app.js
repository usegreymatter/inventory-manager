const $ = id => document.getElementById(id)
const DESIGN = document.body.dataset.design
const STORAGE_KEY = 'stock-runway.standalone.order-settings.v1'
const THEME_KEY = 'stock-runway.standalone.theme.v1'
let settings = normalizeOrderSettings(DEFAULT_ORDER_SETTINGS)
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
  settings = normalizeOrderSettings({ ...DEFAULT_ORDER_SETTINGS, default_delivery_days:saved?.default_delivery_days, months_of_cover:saved?.months_of_cover, service_level:saved?.service_level, buffer_days:saved?.buffer_days })
} catch { $('storage-status').textContent = 'Settings storage is unavailable. Changes work for this visit.' }
let data = SAMPLE, sourceName = 'sample', readVersion = 0, currentRows = [], currentToday = '', selectedSku = null
const bucketNames = {order:'Order now', 'running-low':'Order soon', healthy:'Fine', overstocked:'Overstocked', 'no-sales':'No sales', 'needs-data':'Needs data'}
function localToday() { const now = new Date(); return `${String(now.getFullYear()).padStart(4,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` }
function node(tag,text,className) { const el = document.createElement(tag); if(text != null) el.textContent=text; if(className) el.className=className; return el }
function theme() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light') }
function syncTheme() { document.documentElement.dataset.effectiveTheme=theme(); $('theme-toggle').setAttribute('aria-label',`Switch to ${theme()==='dark'?'light':'dark'} theme`); $('theme-toggle').setAttribute('aria-pressed',String(theme()==='dark')) }
try { const saved=localStorage.getItem(THEME_KEY); if(['light','dark'].includes(saved)) document.documentElement.dataset.theme=saved } catch { /* System theme remains usable without storage. */ }
syncTheme()
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',syncTheme)
$('theme-toggle').addEventListener('click',()=>{ const next=theme()==='dark'?'light':'dark'; document.documentElement.dataset.theme=next; try {localStorage.setItem(THEME_KEY,next)}catch{} syncTheme() })
$('load-file').addEventListener('click',()=>{ $('file-panel').open=true; $('file-panel').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'}); $('csv-file').focus() })
$('design-label').textContent=DESIGN==='option-a'?'01 / Hero chart':'02 / Chart rows'
function statusNode(row) { const s=node('span',row.guidance.out_of_stock?'Out of stock':bucketNames[row.bucket],'status'); s.dataset.bucket=row.bucket; s.dataset.out=String(Boolean(row.guidance.out_of_stock)); return s }
function answerText({item,guidance}) { return guidance.status==='needs-data'?'Not enough history':guidance.quantity>0?`${guidance.out_of_stock?'Out of stock — ':''}${orderSentence(item,guidance)}`:noOrderSentence(item,guidance) }
function quantityNode(row,big=false) { const q=node('div',null,big?'big-order':'list-quantity'); if(big)q.append(node('span','Suggested order','eyebrow')); q.append(node('span',row.guidance.quantity>0?orderAmount(row.guidance.quantity):'—',big?'number':null),node(big?'span':'small',row.guidance.quantity>0?(big?row.item.unit:`${row.item.unit} ${['order','running-low'].includes(row.bucket)?'to order':'later'}`):row.guidance.status==='needs-data'?'Needs data':row.guidance.supply_gap?'Check delivery':'No new order',big?'meta':null)); return q }
function chartDetails(row) {
  const {item,guidance}=row, details=node('details',null,'planning-details'); details.append(node('summary','Stock & planning details')); const body=node('div',null,'detail-body')
  if(item.held || guidance.status==='needs-data') body.append(node('p',guidance.reason||item.reason||'Check item data.'))
  else { const stats=historyStats(data.months,item.monthly_sales); body.append(node('p',`Stock: ${stockCell(item.on_hand)} ${item.unit} · On order: ${item.on_order==null?'unknown':orderAmount(item.on_order)+' '+item.unit}`),node('p',`Safety stock: ${guidance.safety_stock==null?'unavailable':orderAmount(guidance.safety_stock)} · Reorder point: ${guidance.reorder_point==null?'unavailable':orderAmount(guidance.reorder_point)}`),node('p',`${stats.count} months · average sales ${orderAmount(stats.average)} ${item.unit}/month. ${item.grade}. ${item.forecast_explanation}.`)) }
  details.append(body); return details
}
function chartPanel(row) {
  const {item,guidance}=row, panel=node('div',null,'chart-panel'); panel.dataset.sku=item.sku
  const head=node('div',null,'chart-heading'), names=node('div'); names.append(statusNode(row),node('h2',item.name),node('p',item.sku,'meta')); head.append(names,quantityNode(row,true)); panel.append(head)
  if(item.held || guidance.status==='needs-data') panel.append(node('p',guidance.reason||item.reason,'empty'))
  else {
    panel.append(fullChart(row),node('p',answerText(row),'guidance answer'))
    const short=shortageSentence(item,guidance); if(short)panel.append(node('p',short,'warning'))
    if(guidance.used_default_lead)panel.append(node('p',`Assumes ${guidance.lead_days}-day delivery · change in settings`,'warning'))
    const big=bigOrderWarning(guidance,settings);if(big)panel.append(node('p',big,'warning'))
    const hist=inventoryHistory(item,data.months); if(hist.warning)panel.append(node('p',hist.warning,'warning'))
  }
  panel.append(chartDetails(row)); return panel
}
function selectItem(row) { selectedSku=row.item.sku; $('hero').replaceChildren(chartPanel(row)); document.querySelectorAll('.item-select').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.sku===selectedSku))); cleanupCharts() }
function itemNode(row) {
  if(DESIGN==='option-b') {
    const details=node('details',null,'chart-row order-row');details.dataset.sku=row.item.sku
    const summary=node('summary'),label=node('div',null,'row-label');label.append(node('p',row.item.name,'product'),statusNode(row));const end=node('div',null,'row-end');end.append(quantityNode(row),node('span','View chart +','expand-hint'))
    const mini=node('div',null,'mini-chart');mini.append(makeChart(row));summary.append(label,mini,end);details.append(summary)
    const expanded=node('div',null,'expanded-chart');details.append(expanded)
    // Keep the exact conditional wording accessible before expansion, too.
    const answer=node('p',answerText(row),'answer');answer.hidden=true;details.append(answer)
    details.addEventListener('toggle',()=>{end.querySelector('.expand-hint').textContent=details.open?'Close chart −':'View chart +';if(details.open&&!expanded.children.length)expanded.append(chartPanel(row))})
    return details
  }
  const button=node('button',null,'item-select order-row');button.type='button';button.dataset.sku=row.item.sku;button.setAttribute('aria-pressed',String(selectedSku===row.item.sku));button.append(node('p',row.item.name,'product'),statusNode(row),quantityNode(row),node('span',answerText(row),'answer'));button.addEventListener('click',()=>selectItem(row));return button
}
// All series use existing core outputs. Only coordinates and axis layout are new.
/* STOCK_RUNWAY_CHART_DATA_START */
function chartData(row) {
  const {item,guidance}=row;if(item.held || guidance.status==='needs-data')return null
  const months=data.months,history=inventoryHistory(item,months),n=months.length,rows=item.projection,{crossing}=stockPath(item)
  const past=history.rows.length?history.rows.map((r,i)=>({t:i+1,stock:r.stock,month:months[i],kind:'Past stock'})):months.map((month,i)=>({t:i+.5,stock:item.monthly_sales[i],month,kind:'Past sales'}))
  const future=[{t:n,stock:item.stock,month:data.as_of.slice(0,7),kind:'Snapshot stock'}]
  rows.forEach((r,i)=>{if(crossing&&crossing.month>i&&crossing.month<i+1)future.push({t:n+crossing.month,stock:0,month:r.month,kind:'Run out'});future.push({t:n+i+1,stock:Math.max(0,r.stock),month:r.month,kind:'Forecast stock'})})
  const threshold=guidance.reorder_point ?? guidance.safety_stock
  let peak=Math.max(1,item.stock,threshold||0);for(const p of [...past,...future])peak=Math.max(peak,p.stock);for(const r of rows)peak=Math.max(peak,r.demand,r.receipts||0);for(const r of history.rows)peak=Math.max(peak,r.delivered||0)
  const step=Math.max(1,niceStep(peak*1.1/4)),max=Math.max(4*step,Math.ceil(peak*1.1/step)*step)
  const orderDate=guidance.order_by==='now'?currentToday:guidance.order_by
  const monthPosition=date=>{if(!date)return null;const [y,m,d]=date.split('-').map(Number),[fy,fm]=rows[0].month.split('-').map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate();return n+(y-fy)*12+m-fm+(d-1)/days}
  return {past,future,n,slots:n+rows.length,crossing,threshold,max,step,orderT:monthPosition(orderDate),orderDate,history}
}
/* STOCK_RUNWAY_CHART_DATA_END */
function shortDate(date) { return new Date(date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}) }
function svgNode(tag,attrs={},text) {const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))if(v!=null)e.setAttribute(k,String(v));if(text!=null)e.textContent=text;return e}
const chartObservers=new Set()
function makeChart(row) {
  const wrap=node('div',null,'mini-wrap'),series=chartData(row)
  if(!series){wrap.append(node('p','Chart unavailable · check item data','meta'));return wrap}
  let lastWidth=0
  const draw=()=>{
    const width=Math.round(wrap.getBoundingClientRect().width);if(width<50||width===lastWidth)return;lastWidth=width
    const W=width,H=96,left=4,right=W-4,top=25,bottom=69,{past,future,n,slots,crossing,max,orderT}=series
    const x=t=>left+t*(right-left)/slots,y=v=>bottom-Math.max(0,v)/max*(bottom-top)
    const svg=svgNode('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`${row.item.name}: ${series.history.rows.length?'past stock':'stock history unavailable'} and forecast stock in ${row.item.unit}. Expand for supply, demand and inventory.`})
    const line=attrs=>svg.append(svgNode('line',attrs)),txt=(attrs,text)=>svg.append(svgNode('text',{fill:'var(--muted)','font-size':11,...attrs},text))
    line({x1:left,x2:right,y1:bottom,y2:bottom,stroke:'var(--line)'})
    line({x1:x(n),x2:x(n),y1:top,y2:bottom,stroke:'var(--history)','stroke-width':1,'stroke-dasharray':'2 5'})
    const path=points=>points.map((p,i)=>`${i?'L':'M'}${x(p.t).toFixed(2)} ${y(p.stock).toFixed(2)}`).join(' ')
    if(series.history.rows.length)svg.append(svgNode('path',{d:path(past),class:'history-line'}))
    svg.append(svgNode('path',{d:path(future),class:'forecast-line',pathLength:1}))
    if(orderT!=null){const ox=x(Math.max(0,Math.min(slots,orderT)));line({x1:ox,x2:ox,y1:top+9,y2:bottom,stroke:'var(--amber)','stroke-width':1,'stroke-dasharray':'3 4'});svg.append(svgNode('circle',{cx:ox,cy:top+9,r:3,fill:'var(--amber)'}));txt({x:Math.max(left+65,Math.min(right-65,ox)),y:12,'text-anchor':'middle'},row.guidance.order_by==='now'?'Order now':`Order by ${shortDate(series.orderDate)}`)}
    if(crossing){const cx=x(n+crossing.month);svg.append(svgNode('circle',{'data-runout':true,cx,cy:bottom,r:3,fill:'var(--red)'}));txt({x:Math.max(left+22,Math.min(right-24,cx+8)),y:bottom-9,class:'marker-label','text-anchor':cx>right-60?'end':'start'},row.guidance.out_of_stock?'Out':`Run out ${row.item.runout_day?shortDate(row.item.runout_day):label(crossing.label).split(' ')[0]}`)}
    else txt({x:right,y:bottom-8,class:'marker-label','text-anchor':'end'},'No run-out in 6 mo')
    const stride=Math.max(1,Math.ceil(slots*90/(right-left))),timeline=[...data.months,...row.item.projection.map(r=>r.month)]
    for(let i=0;i<slots;i++)if(i%stride===0)txt({x:i===0?left:x(i+.5),y:bottom+22,'text-anchor':i===0?'start':'middle'},label(timeline[i]).replace('20','’'))
    wrap.replaceChildren(svg)
  }
  const observer=new ResizeObserver(draw);observer.observe(wrap);chartObservers.add({observer,wrap});requestAnimationFrame(draw);return wrap
}
function cleanupCharts(){for(const entry of chartObservers)if(!entry.wrap.isConnected){entry.observer.disconnect();chartObservers.delete(entry)}}
function render() {
  currentToday=localToday();currentRows=standaloneRows(data,currentToday,settings)
  const orders=attentionRows(currentRows),others=currentRows.filter(r=>!['order','running-low'].includes(r.bucket))
  if(!currentRows.some(r=>r.item.sku===selectedSku))selectedSku=(orders[0]||currentRows[0])?.item.sku
  $('orders').replaceChildren(...orders.map(itemNode));$('others').replaceChildren(...others.map(itemNode))
  if(!orders.length)$('orders').append(node('p','Nothing to order today','empty'))
  $('order-count').textContent=`${orders.length} items`;$('other-count').textContent=`${others.length} items`
  if(DESIGN==='option-a'){const selected=currentRows.find(r=>r.item.sku===selectedSku);$('hero').replaceChildren(...(selected?[chartPanel(selected)]:[node('p','Load a stock CSV to begin','empty')]))}
  $('snapshot').textContent=`${sourceName==='sample'?'Sample data':'Local CSV'} · stock ${formatDate(data.as_of)} · decisions ${formatDate(currentToday)}`
  const age=salesDataAge(data.months,currentToday);$('stale-warning').hidden=!(age>45);$('stale-warning').textContent=`Sales end ${label(data.months.at(-1))} · ${age} days old; load a newer file`
  const unknown=data.items.some(item=>!Object.hasOwn(item,'on_order'));$('incoming-warning').hidden=!unknown;$('incoming-warning').textContent='Incoming unknown · assumes none for those items; check before ordering'
  $('history-warning').hidden=data.months.length>=6;$('history-warning').textContent=`Only ${data.months.length} months of sales · rough estimate`
  $('sample').hidden=sourceName==='sample';$('copy-po').disabled=!orders.some(r=>r.guidance.quantity>0);$('copy-status').textContent='';$('copy-fallback').hidden=true;$('po-text').value='';cleanupCharts()
}
function syncSettings() {
  $('delivery-days').value = settings.default_delivery_days ?? ''
  $('cover-months').value = settings.months_of_cover
  $('buffer-days').value = settings.buffer_days
  $('service-level').value = settings.service_level
}
function saveSettings(next) {
  settings = normalizeOrderSettings(next)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); $('storage-status').textContent = 'Settings saved on this device. Your CSV is not saved.' }
  catch { $('storage-status').textContent = 'Settings could not be saved. Changes still work for this visit.' }
  render()
}
for (const [id, key, min, max, integer] of [ ['delivery-days', 'default_delivery_days', 1, 3650, true], ['cover-months', 'months_of_cover', 0, 36, false], ['buffer-days', 'buffer_days', 0, 3650, true] ]) {
  $(id).addEventListener('input', () => {
    const raw = $(id).value.trim(), value = raw === '' ? null : Number(raw)
    const valid = !$(id).validity.badInput && (value === null ? key === 'default_delivery_days' : Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)))
    $(id).setAttribute('aria-invalid', String(!valid))
    $('settings-error').hidden = valid
    $('settings-error').textContent = valid ? '' : `Enter ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}. The previous setting is still used.`
    if (valid) saveSettings({ ...settings, [key]: value })
  })
}
$('service-level').addEventListener('change', event => saveSettings({ ...settings, service_level: Number(event.target.value) }))
$('reset-settings').addEventListener('click', () => {
  saveSettings(DEFAULT_ORDER_SETTINGS); syncSettings(); $('settings-error').hidden = true
  for (const id of ['delivery-days', 'cover-months', 'buffer-days']) $(id).removeAttribute('aria-invalid')
})
async function readCsv(file) {
  if (!file) return
  const version = ++readVersion
  cancelStockImport()
  $('file-error').hidden = true
  $('source-status').textContent = `Reading ${file.name}…`
  try {
    const loaded = await loadStockImport(file,()=>version===readVersion)
    if (version !== readVersion) return
    if (!loaded) {
      $('source-status').textContent=sourceName==='sample'?'Still using built-in sample data.':'Still using '+sourceName+'.'
      return
    }
    const parsed = loaded.parsed
    if (version !== readVersion) return
    if (!loaded.smart && typeof confirmStockImport === 'function' && !await confirmStockImport(parsed,file)) return
    if (version !== readVersion) return
    evaluateDataset(parsed, 6, settings) // Validate before replacing the last good dataset.
    data = parsed; sourceName = file.name; render()
    $('source-status').textContent = `Using ${file.name} · ${parsed.items.length} items. File stays on this device and is not saved.`
    stockImportStatus(loaded,file)
  } catch (error) {
    if (version !== readVersion) return
    $('file-error').textContent = `${error instanceof CsvError ? error.message : 'Could not read or calculate this CSV. Check its data or choose another file.'} Previous data is unchanged.`
    $('file-error').hidden = false
    $('source-status').textContent = sourceName === 'sample' ? 'Still using built-in sample data.' : `Still using ${sourceName}.`
  } finally { if (version === readVersion) $('csv-file').value = '' }
}
$('csv-file').addEventListener('change', event => readCsv(event.target.files[0]))
const dropzone = $('dropzone')
for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('dragging') })
for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('dragging') })
dropzone.addEventListener('drop', event => readCsv(event.dataTransfer.files[0]))
// Prevent accidental navigation if a file is dropped outside the zone.
for (const type of ['dragover', 'drop']) document.addEventListener(type, event => event.preventDefault())
$('sample').addEventListener('click', () => {
  cancelStockImport(); readVersion++; data = SAMPLE; sourceName = 'sample'; render()
  $('file-error').hidden = true; $('csv-file').value = ''
  $('source-status').textContent = 'Using built-in sample data · synthetic, not real stock.'
})
$('copy-po').addEventListener('click', async () => {
  const text = purchaseOrderText(attentionRows(currentRows), currentToday)
  try {
    if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable')
    await navigator.clipboard.writeText(text)
    $('copy-status').textContent = 'Copied — ready to paste into WhatsApp or a supplier message.'
  } catch {
    $('copy-fallback').hidden = false; $('po-text').value = text
    $('po-text').focus(); $('po-text').select()
    $('copy-status').textContent = 'Automatic copy is unavailable. Copy the selected text below.'
  }
})
$('select-po').addEventListener('click', () => { $('po-text').focus(); $('po-text').select() })
// Re-evaluate today's local date after an offline tab has been left open overnight.
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentToday !== localToday()) render() })
syncSettings(); render()
