import assert from 'node:assert/strict'

// Only guidance/planning fields may change in policy v2. Keep every other
// legacy field (including model selection, backtests and projections) exact.
const policyFields = new Set(['runout_month','runout_day','order_by','order_overdue',
  'demand_swing','safety_stock','reorder_point','why','safety_stock_provenance',
  'suggested_order','big_order'])
// Reverse only the documented v1.2.2 warning strings, independently checked
// against raw history. Unknown warning bytes remain part of historical guards.
export function expectedSafetyWarnings(row,orderQuantity){
  const sales=row.monthly_sales,allowed=new Set()
  if(!Array.isArray(sales))return allowed
  const nonzero=sales.filter(v=>v>0).sort((a,b)=>a-b)
  if(sales.length>=4&&nonzero.length&&row.as_of){
    const n=nonzero.length,median=n%2?nonzero[(n-1)/2]:(nonzero[n/2-1]+nonzero[n/2])/2
    const [y,m]=row.as_of.slice(0,7).split('-').map(Number),unusual=[]
    sales.forEach((v,i)=>{if(v>4*median)unusual.push(new Date(Date.UTC(y,m-1-sales.length+1+i,1)).toISOString().slice(0,7))})
    if(unusual.length)allowed.add(`${unusual.length===1?'One month':'Months'} (${unusual.join(', ')}) ${unusual.length===1?'is':'are'} much higher than usual. Check it isn't a one-off before ordering.`)
  }
  let trailing=0;for(let i=sales.length-1;i>=0&&sales[i]===0;i--)trailing++
  if(trailing>=3&&orderQuantity>0)allowed.add(`No sales for ${trailing} months. Check it isn't discontinued before ordering.`)
  if(trailing&&row.on_hand<=0)allowed.add('Out of stock with no recent sales — sales may be low because it ran out. Check demand before trusting this.')
  return allowed
}
export function assertSafetyWarningAdditions(row,quantity){
  if(row.held)return
  for(const note of expectedSafetyWarnings(row,quantity))assert.ok(row.input_warnings?.includes(note),`expected warning addition: ${note}`)
}
export function reviewedSafetyProjection(row,quantity=row.suggested_order??0){
  const out={...row},notes=row.input_warnings
  if(!Array.isArray(notes))return out
  const allowed=expectedSafetyWarnings(row,quantity),kept=notes.filter(note=>!allowed.has(note))
  if(kept.length!==notes.length){if(kept.length)out.input_warnings=kept;else delete out.input_warnings}
  return out
}
export const forecastOnly = (row,quantity=row.suggested_order??0) => Object.fromEntries(Object.entries(reviewedSafetyProjection(row,quantity)).filter(([key])=>!policyFields.has(key)))
export const plain = value => JSON.parse(JSON.stringify(value))
export function assertFrozenForecast(actual, historical, quantity=actual.suggested_order??0) {
  const a=plain(forecastOnly(actual,quantity)),b=plain(forecastOnly(historical,quantity))
  const projection=a.projection,previous=b.projection
  delete a.projection;delete b.projection
  assert.deepEqual(a,b,'all non-policy, non-projection fields stay exact')
  const same=(x,y)=>{
    if(typeof x==='number'&&typeof y==='number'){
      const ulp=n=>Math.max(Number.MIN_VALUE,2**(Math.floor(Math.log2(Math.abs(n)))-52))
      assert.ok(x===y||Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=4*Math.max(ulp(x),ulp(y)),`${x} vs ${y}: exceeds four ULP calendar drift`)
    } else if(x&&y&&typeof x==='object'&&typeof y==='object'){
      assert.deepEqual(Object.keys(x),Object.keys(y));for(const k of Object.keys(x))same(x[k],y[k])
    } else assert.deepEqual(x,y)
  }
  same(projection,previous)
}
export const shiftDay = (date, days) => new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)
export function assertGuidanceDates(api, row, today, settings = {}, asOf = row.as_of) {
  if (row.held) return
  const g = api.orderGuidance(row,today,settings,asOf)
  assertSafetyWarningAdditions(row,g.quantity??0)
  if (g.status === 'needs-data') return
  assert.equal(row.runout_day,g.runout_date,'row runout comes from guidance, even beyond the chart horizon')
  assert.equal(row.runout_month,g.runout_date?.slice(0,7)??null)
  assert.equal(row.order_by,g.order_by,'row deadline uses the same safety-stock trigger')
}
// Independent calendar sum for legacy steady/seasonal fixtures. This does not
// call production calendarDemand/roundedOrderQuantity or copy their rationals.
export function calendarTotal(item, asOf, end) {
  let total=0
  for(let date=shiftDay(asOf,1);date<=end;){
    const [year,month]=date.split('-').map(Number)
    const days=new Date(Date.UTC(year,month,0)).getUTCDate()
    const last=`${year}-${String(month).padStart(2,'0')}-${days}`
    const stop=last<end?last:end
    const count=Math.round((Date.parse(stop)-Date.parse(date))/86400000)+1
    let demand=item.monthly_demand
    if(item.seasonal){
      const sales=item.monthly_sales.slice(-12),lastMonth=Number(asOf.slice(5,7))
      const average=sales.reduce((a,b)=>a+b,0)/12
      const factors=sales.map(v=>average?Math.max(.5,Math.min(2,v/average)):1)
      const level=sales.slice(-3).reduce((sum,v,i)=>sum+v/factors[9+i],0)/3
      demand=level*factors[(month-lastMonth+11)%12]
    }
    total+=demand*count/days
    date=shiftDay(stop,1)
  }
  return total
}
export function triggerDate(item, asOf, safetyStock = 0) {
  let balance=item.on_hand+(item.on_order||0)-safetyStock
  if(balance<=0) return asOf
  // Focused steady fixtures only; per-day oracle intentionally independent
  // from production's month jumps / exact-rational crossing implementation.
  assert.equal(item.seasonal,false)
  for(let day=shiftDay(asOf,1),count=0;count<40000;day=shiftDay(day,1),count++){
    const [year,month,date]=day.split('-').map(Number)
    if(date===1)balance+=item.receipts?.[day.slice(0,7)]||0
    balance-=item.monthly_demand/new Date(Date.UTC(year,month,0)).getUTCDate()
    if(balance<=1e-8)return day
  }
  throw new Error('independent trigger oracle exceeded its supported fixture window')
}
export function orderUpTo(item,g,settings={}) {
  // No demand and no recent observed sales must not buy a safety-only order.
  if(item.monthly_demand===0&&item.monthly_sales.slice(-3).every(v=>v===0))return 0
  const buffer=settings.buffer_days??0
  const arrival=shiftDay(g.order_date,g.lead_days)
  const bufferDemand=calendarTotal(item,g.stock_date,shiftDay(g.endpoint,buffer))-calendarTotal(item,g.stock_date,g.endpoint)
  const events=Object.entries(item.receipts||{}).map(([m,q])=>({date:m+'-01',qty:q}))
  const points=[[arrival,false],[g.endpoint,false],...events.filter(e=>e.date>arrival&&e.date<=g.endpoint).map(e=>[e.date,true])]
  const ss=settings.include_backup_in_orders===false?0:g.safety_stock??0
  const need=Math.max(0,...points.map(([day,pre])=>calendarTotal(item,g.stock_date,day)+bufferDemand+ss-item.on_hand-(item.on_order||0)-events.filter(e=>e.date>g.stock_date&&(pre?e.date<day:e.date<=day)).reduce((s,e)=>s+e.qty,0)))
  const override=settings.product_overrides?.[item.sku]||{}
  const pack=override.pack_size??item.pack_size??1,minimum=override.minimum_order??item.minimum_order??0
  return settings.months_of_cover===0||need===0?0:Math.ceil((Math.max(need,minimum)-1e-9)/pack)*pack
}
