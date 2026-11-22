/* Presentation-only mirror of profit_warnings.py; no quantity changes.
 * Kept outside the protected forecast/order core on every surface. */
;(function(root){
 'use strict';
 const WEEKLY_WARNING='Profit suggestion is less reliable with weekly ordering or deliveries already on the way — in tests it filled less demand. Use the standard amount if running out is costly.';
 const number=value=>typeof value==='number'&&Number.isFinite(value);
 function warning(item,guidance,reviewDays=30){
  const suggestion=guidance.profit_suggestion;
  if(!suggestion||typeof suggestion!=='object'||Array.isArray(suggestion))return '';
  const warnings=[],incoming=item.on_order;
  if((number(reviewDays)&&reviewDays<30)||(number(incoming)&&incoming>0))warnings.push(WEEKLY_WARNING);
  return warnings.join(' ');
 }
 root.StockRunwayProfitWarnings={warning};
})(globalThis);
