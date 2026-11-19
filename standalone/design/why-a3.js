// Lifecycle: living. Core ledger presentation only; never re-derive order maths.
// See WHY.md: signed core deltas then an absolute total, or one null hold marker.
const WHY_HOLDS = new Set(['late_po_hold','demand_history_hold','committed_orders_hold','data_hold'])
const WHY_OPTIONAL = new Set(['stockout_correction','projects_excluded','manual_change','committed_orders'])
function orderBreakdown(item, guidance, settings = {}, today, asOf = item.as_of) {
  const q=guidance.quantity??null
  const override=normalizeOrderSettings(settings).product_overrides[item.sku]||{}
  const labels={forecast_demand:STRINGS.demandCover,stock_on_hand:STRINGS.onHand,
    incoming_supply:STRINGS.incoming,undated_incoming:STRINGS.undatedIncoming,dated_receipt_netting:STRINGS.datedReceiptNetting,
    buffer_demand:STRINGS.bufferDemand,replenishment_disabled:STRINGS.replenishmentDisabled,safety_stock:STRINGS.safety,zero_floor:STRINGS.floor,minimum_order:STRINGS.minimumOrder,
    pack_rounding:override.pack_size&&override.pack_size!==1?STRINGS.roundingBox:STRINGS.rounding,
    stockout_correction:STRINGS.soldOutFixed,projects_excluded:STRINGS.projectsRemoved,
    manual_change:STRINGS.manualChange,committed_orders:STRINGS.customerOrders,
    forecast_alignment:STRINGS.forecastAlignment,arithmetic_reconciliation:STRINGS.arithmeticAdjustment,
    late_po_hold:STRINGS.latePoHold,demand_history_hold:STRINGS.historyHold,
    committed_orders_hold:STRINGS.ordersHold,data_hold:STRINGS.dataHold}
  const steps=whyBreakdown(item,today,settings,asOf)
    .filter(step=>!WHY_OPTIONAL.has(step.key)||step.qty!==0)
    .map(step=>({...step,label:labels[step.key]}))
  if(q!==null)steps.push({key:'total',label:STRINGS.total,qty:q})
  return validBreakdown(steps,q)?steps:[]
}
function validBreakdown(steps, quantity) {
  if(!Array.isArray(steps)||!steps.length)return false
  if(!steps.every(s=>s&&typeof s.key==='string'&&typeof s.label==='string'&&s.label.trim()&&s.label.trim().split(/\s+/).length<=3))return false
  if(quantity==null)return steps.length===1&&WHY_HOLDS.has(steps[0].key)&&steps[0].qty===null
  if(!Number.isFinite(quantity)||quantity<0||steps.length<2||!steps.every(s=>Number.isFinite(s.qty)))return false
  if(steps.at(-1).key!=='total'||steps.at(-1).qty!==quantity||steps.slice(0,-1).some(s=>s.key==='total'))return false
  return steps.slice(0,-1).reduce((a,s)=>a+s.qty,0)===quantity
}
function waterfall(steps, unit) {
  const chart=node('ol',null,'waterfall');chart.setAttribute('aria-label',S('waterfallAria',{unit}))
  if(steps.length===1&&steps[0].qty===null){
    const step=steps[0],row=node('li',null,'waterfall-row');row.dataset.key=step.key
    row.append(node('span',step.label,'waterfall-label'),node('small',unit));chart.append(row)
    return chart
  }
  let balance=0
  const geometry=steps.map(step=>{const from=step.key==='total'?0:balance;const to=step.key==='total'?step.qty:balance+step.qty;balance=to;return {step,from,to}})
  const min=Math.min(0,...geometry.flatMap(r=>[r.from,r.to])),max=Math.max(1,...geometry.flatMap(r=>[r.from,r.to])),span=max-min
  for(const {step,from,to} of geometry){
    const row=node('li',null,'waterfall-row');row.dataset.key=step.key;row.dataset.qty=step.qty
    const shown=step.qty===0?0:step.qty
    const decimals=step.key==='total'?6:Math.abs(shown)>=.01?2:6
    const amount=shown.toLocaleString('en-GB',{maximumFractionDigits:decimals})
    const value=node('strong',(step.key!=='total'&&shown>0?'+':'')+amount,'waterfall-number');value.title=orderAmount(shown)+' '+unit;value.append(node('small',unit))
    const text=node('div',null,'waterfall-label');text.append(node('span',step.label),value)
    const track=node('div',null,'waterfall-track'),bar=node('span',null,'waterfall-bar'),zero=node('i',null,'waterfall-zero')
    track.setAttribute('aria-hidden','true');bar.dataset.sign=step.key==='total'?'total':step.qty<0?'negative':'positive'
    bar.style.left=((Math.min(from,to)-min)/span*100)+'%';bar.style.width=(Math.abs(to-from)/span*100)+'%';zero.style.left=(-min/span*100)+'%'
    bar.hidden=step.qty===0
    track.append(zero,bar);row.append(text,track);chart.append(row)
  }
  return chart
}
function openWhy(row, trigger) {return withDatasetEvaluation(()=>{
  // A tab may stay visible across midnight; refresh before explaining dates.
  if(!evaluationSnapshot.ready)renderPass()
  return openWhyPass(rowMap.get(row.item.sku)||row,trigger)
})}
function openWhyPass(row, trigger) {
  const steps=orderBreakdown(row.item,row.guidance,settings,currentToday,data.as_of)
  $('why-sku').textContent=row.item.sku
  $('why-chart').replaceChildren(validBreakdown(steps,row.guidance.quantity)
    ? waterfall(steps,row.item.unit)
    : node('p',STRINGS.cantExplain))
  if(!validBreakdown(steps,row.guidance.quantity)){openSheet($('why-dialog'),trigger);return}
  const forecast=forecastDetails(row.item,row.guidance,settings,data.as_of,currentRows.map(r=>r.item))
  const method=node('p',S('methodLabel',{name:forecast.method_name==="Average"&&forecast.method==='champion'?STRINGS.method_baseline:STRINGS['method_'+forecast.method]}),'forecast-method');method.dataset.forecastMethod=forecast.method
  $('why-chart').append(method)
  if(row.guidance.undated_on_order_assumed_within_lead){const note=node('p',STRINGS.undatedIncomingAssumption,'forecast-assumption');note.dataset.undatedIncomingAssumption='true';$('why-chart').append(note)}
  if(forecast.tested_months>0)$('why-chart').append(node('p',S('testedMonths',{count:forecast.tested_months}),'forecast-tested'))
  const classes=evaluationSnapshot.health.features.demand_classes
  const classification=classes?.state==='on'?classes.items[row.item.sku]:null
  if(classification){const line=node('p',S('classLabel',{name:classification.label}),'forecast-class');line.title=classification.basis;$('why-chart').append(line)}
  if(row.item.calendar_forecast===true){const note=node('p',STRINGS.calendarNote,'forecast-calendar');note.title=STOCKOUT_LAB.CALENDAR_NOTE;$('why-chart').append(note)}
  if(forecast.scenarios){
    const range=node('details',null,'forecast-range');range.append(node('summary',STRINGS.orderRange))
    const values=forecast.scenarios
    range.append(node('p',STRINGS.roughRange+' · '+S('rangeSamples',{count:values.samples})))
    for(const [key,label] of [['lean',STRINGS.lean],['recommended',STRINGS.recommended],['stock_up',STRINGS.stockUp]]){
      const line=node('p',null,'forecast-scenario');line.dataset.scenario=key
      line.append(node('span',label),node('strong',orderAmount(values[key])+' '+row.item.unit));range.append(line)
    }
    $('why-chart').append(range)
  }
  openSheet($('why-dialog'),trigger)
}
function openSheet(dialog, trigger) {
  if(dialog.open)return
  dialog.returnFocus=trigger;window.getSelection()?.removeAllRanges();dialog.showModal();dialog.querySelector('.sheet-close').focus()
}
function initializeSheets() {
  for(const id of ['why-dialog','health-dialog']){
    const dialog=$(id)
    dialog.querySelector('.sheet-close').addEventListener('click',()=>dialog.close())
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return
      const controls=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')]
      const first=controls[0],last=controls.at(-1)
      if(!first)return
      if(controls.length===1||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus()}
    })
    dialog.addEventListener('close',()=>{if(dialog.returnFocus?.isConnected)dialog.returnFocus.focus()})
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()})
  }
  $('health-chip').addEventListener('click',()=>openSheet($('health-dialog'),$('health-chip')))
}
function updateHealth() {
  const result=dataHealth({...data,items:currentRows.map(r=>({...r.item,guidance:r.guidance}))},currentToday,settings,{lazy:document.body.dataset.design==='option-gm-b'})
  evaluationSnapshot.health=result
  healthWarnings=result.warnings
  const chip=$('health-chip');chip.hidden=!healthWarnings.length;chip.textContent=STRINGS.warningIcon+' '+healthWarnings.length
  chip.setAttribute('aria-label',S('healthAria',{count:healthWarnings.length}))
  $('health-list').replaceChildren(...healthWarnings.map(w=>{
    const li=node('li');li.dataset.code=w.code;li.dataset.severity=w.severity
    li.append(node('span',STRINGS.warningIcon,'health-icon'),node('span',w.sku||STRINGS.datasetLabel,'health-sku'),node('span',STRINGS['warning_'+w.code]))
    return li
  }))
}
