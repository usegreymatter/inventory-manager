/* Deterministic, offline port of forecast_lab/__init__.py. No dependencies or I/O.
 * Quantities remain continuous. Empirical ranges are not calibrated guarantees.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.StockRunwayForecastLab = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const METHODS = Object.freeze(['baseline', 'seasonal_naive', 'holt_damped', 'seasonal', 'croston', 'sba', 'similar']);
  const MAX_VALUE = 1e12;
  const DEFAULT_Z = 1.6448536269514722;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const mapping = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const truthy = x => Array.isArray(x) ? x.length > 0 : mapping(x) ? Object.keys(x).length > 0 : Boolean(x);
  // Match Python str.strip whitespace, including NEL but excluding BOM.
  const hasText = text => typeof text === 'string' && /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(text);
  const get = (object, key, fallback) => own(object, key) ? object[key] : fallback;
  const CALENDAR_NOTE='approx (Umm al-Qura), confirm locally';
  const HOLIDAY_STARTS=Object.freeze([["2015-06-18","ramadan"],["2015-09-23","adha"],["2016-06-06","ramadan"],["2016-09-11","adha"],["2017-05-27","ramadan"],["2017-09-01","adha"],["2018-05-16","ramadan"],["2018-08-21","adha"],["2019-05-06","ramadan"],["2019-08-11","adha"],["2020-04-24","ramadan"],["2020-07-31","adha"],["2021-04-13","ramadan"],["2021-07-20","adha"],["2022-04-02","ramadan"],["2022-07-09","adha"],["2023-03-23","ramadan"],["2023-06-28","adha"],["2024-03-11","ramadan"],["2024-06-16","adha"],["2025-03-01","ramadan"],["2025-06-06","adha"],["2026-02-18","ramadan"],["2026-05-27","adha"],["2027-02-08","ramadan"],["2027-05-16","adha"],["2028-01-28","ramadan"],["2028-05-05","adha"],["2029-01-16","ramadan"],["2029-04-24","adha"],["2030-01-05","ramadan"],["2030-04-13","adha"],["2030-12-26","ramadan"],["2031-04-02","adha"],["2031-12-16","ramadan"],["2032-03-22","adha"],["2032-12-04","ramadan"],["2033-03-12","adha"],["2033-11-23","ramadan"],["2034-03-01","adha"],["2034-11-12","ramadan"],["2035-02-19","adha"],["2035-11-01","ramadan"]].map(Object.freeze));
  function monthShift(month,offset){const [y,m]=month.split('-').map(Number),index=y*12+m-1+offset;return String(Math.floor(index/12)).padStart(4,'0')+'-'+String(index%12+1).padStart(2,'0');}
  function calendar_seasonal(xs,lastMonth,horizon=1){
    const ys=values(xs);checkHorizon(horizon);
    if(typeof lastMonth!=='string'||!(/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/).test(lastMonth))return null;
    const months=ys.map((_,i)=>monthShift(lastMonth,i-ys.length+1)),future=Array.from({length:horizon},(_,i)=>monthShift(lastMonth,i+1));
    if(ys.length<36||months[0]<'2015-01'||future.at(-1)>'2035-12')return null;
    const events=Object.fromEntries(['ramadan','adha'].map(k=>[k,new Set(HOLIDAY_STARTS.filter(r=>r[1]===k).map(r=>r[0].slice(0,7)))]));
    const ordinary=ys.filter((_,i)=>Object.values(events).every(e=>!e.has(months[i])));if(ordinary.length<12)return null;
    const effects={};
    for(const [kind,dates] of Object.entries(events)){
      const observed=ys.filter((_,i)=>dates.has(months[i]));if(observed.length<2)return null;
      effects[kind]=mean(observed)-mean(ordinary);
    }
    const effect=m=>sum(Object.entries(events).filter(([,e])=>e.has(m)).map(([k])=>effects[k]));
    const cleaned=ys.map((v,i)=>Math.max(0,v-effect(months[i]))),base=forecast(cleaned,horizon,'seasonal');
    return base.map((v,i)=>Math.max(0,v+effect(future[i])));
  }
  function inventory_classes(items){
    const counts=new Map(),eligible=[];
    for(const i of items)if(mapping(i)&&typeof i.sku==='string')counts.set(i.sku,(counts.get(i.sku)||0)+1);
    for(const i of items){
      if(!mapping(i)||typeof i.sku!=='string'||counts.get(i.sku)!==1)continue;
      try{const ys=values(i.monthly_sales);if(ys.length>=18)eligible.push([i,ys]);}catch{}
    }
    const byValue=eligible.length>0&&eligible.every(([i])=>typeof i.unit_cost==='number'&&Number.isFinite(i.unit_cost)&&i.unit_cost>0&&i.unit_cost<=MAX_VALUE);
    const rows=eligible.map(([i,ys])=>[i,ys,sum(ys.slice(-12))*(byValue?i.unit_cost:1)]).sort((a,b)=>b[2]-a[2]||stringCompare(a[0].sku,b[0].sku));
    const total=sum(rows.map(r=>r[2])),out=Object.create(null);let prior=0;
    for(const [i,ys,w] of rows){
      const avg=mean(ys),cv=avg?Math.sqrt(mean(ys.map(y=>(y-avg)*(y-avg))))/avg:null,sb=demand_class(ys);
      const abc=total?(prior/total<.8?'A':prior/total<.95?'B':'C'):'C',xyz=cv!==null&&cv<=.5?'X':cv!==null&&cv<=1?'Y':'Z';
      out[i.sku]={abc,xyz,demand:sb.class,adi:sb.adi,cv2:sb.cv2,basis:byValue?'value':'quantity',label:abc+xyz+' '+sb.class[0].toUpperCase()+sb.class.slice(1)};prior+=w;
    }
    return out;
  }
  function fail(message, type = 'ValueError') {
    const error = new Error(message);
    error.name = type;
    throw error;
  }
  function number(x, low = 0, high = MAX_VALUE) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < low || x > high) fail('Expected a finite number in range');
    return x;
  }
  function values(xs) {
    if (!Array.isArray(xs) || xs.length > 1200) fail('Expected at most 1200 monthly values');
    return Array.from(xs, x => number(x));
  }
  function checkHorizon(h) {
    if (!Number.isInteger(h) || h < 1 || h > 120) fail('Horizon must be an integer from 1 to 120');
  }
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  const mean = xs => xs.length ? sum(xs) / xs.length : 0;
  function quantile(xs, p) {
    number(p, 0, 1);
    if (!xs.length) return null;
    const ordered = xs.slice().sort((a, b) => a - b);
    const index = (ordered.length - 1) * p, i = Math.floor(index);
    return ordered[i] + (ordered[Math.min(i + 1, ordered.length - 1)] - ordered[i]) * (index - i);
  }
  function conformal_quantile(errors,q) {
    number(q,0,1);
    const ordered=errors.map(e=>number(e,-1e18,1e18)).sort((a,b)=>a-b),rank=Math.ceil((ordered.length+1)*q);
    return ordered.length&&rank<=ordered.length?ordered[Math.max(0,rank-1)]:null;
  }
  function demand_class(xs, production=false) {
    const ys=production?xs:values(xs),positive=ys.filter(y=>y>0);
    if(!positive.length)return {class_:'inactive',class:'inactive',adi:null,cv2:null};
    const avg=mean(positive),cv2=mean(positive.map(y=>(y-avg)*(y-avg)))/(avg*avg),adi=ys.length/positive.length;
    const name=adi>=1.32?(cv2>=.49?'lumpy':'intermittent'):(cv2>=.49?'erratic':'smooth');
    return {class_:name,class:name,adi,cv2};
  }
  function optionsFor(options, allowed, name) {
    if (!mapping(options)) fail('Options must be a mapping', 'TypeError');
    for (const key of Object.keys(options)) {
      if (!allowed.includes(key)) fail(`${name}() got an unexpected keyword argument '${key}'`, 'TypeError');
    }
    return options;
  }
  // Python sorts Unicode strings by code point, not UTF-16 code unit.
  function stringCompare(a, b) {
    const aa = Array.from(a), bb = Array.from(b);
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      const diff = aa[i].codePointAt(0) - bb[i].codePointAt(0);
      if (diff) return diff;
    }
    return aa.length - bb.length;
  }
  function clean_demand(rows, options = {}) {
    optionsFor(options, ['supersessions', 'transfers', 'manual_pct', 'suggest_outliers'], 'clean_demand');
    const { supersessions = null, transfers = null, manual_pct = null, suggest_outliers = false } = options;
    if (!Array.isArray(rows)) fail('Rows must be a list');
    const data = new Map(), metadata = new Map(), trace = [], flags = [];
    const keyOf = (sku, month) => JSON.stringify([sku, month]);
    const sorted = () => Array.from(data.keys()).sort((a, b) => {
      const aa = JSON.parse(a), bb = JSON.parse(b);
      return stringCompare(aa[0], bb[0]) || stringCompare(aa[1], bb[1]);
    });
    for (const row of rows) {
      if (!mapping(row) || !hasText(row.sku)) fail('Missing SKU');
      const month = row.month;
      if (typeof month !== 'string' || month.length !== 7 || !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(month)) fail('Invalid month');
      const key = keyOf(row.sku, month);
      if (data.has(key)) fail('Duplicate SKU/month');
      data.set(key, number(row.demand));
      metadata.set(key, { ...row });
    }
    function log(step, key, after) {
      const before = data.get(key) ?? 0;
      if (!Number.isFinite(after) || after < 0 || after > 1e18) fail('Adjusted demand exceeds arithmetic range');
      const [sku, month] = JSON.parse(key);
      trace.push({ step, sku, month, before, after });
      data.set(key, after);
    }
    function flag(key, code) {
      const [sku, month] = JSON.parse(key);
      flags.push({ sku, month, code });
    }
    for (const key of sorted()) {
      const row = metadata.get(key);
      let fraction = null;
      if (own(row, 'backorder') && typeof row.backorder !== 'boolean') fail('backorder must be boolean');
      if (own(row, 'in_stock_fraction')) fraction = number(row.in_stock_fraction, 0, 1);
      else if (own(row, 'in_stock_days')) {
        const days = number(row.days_in_month, 1, 31);
        fraction = number(row.in_stock_days, 0, days) / days;
      } else if (own(row, 'daily_stock')) {
        const daily = values(row.daily_stock);
        if (daily.length < 1 || daily.length > 31) fail('daily_stock needs 1..31 observed days');
        fraction = daily.filter(x => x > 0).length / daily.length;
      }
      if (fraction === null && (row.month_end_stock === 0 || row.month_end_stock === false)) flag(key, 'possible_stockout');
      if (fraction !== null && fraction < 0.25) flag(key, 'stockout_floor');
      const after = fraction !== null && !get(row, 'backorder', false) ? data.get(key) / Math.max(0.25, fraction) : data.get(key);
      log('stockout_correction', key, after);
    }
    for (const key of sorted()) {
      const row = metadata.get(key), oneoff = get(row, 'one_off', false);
      const excluded = oneoff === true ? data.get(key) : number(get(row, 'project_qty', 0)) + (oneoff === false ? 0 : number(oneoff));
      if (excluded > data.get(key)) fail('Project exclusion exceeds corrected demand');
      log('project_exclusion', key, data.get(key) - excluded);
    }
    if (truthy(suggest_outliers)) {
      const skus = Array.from(new Set(sorted().map(k => JSON.parse(k)[0]))).sort(stringCompare);
      for (const sku of skus) {
        const keys = sorted().filter(k => JSON.parse(k)[0] === sku);
        if (keys.length < 6) continue;
        const median = quantile(keys.map(k => data.get(k)), 0.5);
        const mad = quantile(keys.map(k => Math.abs(data.get(k) - median)), 0.5);
        for (const key of keys) {
          if (data.get(key) > median + Math.max(6 * 1.4826 * mad, 3 * Math.max(1, median))) flag(key, 'outlier_suggestion');
        }
      }
    }
    const links = truthy(supersessions) ? supersessions : {};
    if (!mapping(links)) fail('Supersessions must be a mapping');
    const targets = new Map();
    for (const source of Object.keys(links).sort(stringCompare)) {
      let cursor = source;
      const seen = new Set();
      while (own(links, cursor)) {
        if (seen.has(cursor) || typeof cursor !== 'string' || !hasText(links[cursor])) fail('Invalid/cyclic supersession');
        seen.add(cursor);
        cursor = links[cursor];
      }
      targets.set(source, cursor);
    }
    for (const key of sorted()) {
      const [sku, month] = JSON.parse(key), target = targets.get(sku);
      if (target) {
        const value = data.get(key);
        log('supersession', key, 0);
        const dest = keyOf(target, month);
        log('supersession', dest, (data.get(dest) ?? 0) + value);
      }
    }
    for (const transfer of truthy(transfers) ? transfers : []) {
      const source = transfer.from_sku, target = transfer.to_sku, month = transfer.month;
      const key = keyOf(source, month), dest = keyOf(target, month);
      const qty = number(transfer.quantity);
      if (!data.has(key) || !hasText(target) || source === target || own(links, source) || own(links, target)) {
        fail('Transfer needs distinct final SKUs and an existing source month');
      }
      if (qty > data.get(key)) fail('Transfer exceeds available demand');
      log('substitute_transfer', key, data.get(key) - qty);
      log('substitute_transfer', dest, (data.get(dest) ?? 0) + qty);
    }
    const changes = truthy(manual_pct) ? manual_pct : {};
    for (const sku of Object.keys(changes)) number(changes[sku], -100, 1000);
    for (const key of sorted()) {
      const sku = JSON.parse(key)[0];
      log('manual_change', key, data.get(key) * (1 + get(changes, sku, 0) / 100));
    }
    return { rows: sorted().map(k => ({ sku: JSON.parse(k)[0], month: JSON.parse(k)[1], demand: data.get(k) })), trace, flags };
  }
  function eligible(method, xs, similar = null) {
    const ys = values(xs), donor = similar !== null ? values(similar) : null;
    return eligibleValues(method,ys,donor);
  }
  function eligibleValues(method,ys,donor){
    // Private seam: both histories have already passed validation.
    if (!METHODS.includes(method)) fail('Unknown method');
    if (method === 'baseline') return true;
    if (method === 'seasonal_naive' || method === 'seasonal') return ys.length >= 24;
    if (method === 'croston' || method === 'sba') return ys.length >= 3 && ys.filter(y => y === 0).length > ys.length / 2;
    if (method === 'similar') return donor !== null && donor.length >= 3;
    return ys.length >= 3;
  }
  function forecast(xs, horizon = 1, method = 'baseline', similar = null, scale = 1) {
    const ys = values(xs);
    checkHorizon(horizon);
    scale = number(scale, 0, 100);
    if (!eligibleValues(method, ys, similar !== null ? values(similar) : null)) fail('Method needs more/different history');
    const n = ys.length;
    let result;
    if (method === 'baseline') result = Array(horizon).fill(mean(ys.slice(-12)));
    else if (method === 'seasonal_naive') result = Array.from({ length: horizon }, (_, h) => ys[n - 12 + h % 12]);
    else if (method === 'holt_damped') {
      const alpha = 0.4, beta = 0.2, phi = 0.9;
      let level = ys[0], trend = ys[1] - ys[0];
      for (const y of ys.slice(1)) {
        const previous = level;
        level = alpha * y + (1 - alpha) * (level + phi * trend);
        trend = beta * (level - previous) + (1 - beta) * phi * trend;
      }
      let damping = 0;
      result = [];
      for (let h = 1; h <= horizon; h++) {
        damping += phi ** h;
        result.push(Math.max(0, level + damping * trend));
      }
    } else if (method === 'seasonal') {
      const years = Math.floor(n / 12), window = ys.slice(-years * 12);
      const indices = Array(12).fill(0);
      for (let year = 0; year < years; year++) {
        const chunk = window.slice(year * 12, (year + 1) * 12), avg = mean(chunk);
        for (let j = 0; j < 12; j++) indices[j] += avg ? chunk[j] / avg : 1;
      }
      for (let j = 0; j < 12; j++) indices[j] /= years;
      const level = mean(ys.slice(-12));
      result = Array.from({ length: horizon }, (_, h) => level * indices[h % 12]);
    } else if (method === 'croston' || method === 'sba') {
      const positions = [];
      ys.forEach((y, i) => { if (y > 0) positions.push(i); });
      if (!positions.length) result = Array(horizon).fill(0);
      else {
        const first = positions[0];
        let size = ys[first], interval = first + 1, previous = first;
        for (const i of positions.slice(1)) {
          size += 0.1 * (ys[i] - size);
          interval += 0.1 * (i - previous - interval);
          previous = i;
        }
        const rate = size / interval * (method === 'sba' ? 0.95 : 1);
        result = Array(horizon).fill(rate);
      }
    } else {
      const donor = values(similar);
      result = forecast(donor, horizon, donor.length >= 24 ? 'seasonal' : 'baseline');
    }
    return result.map(x => Math.max(0, x * scale));
  }
  function donorPrefix(similar, n, origin) {
    return similar === null ? null : similar.slice(0, Math.max(0, similar.length - (n - origin)));
  }
  function backtest(xs, method = 'baseline', horizon = 3, similar = null, scale = 1) {
    const ys = values(xs);
    checkHorizon(horizon);
    if (similar !== null) values(similar);
    number(scale, 0, 100);
    if (!METHODS.includes(method)) fail('Unknown method');
    const folds = [];
    for (let origin = Math.max(3, ys.length - 12); origin < ys.length; origin++) {
      const donor = donorPrefix(similar, ys.length, origin);
      if (eligible(method, ys.slice(0, origin), donor)) {
        const actual = ys.slice(origin, origin + horizon);
        const prediction = forecast(ys.slice(0, origin), actual.length, method, donor, scale);
        folds.push({ origin, actual, prediction, errors: actual.map((a, i) => a - prediction[i]) });
      }
    }
    return folds;
  }
  function metrics(folds) {
    const actual = folds.flatMap(f => f.actual);
    const error = sum(folds.flatMap(f => f.errors.map(Math.abs)));
    return { mae: actual.length ? error / actual.length : null, wape: sum(actual) ? error / sum(actual) : null,
      points: actual.length, origins: folds.length };
  }
  function score_folds(xs,folds,scales=new Map()) {
    const ys=values(xs),out=metrics(folds),scaled=[],squares=[],signed=[],pin={'0.5':[],'0.8':[],'0.95':[]};
    const coverage={'0.8':{rate:null,samples:0,hits:0},'0.95':{rate:null,samples:0,hits:0}};
    let cfe=0,cumulative=0,pis=0,scaledCumulative=0,scaledPis=0,valid=true;
    for(const f of folds){
      // Training-only scales are invariant across methods for this SKU.
      if(!scales.has(f.origin)){
        const prefix=ys.slice(0,f.origin),lag=prefix.length>=24?12:1;
        let diffs=prefix.slice(lag).map((x,i)=>x-prefix[i]);
        if(!diffs.some(Boolean)&&lag===12)diffs=prefix.slice(1).map((x,i)=>x-prefix[i]);
        scales.set(f.origin,[mean(diffs.map(Math.abs)),mean(diffs.map(d=>d*d))]);
      }
      const [scale,scale2]=scales.get(f.origin),first=f.errors[0];
      cumulative+=first;pis-=cumulative;
      if(scale){scaledCumulative+=first/scale;scaledPis-=scaledCumulative;}
      f.errors.forEach((e,h)=>{
        cfe+=e;
        if(!scale){if(e!==0)valid=false;scaled.push(0);squares.push(0);signed.push(0);}
        else{scaled.push(Math.abs(e)/scale);squares.push(e*e/scale2);signed.push(e/scale);}
        const past=folds.filter(r=>r.errors.length>h&&r.origin+h+1<=f.origin).map(r=>r.errors[h]);
        // One validated ordering serves all three finite-sample quantiles.
        const ordered=past.map(e=>number(e,-1e18,1e18)).sort((a,b)=>a-b);
        for(const q of [.5,.8,.95]){
          const rank=Math.ceil((ordered.length+1)*q);
          const key=String(q),correction=ordered.length&&rank<=ordered.length?ordered[Math.max(0,rank-1)]:null,qe=e-(correction??0);
          pin[key].push(scale?Math.max(q*qe,(q-1)*qe)/scale:0);
          if(q!==.5&&correction!==null){coverage[key].samples++;coverage[key].hits+=Number(e<=correction);}
        }
      });
    }
    for(const row of Object.values(coverage))row.rate=row.samples?row.hits/row.samples:null;
    return Object.assign(out,{mase:scaled.length&&valid?mean(scaled):null,rmsse:squares.length&&valid?Math.sqrt(mean(squares)):null,
      cfe,scaled_cfe:signed.length&&valid?sum(signed):null,pis,scaled_pis:signed.length&&valid?scaledPis:null,
      scaled_pinball:Object.fromEntries(Object.entries(pin).map(([q,v])=>[q,v.length&&valid?mean(v):null])),coverage});
  }
  function adoption_gate(candidate,baseline){
    const a=candidate.mase,b=baseline.mase,ar=candidate.rmsse,br=baseline.rmsse,ac=candidate.scaled_cfe,bc=baseline.scaled_cfe,cov=candidate.coverage?.['0.8']||{};
    return a!=null&&b!=null&&b>0&&a<=.9*b&&ar!=null&&br!=null&&ar<=br+1e-12&&ac!=null&&bc!=null&&Math.abs(ac)<=Math.abs(bc)+1e-12&&cov.samples>=4&&cov.rate!=null&&cov.rate>=.6;
  }
  function pattern(xs) {
    const ys = values(xs);
    if (ys.length < 12) return 'new';
    if (ys.filter(y => y === 0).length > ys.length / 2) return 'intermittent';
    if (ys.length >= 24) {
      const base = mean(ys.slice(-12));
      const seasonalError = mean(ys.slice(12).map((y, i) => Math.abs(y - ys[i])));
      const flatError = mean(ys.slice(-12).map(x => Math.abs(x - base)));
      if (flatError > 0 && seasonalError < 0.7 * flatError) return 'seasonal';
    }
    const first = mean(ys.slice(0, 6)), last = mean(ys.slice(-6));
    if (Math.abs(last - first) > 0.3 * Math.max(1, mean(ys))) return 'trending';
    return 'smooth';
  }
  function bands(folds, future, horizon, aggregate = false) {
    const out = [];
    for (let h = 1; h <= horizon; h++) {
      const records = folds.filter(f => f.errors.length >= h).map(f => [f.origin, aggregate ? sum(f.errors.slice(0, h)) : f.errors[h - 1]]);
      const errors = records.map(r => r[1]);
      const center = aggregate ? sum(future.slice(0, h)) : future[h - 1];
      const value = p => {const offset=conformal_quantile(errors,p);return offset===null?null:Math.max(0,center+offset);};
      let hits = 0, checks = 0;
      for (const [origin, error] of records) {
        const past = records.filter(r => r[0] + h <= origin).map(r => r[1]);
        const lo=conformal_quantile(past.map(e=>-e),.95),hi=conformal_quantile(past,.95);
        if(lo!==null&&hi!==null){checks++;hits+=Number(-lo<=error&&error<=hi);}
      }
      out.push({ horizon: h, lower: value(0.05), upper: value(0.95), lean: value(0.5), recommended: value(0.8),
        stock_up: value(0.95), samples: errors.length, label: 'split conformal; finite tails only',
        coverage: { rate: checks ? hits / checks : null, samples: checks, target: 0.90 } });
    }
    return out;
  }
  function dateDays(text) {
    if (typeof text !== 'string') fail('Receipt requires ordered_date and received_date');
    if (text.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text)) fail('Invalid date');
    const year = Number(text.slice(0, 4)), month = Number(text.slice(5, 7)), day = Number(text.slice(8, 10));
    if (year === 0) fail('Invalid receipt date');
    if (month < 1 || month > 12) fail('Invalid receipt date');
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) fail('Invalid receipt date');
    // Integer proleptic-Gregorian ordinal, independent of timezone and Date parsing.
    const previous = year - 1;
    return previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400)
      + sum(days.slice(0, month - 1)) + day;
  }
  function leadTime(receipts) {
    if (receipts === null) receipts = [];
    if (!Array.isArray(receipts)) fail('Receipts must be a list');
    const spans = [];
    for (const row of receipts) {
      if (!mapping(row) || !own(row, 'ordered_date') || !own(row, 'received_date')) fail('Receipt requires ordered_date and received_date');
      // Python validates both date shapes before parsing either date.
      const a = row.ordered_date, b = row.received_date;
      if (typeof a !== 'string' || typeof b !== 'string') fail('Receipt requires ordered_date and received_date');
      if (a.length !== 10 || b.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(a) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b)) fail('Invalid date');
      const end = dateDays(b), start = dateDays(a);
      const days = end - start;
      number(days, 0, 3650);
      spans.push(days);
    }
    const enabled = spans.length >= 5;
    const avg = enabled ? mean(spans) : null;
    const sd = enabled ? Math.sqrt(sum(spans.map(x => (x - avg) ** 2)) / (spans.length - 1)) : null;
    return { enabled, samples: spans.length, mean_days: avg, sd_days: sd, slow_days: enabled ? quantile(spans, 0.95) : null };
  }
  function lead_demand_quantile(xs,leadDays,serviceLevel=.95){
    const ys=values(xs),lead=number(leadDays,0,7300); // maximum lead + review protection window
    if(![.90,.95,.99].includes(serviceLevel))fail('Unsupported service level');
    if(ys.length<24||ys.filter(y=>y>0).length<3)return null;
    const months=lead/30,avg=mean(ys),expected=avg*months,kind=demand_class(ys).class;
    let target,method;
    if(['intermittent','lumpy'].includes(kind)){
      const whole=Math.floor(months),fraction=months-whole,draws=[];let state=271828;
      for(let i=0;i<4096;i++){
        let total=0;
        for(let j=0;j<whole+Number(fraction>0);j++){
          state=(Math.imul(1664525,state)+1013904223)>>>0;
          total+=ys[Math.floor(state*ys.length/4294967296)]*(j<whole?1:fraction);
        }
        draws.push(total);
      }
      draws.sort((a,b)=>a-b);target=draws[Math.max(0,Math.ceil(draws.length*serviceLevel)-1)];method='empirical';
    }else{
      const sigma=Math.sqrt(mean(ys.map(y=>(y-avg)*(y-avg)))),z={0.9:1.2816,0.95:1.6449,0.99:2.3263}[serviceLevel];
      target=expected+z*sigma*Math.sqrt(months);method='normal';
    }
    return {quantile:Math.max(0,target),mean:expected,buffer:Math.max(0,target-expected),method,service_level:serviceLevel,samples:ys.length,draws:method==='empirical'?4096:0};
  }
  function safety_stock(errors, mean_monthly, lead_days = 30, review_days = 30, receipts = null, service_z = DEFAULT_Z) {
    if (!Array.isArray(errors)) fail('Errors must be a list');
    const es = Array.from(errors, x => number(x, -1e18, 1e18));
    mean_monthly = number(mean_monthly, 0, 1e18);
    lead_days = number(lead_days, 0, 3650);
    review_days = number(review_days, 0, 3650);
    const z = number(service_z, 0, 4), lead = leadTime(receipts);
    const typical = lead.enabled ? lead.mean_days : lead_days, protection = typical + review_days;
    const mse = es.length ? mean(es.map(e => e * e)) : null;
    const demand_variance = es.length ? mse * protection / 30 : null;
    const lead_variance = lead.enabled ? (mean_monthly / 30) ** 2 * lead.sd_days ** 2 : 0;
    return { quantity: es.length ? z * Math.sqrt(demand_variance + lead_variance) : null,
      error_rmse: es.length ? Math.sqrt(mse) : null, error_bias: es.length ? mean(es) : null,
      error_samples: es.length, protection_days: protection, demand_variance, lead_variance, lead_time: lead,
      label: 'approximate cycle-service buffer' };
  }
  function analyze(xs, options = {}) {
    optionsFor(options, ['horizon', 'similar', 'scale', 'lead_days', 'review_days', 'receipts', 'service_z'], 'analyze');
    const { horizon = 3, similar = null, scale = 1, lead_days = 30, review_days = 30, receipts = null, service_z = DEFAULT_Z } = options;
    const ys = values(xs);
    checkHorizon(horizon);
    number(scale, 0, 100);
    const donor = similar !== null ? values(similar) : null;
    const cutoff=Math.max(3,ys.length-12),tuning=ys.slice(0,cutoff),tuningDonor=donorPrefix(donor,ys.length,cutoff);
    const baselineFolds = backtest(tuning, 'baseline', horizon, tuningDonor, scale);
    let selected = 'baseline', bestGain = 0, chosenFolds = baselineFolds, chosenBase = baselineFolds;
    const candidates = {};
    for (const method of METHODS.slice(1)) {
      if (!eligible(method, ys, donor)) continue;
      const folds = backtest(tuning, method, horizon, tuningDonor, scale);
      const origins = new Set(folds.map(f => f.origin));
      const base = baselineFolds.filter(f => origins.has(f.origin));
      const metric = score_folds(tuning,folds), baselineMetric = score_folds(tuning,base);
      const gain = metric.mase !== null && baselineMetric.mase ? 1 - metric.mase / baselineMetric.mase : 0;
      const beats = folds.length >= 4 && adoption_gate(metric,baselineMetric);
      candidates[method] = { selected: metric, baseline: baselineMetric, beats_baseline: beats };
      if (beats && gain > bestGain + 1e-12) {
        selected = method; bestGain = gain; chosenFolds = folds; chosenBase = base;
      }
    }
    const future = forecast(ys, horizon, selected, donor, scale);
    const errorFolds = backtest(ys, selected, horizon, donor, scale).filter(f=>f.origin>=cutoff);
    const errors = errorFolds.map(f => f.errors[0]);
    const safety = safety_stock(errors, mean(future), lead_days, review_days, receipts, service_z);
    return { method: selected, pattern: pattern(ys), badge: selected === 'baseline' ? 'basic' : 'backtested',
      forecast: future, accuracy: { selected: score_folds(tuning,chosenFolds), baseline: score_folds(tuning,chosenBase), relative_mae_gain: bestGain,
        candidates, note: 'selection OOS; not independent final validation' },
      uncertainty: bands(errorFolds, future, horizon), aggregate_uncertainty: bands(errorFolds, future, horizon, true),
      safety_stock: safety, similar_proposal: eligible('similar', ys, donor) ? forecast(ys, horizon, 'similar', donor, scale) : null };
  }
  function analyze_sku(sku, values, options = {}) {
    if (!hasText(sku)) fail('Missing SKU');
    return { sku, ...analyze(values, options) };
  }
  return Object.freeze({ HOLIDAY_STARTS, CALENDAR_NOTE, calendar_seasonal, inventory_classes, lead_demand_quantile, score_folds, adoption_gate, conformal_quantile, demand_class, METHODS, MAX_VALUE, quantile, clean_demand, eligible, forecast, backtest, pattern, safety_stock, analyze, analyze_sku });
}));
