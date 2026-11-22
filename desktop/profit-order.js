/* Pure mirror of profit_order.py. FNV/xorshift and circular three-month blocks
 * mirror the read-only risk.js sampler; no global random state or forecasting. */
const PROFIT_ORDER = (() => {
  'use strict';
  const MAX_PATHS=200,GENERATED_PATHS=96,SAFE_TICKS=9007199254740991;
  const get=(o,k,f)=>Object.hasOwn(o,k)?o[k]:f;
  const number=(x,low=0,high=1e12)=>{
    if(typeof x!=='number'||!Number.isFinite(x)||x<low||x>high)throw new Error('Expected a finite number in range');
    return x;
  };
  const values=(xs,maximum=1200)=>{
    if(!Array.isArray(xs)||!xs.length||xs.length>maximum)throw new Error('Expected a nonempty bounded numeric list');
    return xs.map(x=>number(x));
  };
  const rounded=x=>Math.floor(x*1e6+.5)/1e6;
  function seedFor(sku,asOf){let value=2166136261;for(const c of sku+'\0'+asOf)value=Math.imul(value^c.codePointAt(0),16777619)>>>0;return value||0x6d2b79f5;}
  function next(state){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
  function paths(s,lead,review,window){
    const supplied=s.demand_paths,duration=Math.min(review,Math.max(0,window));
    if(supplied!=null){
      if(!Array.isArray(supplied)||!supplied.length||supplied.length>10000)throw new Error('Expected 1..10000 demand paths');
      const result=[],n=Math.min(MAX_PATHS,supplied.length);
      for(let i=0;i<n;i++){
        const row=supplied[Math.floor(i*supplied.length/n)];let pre,post;
        if(Array.isArray(row)){
          const daily=values(row,7300),a=Math.ceil(lead),b=Math.ceil(lead+duration);
          if(daily.length<b)throw new Error('Daily path does not cover lead plus usable review');
          pre=daily.slice(0,a).reduce((a,b)=>a+b,0);post=daily.slice(a,b).reduce((a,b)=>a+b,0);
        }else if(row!==null&&typeof row==='object'){
          pre=number(get(row,'lead',0));post=number(row.demand)*(review?duration/review:0);
        }else{pre=number(get(s,'lead_demand',0));post=number(row)*(review?duration/review:0);}
        result.push([pre,post]);
      }
      return result;
    }
    if(Object.hasOwn(s,'history')&&!Array.isArray(s.history))throw new Error('Expected numeric history list');
    const predictions=values(get(s,'forecast',[s.forecast_mean]),120),history=s.history?.length?values(s.history):[],
      avg=history.length?history.reduce((a,b)=>a+b,0)/history.length:0,factors=avg?history.map(v=>v/avg):[1],sku=get(s,'sku',''),asOf=get(s,'as_of','');
    if(typeof sku!=='string'||Array.from(sku).length>1000||typeof asOf!=='string'||Array.from(asOf).length>32)throw new Error('Expected bounded SKU and snapshot strings');
    const count=Math.max(1,Math.ceil((lead+review)/30)),segments=[];
    for(let m=0;m<count;m++){
      const p=predictions[Math.min(m,predictions.length-1)]/30;
      segments.push([Math.max(0,Math.min(lead,(m+1)*30)-m*30)*p,Math.max(0,Math.min(lead+duration,(m+1)*30)-Math.max(lead,m*30))*p]);
    }
    let state=seedFor(sku,asOf);const out=[];
    for(let i=0;i<GENERATED_PATHS;i++){
      state=next(state);let pre=0,post=0,block=0;
      for(let m=0;m<segments.length;m++){
        if(m%3===0){state=next(state);block=state%factors.length;}
        const f=factors[(block+m%3)%factors.length];pre+=segments[m][0]*f;post+=segments[m][1]*f;
      }
      out.push([pre,post]);
    }
    return out;
  }
  function timeline(receipts,lead,duration){
    if(!Array.isArray(receipts)||receipts.length>1200)throw new Error('Expected bounded dated receipts');
    const supply=new Map(),end=lead+duration;
    for(const row of receipts){
      if(row===null||typeof row!=='object'||Array.isArray(row))throw new Error('Expected dated receipt');
      const day=number(row.day,0,7300),amount=number(row.quantity);
      if(day<=end)supply.set(day,(supply.get(day)||0)+amount);
    }
    const points=[...new Set([0,lead,end,...supply.keys()])].sort((a,b)=>a-b);
    return points.slice(0,-1).map((a,i)=>[a,points[i+1]-a,supply.get(a)||0,a>=lead]);
  }
  function residualNeed(pre,post,stock,incoming,lead,duration,events){
    if(events===null)return Math.max(0,post-Math.max(0,stock-pre)-incoming);
    let left=stock,missed=0;
    for(const [start,days,added,after] of events){
      left+=added+(start===lead?incoming:0);
      const demand=(after?(duration?post/duration:0):(lead?pre/lead:0))*days;
      if(after)missed+=Math.max(0,demand-left);
      left=Math.max(0,left-demand);
    }
    return missed;
  }
  function suggest(s){
    if(s===null||typeof s!=='object'||Array.isArray(s))throw new Error('Expected item inputs');
    if(s.sale_price==null||s.unit_cost==null)return null;
    const price=number(s.sale_price),cost=number(s.unit_cost),stock=number(get(s,'on_hand',0)),incoming=number(get(s,'incoming',0)),
      lead=number(get(s,'lead_days',0),0,3650),review=number(get(s,'review_days',30),0,3650),holding=number(get(s,'annual_holding_pct',20),0,100),
      fixed=number(get(s,'ordering_cost',0)),salvage=number(get(s,'salvage_pct',0),0,100),moq=number(get(s,'MOQ',get(s,'minimum_order',0))),pack=number(get(s,'pack',get(s,'pack_size',1)),.000001);
    if(Math.abs(pack*1e6-Math.round(pack*1e6))>.00001||Math.abs(moq*1e6-Math.round(moq*1e6))>.00001)throw new Error('Pack and MOQ need at most six decimals');
    let rawWindow=get(s,'usable_window_days',s.W);
    if(rawWindow==null&&s.shelf_life_days!=null)rawWindow=number(s.shelf_life_days,0,36500)-number(get(s,'arrival_age_days',0),0,36500)-number(get(s,'min_remaining_life_days',0),0,36500);
    const window=rawWindow==null?review:number(rawWindow,-73000,36500),cap=number(get(s,'shelf_cap_qty',1e12)),margin=price-cost,
      h=cost*holding/100*review/365,writeoff=rawWindow!=null&&window<=review?cost*(1-salvage/100):0,overage=h+writeoff,
      ratio=margin>0&&margin+overage>0?margin/(margin+overage):0;
    const duration=Math.min(review,Math.max(0,window)),events=Object.hasOwn(s,'receipts')?timeline(s.receipts,lead,duration):null;
    const residual=paths(s,lead,review,window).map(([pre,post])=>residualNeed(pre,post,stock,incoming,lead,duration,events)).sort((a,b)=>a-b),n=residual.length,prefix=[0];
    for(const d of residual)prefix.push(prefix.at(-1)+d);
    if(Math.max(residual.at(-1),moq,pack)*1e6>SAFE_TICKS)throw new Error('Quantity exceeds safe six-decimal grid precision');
    const grid=Math.floor(pack*1e6+.5),moqTicks=Math.floor(moq*1e6+.5),minimum=Math.max(1,Math.floor((moqTicks+grid-1)/grid)),
      capTicks=Math.min(SAFE_TICKS,Math.floor(cap*1e6+.0001)),maximum=Math.min(Math.floor(capTicks/grid),Math.max(minimum,Math.ceil(residual.at(-1)*1e6/grid))),candidates=new Set([0]);
    if(margin>0&&review>0&&window>0&&minimum<=maximum){
      const target=residual[Math.max(0,Math.min(n-1,Math.ceil(ratio*n-1e-12)-1))],center=Math.floor(target*1e6/grid);
      for(const k of [minimum,maximum,center-2,center-1,center,center+1,center+2,center+3])if(minimum<=k&&k<=maximum)candidates.add(k);
    }
    const ranked=[];
    for(const k of candidates){
      const q=k*grid/1e6;let lo=0,hi=n;
      while(lo<hi){const mid=Math.floor((lo+hi)/2);if(residual[mid]<=q)lo=mid+1;else hi=mid;}
      const sold=(prefix[lo]+q*(n-lo))/n,profit=margin*sold-overage*(q-sold)-(q>0?fixed:0);
      ranked.push({qty:q,expected_profit:rounded(profit)});
    }
    ranked.sort((a,b)=>b.expected_profit-a.expected_profit||a.qty-b.qty);
    const best=ranked[0],reason=window<=0?'Cannot stock: no usable shelf-life window.':best.qty===0?'Usable supply covers simulated demand, or a positive order does not repay modeled costs.':'Highest simulated margin after holding, write-off and ordering costs; MOQ/pack and shelf cap respected.';
    return {...best,alt:ranked.slice(1,3),reason,critical_ratio:rounded(ratio),method:'simulated'};
  }
  function unavailableReason(item,settings,guidance=null,resolved=null){
    const product=settings.product_overrides?.[item.sku]??{};
    if((product.profit_suggestion??settings.profit_suggestion)!==true)return null;
    if(guidance?.shelf_cap_qty!=null){
      const v=resolved?.values??{...item,...product},pack=v.pack_size||1,moq=v.minimum_order||0;
      const grid=Math.floor(pack*1e6+.5),minimum=Math.max(1,Math.floor((Math.floor(moq*1e6+.5)+grid-1)/grid)),capTicks=Math.floor(guidance.shelf_cap_qty*1e6+.0001);
      if(capTicks<=0)return 'Shelf life is too short for any order to be sold in time; using standard amount.';
      if(minimum*grid>capTicks)return 'Shelf-life cap conflicts with the minimum order or pack size; using standard amount.';
    }
    const history=item.monthly_sales??[],c=history.length?StockRunwayForecastMethods.classify(history):{};
    return (c.adi!=null&&c.adi>=1.32||c.cv2!=null&&c.cv2>=.49)?'Sales too irregular for a reliable profit estimate; using standard amount.':null;
  }
  function forGuidance(item,guidance,settings,resolved,now=null,supply=null,evaluate=suggest){
    const product=settings.product_overrides?.[item.sku]??{},enabled=product.profit_suggestion??settings.profit_suggestion??false;
    if(enabled!==true||guidance.quantity==null||guidance.status==='needs-data')return null;
    if(unavailableReason(item,settings,guidance,resolved))return null;
    const v=resolved.values;
    const curve=(item.projection??[]).map(row=>row.demand);let forecast=curve.length?curve:[item.monthly_demand??0];
    if(now!==null){const current=new Date((now-719163)*86400000),snapshot=item.as_of.slice(0,7),offset=Math.max(0,current.getUTCFullYear()*12+current.getUTCMonth()+1-(Number(snapshot.slice(0,4))*12+Number(snapshot.slice(5)))-1);forecast=forecast.slice(Math.min(offset,forecast.length-1));}
    const spec={sku:item.sku??'',as_of:(item.as_of??'').slice(0,7),history:item.monthly_sales??[],forecast,
      on_hand:Math.max(0,guidance.projected_balance_today??item.on_hand??0),incoming:item.on_order??0,lead_days:guidance.lead_days,
      review_days:v.review_days,unit_cost:v.unit_cost,sale_price:get(product,'sale_price',get(item,'sale_price',settings.sale_price)),annual_holding_pct:settings.holding_pct??20,
      ordering_cost:settings.order_cost||0,MOQ:v.minimum_order||0,pack:v.pack_size||1};
    if(guidance.shelf_cap_qty!=null)spec.shelf_cap_qty=guidance.shelf_cap_qty;
    for(const k of ['shelf_life_days','arrival_age_days','min_remaining_life_days','salvage_pct']){const value=k==='salvage_pct'?get(product,k,get(item,k,settings[k])):v[k];if(value!=null)spec[k]=value;}
    if(now!==null&&supply?.length)spec.receipts=supply.filter(row=>row.date>now).map(row=>({day:row.date-now,quantity:row.quantity}));
    const raw=evaluate(spec),result=raw===null?null:{...raw};
    if(result!==null)result.reason='Order-now estimate ('+v.review_days+'-day review; current plan has '+Math.ceil(resolved.settings.months_of_cover*30)+'-day cover). '+result.reason;
    return result;
  }
  return Object.freeze({suggest,forGuidance,unavailableReason});
})();
if(typeof module==='object'&&module.exports)module.exports=PROFIT_ORDER;
