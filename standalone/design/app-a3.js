// Lifecycle: living. A3 presentation and navigation; core and helpers unchanged.
const $ = id => document.getElementById(id)
const STORAGE_KEY = 'stock-runway.standalone.order-settings.v1'
const A3_DATE_SUFFIX = 'T00:00:00Z', A3_TIMEZONE = 'UTC', A3_SKU_HASH = '#sku='
let settings = normalizeOrderSettings(DEFAULT_ORDER_SETTINGS)
try {
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY))
  settings=normalizeOrderSettings({...DEFAULT_ORDER_SETTINGS,default_delivery_days:saved?.default_delivery_days,months_of_cover:saved?.months_of_cover,service_level:saved?.service_level,buffer_days:saved?.buffer_days})
} catch { $('storage-status').textContent=STRINGS.settings_storage_is_unavailable_Changes_wo }
let data=SAMPLE,sourceName='sample',readVersion=0,currentRows=[],currentToday='',selectedSku=null,filteredRows=[]
let healthWarnings=[]
let rowMap=new Map(),buttonMap=new Map(),seriesCache=new WeakMap(),activeButton=null
// Retain one memo for the loaded immutable snapshot, not for the lifetime of
// the tab. Dataset/date/order or learning inputs replace it atomically.
let evaluationSnapshot=null
// Replay persisted toggles/owner decisions/prior factors before keying: a log
// update (even in place) must not leave a previously ready snapshot in use.
// Include source contents: synthetic edits and host integrations can update an
// existing dataset in place. Identity alone would keep stale standard guidance
// until an unrelated setting (such as the profit display toggle) forced a refit.
function evaluationSnapshotKey(){return JSON.stringify([localToday(),settings,learningSettingsFromLog(data,learningSettings,learningLog),data])}
function withDatasetEvaluation(fn){
  const key=evaluationSnapshotKey()
  if(!evaluationSnapshot||evaluationSnapshot.data!==data||evaluationSnapshot.key!==key||evaluationSnapshot.diary!==learningDiary||evaluationSnapshot.log!==learningLog)
    evaluationSnapshot={data,key,diary:learningDiary,log:learningLog,memo:new Map(),ready:false,health:null}
  return withEvaluationPass(fn,evaluationSnapshot.memo)
}
function finishEvaluationSnapshot(){
  Object.assign(evaluationSnapshot,{key:evaluationSnapshotKey(),diary:learningDiary,log:learningLog,ready:true})
}
const bucketNames={order:STRINGS.order_now,'running-low':STRINGS.soon,healthy:STRINGS.fine,overstocked:STRINGS.overstock,'no-sales':STRINGS.no_sales,'needs-data':STRINGS.needs_data}
const browseGroups=[['order',STRINGS.order_now],['running-low',STRINGS.soon],['ok',STRINGS.oK],['needs-data',STRINGS.needs_data]]
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function node(tag,text,className){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el}
function shortDate(date){return new Date(date+A3_DATE_SUFFIX).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:A3_TIMEZONE})}
function svgNode(tag,attrs={},text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))if(v!=null)e.setAttribute(k,String(v));if(text!=null)e.textContent=text;return e}
const chartObservers=new Set()
function cleanupCharts(){for(const entry of chartObservers)if(!entry.wrap.isConnected){entry.observer.disconnect();chartObservers.delete(entry)}}
function seriesFor(item){if(!seriesCache.has(item))seriesCache.set(item,a2Series(item,data.months));return seriesCache.get(item)}
function hashSku(){return new URLSearchParams(location.hash.slice(1)).get('sku')}
function groupFor(row){return ['order','running-low','needs-data'].includes(row.bucket)?row.bucket:'ok'}
function warning(label,text){const d=node('details',null,'warning-detail');const s=node('summary',STRINGS.copy+label);s.title=text;d.append(s,node('p',text));return d}
function itemInputWarnings(item){
  if(!item.input_warnings?.length)return null
  const section=node('section',null,'item-input-warnings');section.dataset.itemInputWarnings=item.sku;section.setAttribute('aria-label',S('inputWarningsFor',{sku:item.sku}))
  section.append(node('strong',STRINGS.checkBeforeOrdering))
  for(const text of item.input_warnings)section.append(node('p',text))
  return section
}
function stat(label,value){const e=node('div',null,'date-stat');e.append(node('span',label),node('strong',value));return e}
function chartPanel(row){
  const {item,guidance:g}=row,panel=node('div');panel.dataset.sku=item.sku
  const heading=node('div',null,'product-heading');heading.append(node('h1',item.name),node('p',item.sku,'product-code'));panel.append(heading)
  const decision=node('div',null,'decision'),amount=node('div'),big=node('button',g.status==='needs-data'?STRINGS.copy_7:orderAmount(g.quantity),'big-number')
  big.type='button';big.disabled=false;big.setAttribute('aria-haspopup','dialog');big.setAttribute('aria-label',S('whyAria',{qty:g.quantity??STRINGS.unknown,unit:item.unit}));big.addEventListener('click',()=>openWhy(row,big))
  big.dataset.long=String((big.textContent||'').length>10)
  big.append(node('small',g.status==='needs-data'?'':item.unit));amount.append(node('p',STRINGS.suggested_order,'quantity-label'),big)
  const pill=node('span',null,'pill');pill.dataset.bucket=row.bucket;pill.append(node('i',null,'dot'),node('span',g.out_of_stock?STRINGS.out_of_stock:g.quantity===0&&g.supply_gap?STRINGS.check_delivery:bucketNames[row.bucket]));amount.append(pill)
  const dates=node('div',null,'dates');dates.append(stat(STRINGS.runs_out,item.runout_day?shortDate(item.runout_day):g.status==='needs-data'?STRINGS.unknown:'6M+'),stat(STRINGS.arrives,g.delivery_date?label(g.delivery_date.slice(0,7)):STRINGS.unknown));decision.append(amount,dates);panel.append(decision);const inputWarnings=itemInputWarnings(item);if(inputWarnings)panel.append(inputWarnings)
  const section=node('div',null,'chart-section'),card=node('div',null,'chart-card')
  if(item.held||g.status==='needs-data')card.append(node('p',STRINGS.needs_data,'empty'))
  else card.append(fullChart(row))
  section.append(card)
  const context=node('div',null,'context-row'),age=salesDataAge(data.months,currentToday)
  if(age>45)context.append(warning(STRINGS.older_sales,S('sales_end_v0_v1_days_old_Load_a_newer_file',{v0:(label(data.months.at(-1))),v1:(age)})))
  if(!Object.hasOwn(item,'on_order'))context.append(warning(STRINGS.incoming_unknown,STRINGS.incoming_stock_is_unknown_the_calculation_))
  if(g.used_default_lead)context.append(warning(STRINGS.default_delivery,S('assumes_v0_day_delivery_Change_the_default',{v0:(g.lead_days)})))
  if(data.months.length<6)context.append(warning(STRINGS.short_history,S('only_v0_full_sales_months_This_is_a_rough_',{v0:(data.months.length)})))
  const shortage=shortageSentence(item,g);if(g.supply_gap)context.append(warning(STRINGS.supply_gap,shortage||S('stock_may_be_unavailable_v0_No_confirmed_r',{v0:(g.gap_date?STRINGS.from+formatDate(g.gap_date):'')})))
  const large=bigOrderWarning(g,settings);if(large)context.append(warning(STRINGS.large_order,large))
  const history=item.held||g.status==='needs-data'?null:seriesFor(item).history
  if(history?.warning)context.append(warning(STRINGS.stock_history,history.warning))
  const about=node('details',null,'about'),summary=node('summary',STRINGS.copy_8);summary.setAttribute('aria-label',STRINGS.about_chart_and_assumptions);about.append(summary)
  const body=node('div',null,'detail-body')
  if(sourceName==='sample')body.append(node('p',data.note))
  body.append(node('p',g.status==='needs-data'?g.reason||item.reason||STRINGS.check_item_data:g.quantity>0?orderSentence(item,g):noOrderSentence(item,g)),node('p',STRINGS.demand_bars_past_solid_forecast_lighter_St),node('p',S('stock_snapshot_v0_Decision_date_v1_Forecas',{v0:(formatDate(data.as_of)),v1:(formatDate(currentToday))})))
  if(!item.held&&g.status!=='needs-data'){
    body.append(node('p',S('stock_v0_v1_On_order_v2_Safety_stock_v3_Re',{v0:(stockCell(item.on_hand)),v1:(item.unit),v2:(item.on_order==null?STRINGS.unknown_9:orderAmount(item.on_order)),v3:(g.safety_stock==null?STRINGS.unknown_9:orderAmount(g.safety_stock)),v4:(g.reorder_point==null?STRINGS.unknown_9:orderAmount(g.reorder_point))})),node('p',`${item.grade}. ${item.forecast_explanation||SEASONAL_REASON}`))
    if(seriesFor(item).roundedStart)body.append(node('p',S('historical_stock_ends_at_v0_v1_forecast_st',{v0:(stockCell(item.on_hand)),v1:(item.unit),v2:(stockCell(item.stock))})))
  }
  about.append(body);context.append(about);section.append(context);panel.append(section);return panel
}
function updateNavigation(){const index=filteredRows.findIndex(r=>r.item.sku===selectedSku);$('selection-count').textContent=filteredRows.length?S('v0_v1',{v0:(index+1),v1:(filteredRows.length)}):'0 / 0';$('prev-sku').disabled=index<=0;$('next-sku').disabled=index<0||index>=filteredRows.length-1}
function selectItem(row,{hash=true,reveal=false}={}){
  if(!row)return
  const started=performance.now();selectedSku=row.item.sku
  if(activeButton)activeButton.setAttribute('aria-pressed','false')
  activeButton=buttonMap.get(selectedSku);activeButton?.setAttribute('aria-pressed','true')
  $('hero').replaceChildren(chartPanel(row));cleanupCharts()
  $('hero').querySelector('figure')?.drawChart()
  updateNavigation()
  if(hash&&hashSku()!==selectedSku)history.replaceState(null,'',A3_SKU_HASH+encodeURIComponent(selectedSku))
  if(reveal&&activeButton&&$('sku-list').getClientRects().length)activeButton.scrollIntoView({block:'nearest',behavior:'instant'})
  document.body.dataset.selectedSku=selectedSku
  document.body.dataset.switchMs=String(performance.now()-started)
}
function navigateSku(delta){const index=filteredRows.findIndex(r=>r.item.sku===selectedSku);const next=filteredRows[index+delta];if(next)selectItem(next,{reveal:true})}
function buildList(){
  const query=$('search').value.trim().toLocaleLowerCase()
  const matches=currentRows.filter(r=>`${r.item.name} ${r.item.sku}`.toLocaleLowerCase().includes(query))
  filteredRows=[];buttonMap=new Map();activeButton=null
  const fragment=document.createDocumentFragment()
  for(const[key,title]of browseGroups){
    const rows=matches.filter(r=>groupFor(r)===key);if(!rows.length)continue
    const group=node('section'),h=node('h2',title,'group-title');h.append(node('span',rows.length));group.append(h)
    for(const row of rows){
      filteredRows.push(row)
      const b=node('button',null,'sku-button');b.type='button';b.dataset.sku=row.item.sku;b.dataset.bucket=row.bucket;b.setAttribute('aria-pressed',String(row.item.sku===selectedSku));b.setAttribute('aria-label',`${row.item.name}, ${bucketNames[row.bucket]}, ${row.guidance.quantity==null?STRINGS.unknown_9:orderAmount(row.guidance.quantity)+' '+row.item.unit}`)
      const name=node('span');name.title=row.item.name;name.append(node('span',row.item.name,'sku-name'),node('span',row.item.sku,'sku-code'))
      if(healthWarnings.some(w=>w.sku===row.item.sku)){const dot=node('i',null,'health-dot');dot.setAttribute('aria-hidden','true');name.querySelector('.sku-code').append(dot)}
      b.append(node('i',null,'dot'),name,node('span',row.guidance.status==='needs-data'?STRINGS.copy_7:`${orderAmount(row.guidance.quantity)} ${row.item.unit}`,'sku-qty'));group.append(b);buttonMap.set(row.item.sku,b)
      if(row.item.sku===selectedSku)activeButton=b
    }fragment.append(group)
  }
  if(!filteredRows.length)fragment.append(node('p',STRINGS.no_matches,'empty-list'))
  $('sku-list').replaceChildren(fragment)
  // Search navigates within matches. An empty search preserves the selection;
  // zero matches preserves the last chart and disables both navigation controls.
  if(filteredRows.length&&!filteredRows.some(r=>r.item.sku===selectedSku))selectItem(filteredRows[0])
  else updateNavigation()
}
function render(){return withDatasetEvaluation(renderPass)}
function renderPass(){
  const started=performance.now()
  currentToday=localToday()
  if(!evaluationSnapshot.ready){
    learningSettings=normalizeLearningSettings(learningSettingsFromLog(data,learningSettings,learningLog));let prepared=prepareLearning(data,learningDiary,learningSettings);if(recordLearning(prepared)===false)prepared=prepareLearning(data,learningDiary,learningSettings);currentRows=standaloneRows(prepared,currentToday,settings);updateLearningPanel();rowMap=new Map(currentRows.map(r=>[r.item.sku,r]));seriesCache=new WeakMap()
    updateHealth();finishEvaluationSnapshot()
  }
  selectedSku=rowMap.has(hashSku())?hashSku():rowMap.has(selectedSku)?selectedSku:attentionRows(currentRows)[0]?.item.sku||currentRows[0]?.item.sku
  buildList();const selected=rowMap.get(selectedSku)
  if(selected)selectItem(selected)
  else{$('hero').replaceChildren(node('p',STRINGS.no_products,'empty'));cleanupCharts();document.body.dataset.selectedSku=''}
  $('snapshot').textContent=`${sourceName==='sample'?STRINGS.sample_data:STRINGS.local_CSV} · ${shortDate(data.as_of)}`
  $('snapshot').title=sourceName==='sample'?STRINGS.synthetic_sample_not_real_stock:STRINGS.local_CSV_not_uploaded_or_saved
  $('product-total').textContent=currentRows.length
  $('sample').hidden=sourceName==='sample';$('copy-po').disabled=!attentionRows(currentRows).some(r=>r.guidance.quantity>0);$('copy-status').textContent='';$('copy-fallback').hidden=true;$('po-text').value=''
  document.body.dataset.renderMs=String(performance.now()-started)
}
$('sku-list').addEventListener('click',e=>{const b=e.target.closest('button[data-sku]');if(!b)return;selectItem(rowMap.get(b.dataset.sku));if(matchMedia('(max-width:700px)').matches){$('sidebar').dataset.open='false';$('browse-toggle').setAttribute('aria-expanded','false')}})
$('search').addEventListener('input',()=>{buildList();if(matchMedia('(max-width:700px)').matches){$('sidebar').dataset.open='true';$('browse-toggle').setAttribute('aria-expanded','true')}})
$('browse-toggle').addEventListener('click',()=>{const open=$('sidebar').dataset.open!=='true';$('sidebar').dataset.open=String(open);$('browse-toggle').setAttribute('aria-expanded',String(open))})
$('prev-sku').addEventListener('click',()=>navigateSku(-1));$('next-sku').addEventListener('click',()=>navigateSku(1))
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')||e.altKey||e.ctrlKey||e.metaKey||e.target.closest('input,textarea,select,[contenteditable=true],#tools'))return
  const delta=[A3_KEYS.down,'j',A3_KEYS.right].includes(e.key)?1:[A3_KEYS.up,'k',A3_KEYS.left].includes(e.key)?-1:0
  if(delta){e.preventDefault();navigateSku(delta)}
})
window.addEventListener('hashchange',()=>{const row=rowMap.get(hashSku());if(!row)return;if(!filteredRows.includes(row)){$('search').value='';buildList()}selectItem(row,{hash:false,reveal:true})})
/* STOCK_RUNWAY_CHART_DATA_START */
function chartData(row) {
  const {item,guidance}=row;if(item.held || guidance.status==='needs-data')return null
  const months=data.months,history=inventoryHistory(item,months),n=months.length,rows=item.projection,{crossing}=stockPath(item)
  const past=history.rows.length?history.rows.map((r,i)=>({t:i+1,stock:r.stock,month:months[i],kind:STRINGS.past_stock})):months.map((month,i)=>({t:i+.5,stock:item.monthly_sales[i],month,kind:STRINGS.past_sales}))
  const future=[{t:n,stock:item.stock,month:data.as_of.slice(0,7),kind:STRINGS.snapshot_stock}]
  rows.forEach((r,i)=>{if(crossing&&crossing.month>i&&crossing.month<i+1)future.push({t:n+crossing.month,stock:0,month:r.month,kind:STRINGS.run_out});future.push({t:n+i+1,stock:Math.max(0,r.stock),month:r.month,kind:STRINGS.forecast_stock})})
  const threshold=guidance.reorder_point ?? guidance.safety_stock
  let peak=Math.max(1,item.stock,threshold||0);for(const p of [...past,...future])peak=Math.max(peak,p.stock);for(const r of rows)peak=Math.max(peak,r.demand,r.receipts||0);for(const r of history.rows)peak=Math.max(peak,r.delivered||0)
  const step=Math.max(1,niceStep(peak*1.1/4)),max=Math.max(4*step,Math.ceil(peak*1.1/step)*step)
  const orderDate=guidance.order_by==='now'?currentToday:guidance.order_by
  const monthPosition=date=>{if(!date)return null;const [y,m,d]=date.split('-').map(Number),[fy,fm]=rows[0].month.split('-').map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate();return n+(y-fy)*12+m-fm+(d-1)/days}
  return {past,future,n,slots:n+rows.length,crossing,threshold,max,step,orderT:monthPosition(orderDate),orderDate,history}
}
/* STOCK_RUNWAY_CHART_DATA_END */function syncSettings() {
  $('delivery-days').value = settings.default_delivery_days ?? ''
  $('cover-months').value = settings.months_of_cover
  $('buffer-days').value = settings.buffer_days
  $('service-level').value = settings.service_level
}
function saveSettings(next) {
  settings = normalizeOrderSettings(next)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); $('storage-status').textContent = STRINGS.settings_saved_on_this_device_Your_CSV_is_ }
  catch { $('storage-status').textContent = STRINGS.settings_could_not_be_saved_Changes_still_ }
  render()
}
for (const [id, key, min, max, integer] of [ ['delivery-days', 'default_delivery_days', 1, 3650, true], ['cover-months', 'months_of_cover', 0, 36, false], ['buffer-days', 'buffer_days', 0, 365, true] ]) {
  $(id).addEventListener('input', () => {
    const raw = $(id).value.trim(), value = raw === '' ? null : Number(raw)
    const valid = !$(id).validity.badInput && (value === null ? key === 'default_delivery_days' : Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)))
    $(id).setAttribute('aria-invalid', String(!valid))
    $('settings-error').hidden = valid
    $('settings-error').textContent = valid ? '' : S('enter_v0_from_v1_to_v2_The_previous_settin',{v0:(integer ? STRINGS.a_whole_number : STRINGS.a_number),v1:(min),v2:(max)})
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
  $('source-status').textContent = S('reading_v0',{v0:(file.name)})
  try {
    const loaded = await loadStockImport(file,()=>version===readVersion)
    if (version !== readVersion) return
    if (!loaded) {
      $('source-status').textContent=sourceName==='sample'?'Still using built-in sample data.':'Still using '+sourceName+'.'
      return
    }
    const parsed = loaded.parsed
    if (version !== readVersion) return
    if (!loaded.smart && typeof confirmStockImport === 'function' && !await confirmStockImport(parsed,file)) {
      if(version===readVersion)$('source-status').textContent=sourceName==='sample'?STRINGS.still_using_built_in_sample_data:S('still_using_v0',{v0:sourceName})
      return
    }
    if (version !== readVersion) return
    const memo=new Map()
    withEvaluationPass(()=>{
      validateDataset(parsed) // Validate shape/calendar without a discarded forecast pass.
      data=parsed;sourceName=file.name
      evaluationSnapshot={data,key:evaluationSnapshotKey(),diary:learningDiary,log:learningLog,memo,ready:false,health:null}
      render()
    },memo)
    $('source-status').textContent = S('using_v0_v1_items_File_stays_on_this_devic',{v0:(file.name),v1:(parsed.items.length)})
    stockImportStatus(loaded,file)
  } catch (error) {
    if (version !== readVersion) return
    if(error.import_report && typeof confirmStockImport==='function')await confirmStockImport({items:[],import_report:error.import_report},file)
    if (version !== readVersion) return
    $('file-error').textContent = S('v0_Previous_data_is_unchanged',{v0:(error instanceof CsvError ? error.message : STRINGS.could_not_read_or_calculate_this_CSV_Check)})
    $('file-error').hidden = false
    $('source-status').textContent = sourceName === 'sample' ? STRINGS.still_using_built_in_sample_data : S('still_using_v0',{v0:(sourceName)})
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
  $('source-status').textContent = STRINGS.using_built_in_sample_data_synthetic_not_
})
$('copy-po').addEventListener('click', async () => {
  const text = purchaseOrderText(attentionRows(currentRows), currentToday)
  try {
    if (!navigator.clipboard?.writeText) throw Error(STRINGS.clipboard_unavailable)
    await navigator.clipboard.writeText(text)
    $('copy-status').textContent = STRINGS.copied_ready_to_paste_into_WhatsApp_or_a_s
  } catch {
    $('copy-fallback').hidden = false; $('po-text').value = text
    $('po-text').focus(); $('po-text').select()
    $('copy-status').textContent = STRINGS.automatic_copy_is_unavailable_Copy_the_sel
  }
})
$('select-po').addEventListener('click', () => { $('po-text').focus(); $('po-text').select() })
// Re-evaluate today's local date after an offline tab has been left open overnight.
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentToday !== localToday()) render() })
initializeSheets();initializeLearning();syncSettings(); render()
