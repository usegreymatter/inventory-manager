/* Pure display-only mirror of cost_view.py. Unknown facts stay absent. */
;(function(root){
 'use strict';
 const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e12;
 function costMetrics(item,guidance={},risk={}){
  guidance=guidance||{};risk=risk||{};
  const cost=item.unit_cost,result={};if(!number(cost))return result;
  for(const [key,quantity]of [['money_tied_up',item.on_hand],['incoming_value',Object.hasOwn(guidance,'incoming_qty')?guidance.incoming_qty:item.on_order],['order_value',guidance.quantity],['expiry_value_at_risk',Object.hasOwn(guidance,'expiry_at_risk_qty')?guidance.expiry_at_risk_qty:item.expiry_at_risk_qty]])if(number(quantity))result[key]=quantity*cost;
  const monthly=Object.hasOwn(guidance,'monthly_demand')?guidance.monthly_demand:item.monthly_demand;
  if(number(monthly)){result.weekly_cost=monthly*7/30*cost;if(result.weekly_cost>0&&'money_tied_up'in result)result.money_cover_weeks=result.money_tied_up/result.weekly_cost;}
  const price=item.sale_price;if(number(price)){
   const margin=price-cost;result.margin_unit=margin;if(price>0)result.margin_pct=margin/price*100;
   if(number(item.on_hand)){result.stock_margin=item.on_hand*margin;result.stock_sale_value=item.on_hand*price;}
   if(number(risk.expected_shortfall_before))result.lost_profit_est=risk.expected_shortfall_before*Math.max(0,margin);
  }
  return result;
 }
 function costTotals(metrics){
  const result={count:metrics.length,coverage:{}};
  for(const row of metrics)for(const key of Object.keys(row))result.coverage[key]=(result.coverage[key]||0)+1;
  for(const key of ['money_tied_up','incoming_value','order_value','lost_profit_est','expiry_value_at_risk','weekly_cost','stock_margin','stock_sale_value']){const values=metrics.filter(row=>key in row).map(row=>row[key]);if(values.length)result[key]=values.reduce((a,b)=>a+b,0);}
  if(result.stock_sale_value>0)result.margin_pct=(result.stock_margin||0)/result.stock_sale_value*100;
  const paired=metrics.filter(row=>'money_tied_up'in row&&row.weekly_cost>0);if(paired.length)result.money_cover_weeks=paired.reduce((n,row)=>n+row.money_tied_up,0)/paired.reduce((n,row)=>n+row.weekly_cost,0);
  return result;
 }
 root.StockRunwayCosts={costMetrics,costTotals};
})(globalThis);
