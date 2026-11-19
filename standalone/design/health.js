// Lifecycle: living. Pure readiness/health only; twin of health.py. No maths switches.
const HEALTH_LABELS = Object.freeze({pattern_changed:'Pattern changed',external_ignored:'Import ignored',negative_stock:'Negative stock',excess_stock:'Check stock level',stale_stock_count:'Old stock count',invalid_count_date:'Check count date',manual_locked:'Check demand change',duplicate_sku:'Duplicate SKU',partial_month:'Partial month',negative_value:'Negative value',missing_value:'Missing data',invalid_value:'Invalid value',unit_sanity:'Check units',order_conflict:'Order limits clash',stale_snapshot:'Old snapshot',late_po:'Late PO',incoming_invalid:'Check incoming orders',overdue_order:'Late customer order',committed_invalid:'Check customer orders',reservation_mapping:'Map reservations',stockout_locked:'Check sales history',project_locked:'Check project flags',outlier_suggestion:'Check sales spike'})
function dataHealth(...args) {
  return typeof withEvaluationPass==='function'?withEvaluationPass(()=>dataHealthPass(...args)):dataHealthPass(...args)
}
function dataHealthPass(dataset, today = null, settings = {}, options = {}) {
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  const number = v => typeof v === 'number' && Number.isFinite(v)
  const day = v => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
    const d = new Date(v+'T00:00:00Z')
    return Number.isFinite(d.getTime()) && d.getUTCFullYear()>=1 && d.toISOString().slice(0,10)===v ? d : null
  }
  const data = object(dataset) ? dataset : {}
  settings = object(settings) ? settings : {}
  const items = Array.isArray(data.items) ? data.items : [], months = Array.isArray(data.months) ? data.months : []
  const snapshot = day(data.as_of), now = day(today ?? data.as_of), warnings = [], seen = new Set(), skus = new Set()
  const warn = (code, sku = '', severity = 'warning') => {
    const identity = JSON.stringify([code,sku])
    if (!seen.has(identity)) { seen.add(identity); warnings.push({code,sku,severity,short_label:HEALTH_LABELS[code]}) }
  }
  if(data.external_ignored===true)warn('external_ignored')
  if (!snapshot || !months.length || !items.length) warn('missing_value','','error')
  if (snapshot && now && (now-snapshot)/86400000>45) warn('stale_snapshot')
  const validMonths=[]
  for (const month of months) {
    const first=typeof month==='string'?day(month+'-01'):null
    if(first)validMonths.push(first);else warn('invalid_value','','error')
  }
  const monthIndex=d=>d.getUTCFullYear()*12+d.getUTCMonth()
  const contiguous=validMonths.length===months.length && validMonths.every((d,i)=>i===0||monthIndex(d)-monthIndex(validMonths[i-1])===1)
  if(!contiguous)warn('invalid_value','','error')
  const monthEnd=d=>{const end=new Date(d);end.setUTCMonth(end.getUTCMonth()+1,0);return end}
  const last=validMonths.at(-1),lastDay=snapshot?monthEnd(snapshot).getUTCDate():null
  const partial=data.partial_last_month===true||Boolean(snapshot&&last&&(monthIndex(last)>monthIndex(snapshot)||monthIndex(last)===monthIndex(snapshot)&&snapshot.getUTCDate()<lastDay))
  if(partial)warn('partial_month')
  let fullCount=contiguous&&snapshot?validMonths.filter(m=>monthEnd(m)<=snapshot).length:0
  if(data.partial_last_month===true&&fullCount===months.length)fullCount=Math.max(0,fullCount-1)
  const historyCounts=[],receiptCounts=[],intermittent=[]
  let usable=false,committed=false,receipts=false,substitutes=false,kits=false,warehouses=false,incomingHint=false
  if(items.some(i=>!object(i)))warn('invalid_value','','error')
  for(const item of items){
    if(!object(item))continue
    const sku=typeof item.sku==='string'?item.sku:''
    if(sku&&skus.has(sku))warn('duplicate_sku',sku,'error');skus.add(sku)
    for(const key of ['sku','name','unit','on_hand','monthly_sales'])if(item[key]==null||item[key]==='')warn('missing_value',sku,'error')
    const sales=Array.isArray(item.monthly_sales)?item.monthly_sales:[]
    if(sales.length!==months.length)warn('missing_value',sku,'error')
    const numeric=['on_hand','on_order','usable_on_hand','damaged','reserved','supplier_days','pack_size','minimum_order','max_stock']
    const values=[...numeric.filter(k=>item[k]!=null).map(k=>item[k]),...sales]
    for(const key of ['receipts','historical_receipts'])if(object(item[key]))values.push(...Object.values(item[key]))
    for(const value of values){
      if(value==null)warn('missing_value',sku,'error')
      else if(!number(value))warn('invalid_value',sku,'error')
      else if(value<0)warn('negative_value',sku,'error')
    }
    const good=sales.length===months.length&&sales.every(v=>number(v)&&v>=0)
    historyCounts.push(good?fullCount:0)
    const fullSales=good?sales.slice(0,fullCount):[]
    intermittent.push(Boolean(fullSales.length&&fullSales.filter(v=>v===0).length>fullSales.length/2))
    const avg=fullSales.length?fullSales.reduce((a,b)=>a+b,0)/fullSales.length:0,guidance=object(item.guidance)?item.guidance:{}
    const accuracy=Object.hasOwn(item,'last_count_date')
    if(accuracy&&number(item.on_hand)&&item.on_hand<0)warn('negative_stock',sku)
    if(accuracy&&avg>0&&number(item.on_hand)&&item.on_hand>24*avg)warn('excess_stock',sku)
    if(accuracy){
      const counted=day(item.last_count_date)
      if(!counted||now&&counted>now)warn('invalid_count_date',sku)
      else if(now&&(now-counted)/86400000>180)warn('stale_stock_count',sku)
    }
    if(avg>0&&[accuracy?null:item.on_hand,guidance.quantity,item.suggested_order].some(v=>number(v)&&v>24*avg))warn('unit_sanity',sku)
    const overrides=object(settings.product_overrides)?settings.product_overrides:{},override=object(overrides[sku])?overrides[sku]:{}
    const get=k=>Object.hasOwn(override,k)?override[k]:item[k]
    let pack=get('pack_size');pack=number(pack)&&pack>0?pack:1
    const minimum=get('minimum_order'),maximum=get('max_stock')
    if(number(maximum)&&maximum>=0&&((number(minimum)?minimum:0)>maximum||pack>maximum||number(minimum)&&minimum>0&&Math.ceil(minimum/pack-1e-9)*pack>maximum+1e-9))warn('order_conflict',sku,'error')
    let count=0
    for(const receipt of Array.isArray(item.receipt_history)?item.receipt_history:[]){
      if(!object(receipt)){warn('invalid_value',sku,'error');continue}
      const ordered=day(receipt.ordered_on),received=day(receipt.received_on),quantity=receipt.quantity
      if(!ordered||!received||!number(quantity))warn('missing_value',sku,'error')
      else if(quantity<0||received<ordered)warn('negative_value',sku,'error')
      else if(quantity>0&&snapshot&&received<=snapshot)count++
    }
    receiptCounts.push(count)
    usable ||= number(item.usable_on_hand)&&item.usable_on_hand>=0||['on_hand','damaged','reserved'].every(k=>number(item[k])&&item[k]>=0)
    committed ||= Array.isArray(item.committed_orders)&&item.committed_orders.length>0
    receipts ||= Boolean(object(item.receipts)&&Object.values(item.receipts).some(v=>number(v)&&v>0)||count)
    incomingHint ||= number(item.on_order)&&item.on_order>0||Boolean(Array.isArray(item.open_receipts)&&item.open_receipts.length)
    substitutes ||= Array.isArray(item.substitutes)&&item.substitutes.length>0
    kits ||= Array.isArray(item.kit_components)&&item.kit_components.length>0
    warehouses ||= Array.isArray(item.warehouse_stock)&&item.warehouse_stock.length>1
  }
  const gate=(on,present,needs)=>({state:on?'on':present?'locked':'hidden',needs:on?'':needs})
  const features={
    seasonality:gate(historyCounts.length>0&&Math.min(...historyCounts)>=24,months.length>0,'24 full months'),
    lead_time_spread:gate(receiptCounts.length>0&&Math.min(...receiptCounts)>=5,items.length>0,'5 dated receipts'),
    intermittent:gate(intermittent.some(Boolean),months.length>0,'zero sales months'),
    usable_stock:gate(usable,items.length>0,'usable stock'),
    committed_orders:gate(committed,false,'customer orders'),
    receipts:gate(receipts,incomingHint,'receipt dates'),
    substitutes:gate(substitutes,false,'item links'),
    kits:gate(kits,false,'kit components'),
    multi_warehouse:gate(warehouses,false,'warehouse stock')
  }
  // Warning generation never needs Auto backtests. On the worklist, defer
  // capability-only features until requested; serialization still resolves the
  // identical values. Default callers (including Python/JS parity) stay eager.
  const feature=(key,compute)=>{
    if(!options.lazy){features[key]=compute();return}
    Object.defineProperty(features,key,{enumerable:true,configurable:true,get(){
      const value=withEvaluationPass(compute)
      Object.defineProperty(features,key,{value,enumerable:true,configurable:true})
      return value
    }})
  }
  feature('smart_forecast',()=>{
    const smart=Object.create(null)
    for(const item of items){
      if(!object(item))continue
      const ready=typeof forecastSelection==='function'&&months.length&&fullCount===months.length&&!partial&&snapshot&&months.at(-1)===snapshot.toISOString().slice(0,7)?forecastSelection(item,months.at(-1)):{state:months.length?'locked':'hidden',needs:'28 full months'}
      smart[item.sku||'']={state:ready.state,needs:ready.needs}
    }
    const states=Object.values(smart).map(g=>g.state)
    return {state:states.includes('on')?'on':states.includes('locked')?'locked':'hidden',chip:'Smart forecast',items:smart}
  })
  if(items.some(i=>object(i)&&Array.isArray(i.monthly_sales)&&i.monthly_sales.length>=18)){
    const labels=typeof inventoryClasses==='function'&&!partial&&fullCount===months.length&&snapshot?inventoryClasses(items):{};
    features.demand_classes={state:Object.keys(labels).length?'on':'locked',chip:'Demand class',items:labels}
  }
  if(items.some(i=>object(i)&&Object.hasOwn(i,'calendar_forecast'))){
    const gates=Object.create(null)
    for(const i of items)if(object(i)){
      const ready=typeof forecastSelection==='function'&&months.length&&!partial&&fullCount===months.length?forecastSelection(i,months.at(-1)):{};
      const on=i.calendar_forecast===true&&Object.hasOwn(ready.candidates||{},'calendar_seasonal');gates[i.sku||'']=gate(on,Object.hasOwn(i,'calendar_forecast'),'36 full months')
    }
    const states=Object.values(gates).map(g=>g.state);features.calendar_forecast={state:states.includes('on')?'on':'locked',chip:'Calendar',items:gates}
  }
  if(items.some(i=>object(i)&&Object.hasOwn(i,'planning_facts'))){
    const gates=Object.create(null)
    for(const item of items){
      if(!object(item))continue
      let facts
      try { facts=datedFacts(item,data.as_of,today||data.as_of) }
      catch { facts={state:'locked',needs:'HOLD: incoming order data needs checking.',late:0} }
      gates[item.sku||'']={state:facts.state,needs:facts.needs}
      if(facts.late)warn('late_po',item.sku||'')
      else if(facts.state==='locked')warn('incoming_invalid',item.sku||'','error')
    }
    const states=Object.values(gates).map(g=>g.state)
    features.dated_incoming={state:states.includes('on')?'on':states.includes('locked')?'locked':'hidden',chip:'Incoming orders',items:gates}
    const demandGates=Object.create(null)
    for(const item of items){
      if(!object(item))continue
      let demand
      try { demand=committedFacts(item,data.as_of,today||data.as_of) }
      catch { demand={state:'locked',needs:'HOLD: customer order data needs checking.',overdue:0} }
      demandGates[item.sku||'']={state:demand.state,needs:demand.needs}
      if(demand.overdue)warn('overdue_order',item.sku||'')
      if(demand.state==='locked')warn(demand.needs.includes('reservation')?'reservation_mapping':'committed_invalid',item.sku||'','error')
    }
    const demandStates=Object.values(demandGates).map(g=>g.state)
    features.committed_demand={state:demandStates.includes('on')?'on':demandStates.includes('locked')?'locked':'hidden',chip:'Customer orders',items:demandGates}
    if(demandStates.some(s=>s!=='hidden'))features.committed_orders={state:features.committed_demand.state,needs:demandStates.includes('on')?'':'customer orders / reservations'}
    const historyGates=Object.create(null)
    for(const item of items){
      if(!object(item))continue
      let history
      try {history=stockoutHistory(item,(data.as_of||'').slice(0,7))}
      catch {history={state:'locked',needs:'HOLD: stockout history needs checking.'}}
      historyGates[item.sku||'']={state:history.state,needs:history.needs}
      if(history.state==='locked')warn('stockout_locked',item.sku||'','error')
    }
    const historyStates=Object.values(historyGates).map(g=>g.state)
    features.stockout_correction={state:historyStates.includes('on')?'on':historyStates.includes('locked')?'locked':'hidden',chip:'Stockout adjustment',items:historyGates}
    const projectGates=Object.create(null),suggestionGates=Object.create(null)
    for(const item of items){
      if(!object(item))continue
      let history
      try {history=adoptedDemandHistory(item,(data.as_of||'').slice(0,7))}
      catch {history={project_state:'locked',needs:'HOLD: project history needs checking.'}}
      const state=history.project_state||'hidden',suggestions=history.outlier_suggestions||{state:'hidden',needs:'',months:[]}
      projectGates[item.sku||'']={state,needs:state==='locked'?history.needs:''}
      suggestionGates[item.sku||'']={state:suggestions.state,needs:suggestions.needs,months:suggestions.months}
      if(state==='locked')warn('project_locked',item.sku||'','error')
      if(suggestions.months.length)warn('outlier_suggestion',item.sku||'')
    }
    const projectStates=Object.values(projectGates).map(g=>g.state)
    if(projectStates.some(s=>s!=='hidden')){
      features.project_exclusion={state:projectStates.includes('on')?'on':'locked',chip:'Project sales',items:projectGates}
      const suggestionStates=Object.values(suggestionGates).map(g=>g.state)
      features.outlier_suggestions={state:suggestionStates.includes('on')?'on':suggestionStates.includes('locked')?'locked':'hidden',chip:'Check spike',items:suggestionGates}
    }
  }
  if(items.some(i=>object(i)&&Object.hasOwn(i,'demand_change_pct'))){
    const gates=Object.create(null)
    for(const item of items){
      if(!object(item))continue
      const history=adoptedDemandHistory(item,(data.as_of||'').slice(0,7)),state=history.manual_state||'hidden'
      gates[item.sku||'']={state,needs:state==='locked'?history.needs:''}
      if(state==='locked')warn('manual_locked',item.sku||'','error')
    }
    const states=Object.values(gates).map(g=>g.state)
    features.manual_change={state:states.includes('on')?'on':'locked',chip:'Demand change',items:gates}
  }
  if(items.some(i=>object(i)&&Object.hasOwn(i,'_learning_context'))){
    const gates={};for(const item of items){const entries=item._learning_context?.entries||[];gates[item.sku||'']=gate(entries.length>=6,true,'6 matured months');if(patternChanged(entries))warn('pattern_changed',item.sku||'')}
    features.learning={state:Object.values(gates).some(g=>g.state==='on')?'on':'locked',chip:'Accuracy',items:gates}
  }
  return {features,warnings}
}
