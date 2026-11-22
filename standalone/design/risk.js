/* Display-only mirror of risk.py. No I/O or changes to forecasts/orders.
 * See risk.py module docstring for event timing, fallbacks and PRNG contract.
 * Bands reuse the frozen lexical STOCKOUT_LAB or StockRunwayForecastLab.
 * `champion` additionally uses the existing core forecastMethodValues function.
 * Scenario frequencies are not calibrated real-world guarantees.
 */
;(function (root) {
  'use strict';
  const PATHS = 1000, DEFAULT_LEADS = [.9, 1, 1, 1.1, 1.25, 1.5];
  const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
  function fail(message) { const e = new Error(message); e.name = 'ValueError'; throw e; }
  function number(x, low = 0, high = 1e12) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < low || x > high) fail('Expected a finite number in range');
    return x;
  }
  function values(xs, maximum = 1200) {
    if (!Array.isArray(xs) || xs.length > maximum) fail('Expected a bounded numeric list');
    return Array.from(xs, x => number(x));
  }
  function month(x) {
    if (typeof x !== 'string' || x.length !== 7 || !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(x)) fail('Expected YYYY-MM');
    return Number(x.slice(0, 4))*12 + Number(x.slice(5))-1;
  }
  // Ordinals match datetime.date.toordinal(), independent of local timezone.
  const parts = ordinal => {
    const d = new Date((ordinal-719163)*86400000);
    return [d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate()];
  };
  function ordinal(y, m, d) {
    if (y < 1000 || y > 9999) fail('Date exceeds supported calendar');
    return Date.UTC(y, m-1, d)/86400000+719163;
  }
  function date(x) {
    if (typeof x !== 'string' || x.length !== 10 || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(x)) fail('Expected ISO date');
    const [y, m, d] = x.split('-').map(Number), out = ordinal(y, m, d);
    if (parts(out).some((v, i) => v !== [y, m, d][i])) fail('Invalid calendar date');
    return out;
  }
  const days = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function shift(x, offset) {
    const i = month(x)+offset;
    return String(Math.floor(i/12)).padStart(4, '0')+'-'+String(i%12+1).padStart(2, '0');
  }
  const rounded = x => Math.floor(x*1e6+.5)/1e6;
  function predictionBands(history, predictions, method = 'flat', asOf = '2026-10', absoluteErrors = null) {
    const ys = values(history), ps = values(predictions, 120),
      lab = typeof STOCKOUT_LAB !== 'undefined' ? STOCKOUT_LAB : root.StockRunwayForecastLab;
    month(asOf);
    if (!lab) fail('Frozen StockRunwayForecastLab dependency is required');
    method = method === 'flat' ? 'baseline' : method;
    if ((!lab.METHODS.includes(method) && !['calendar_seasonal', 'champion'].includes(method) && !(method === 'external' && absoluteErrors !== null)) || method === 'similar') fail('Unsupported risk band method');
    if (method === 'champion' && typeof forecastMethodValues !== 'function') fail('Frozen core dependency is required for champion');
    const errors = [];
    for (let origin = Math.max(3, ys.length-60); absoluteErrors === null && origin < ys.length; origin++) {
      const prefix = ys.slice(0, origin), originMonth = shift(asOf, origin-ys.length);
      const fitted = method === 'champion' ? forecastMethodValues({}, method, prefix, originMonth, 1)
        : method === 'calendar_seasonal' ? lab.calendar_seasonal(prefix, originMonth, 1)
        : lab.eligible(method, prefix) ? lab.forecast(prefix, 1, method) : null;
      if (fitted !== null) errors.push(Math.abs(ys[origin]-fitted[0]));
    }
    if (absoluteErrors !== null) errors.push(...values(absoluteErrors).slice(-60));
    const thin = errors.length < 8, w50 = errors.length ? lab.quantile(errors, .5) : 0,
      w90 = errors.length ? lab.quantile(errors, .9) : 0;
    return {thin_history:thin, samples:errors.length, bands:ps.map((p, i) => {
      const a = Math.max(w50, thin ? Math.max(p, 1)*.5 : 0)*Math.sqrt(i+1),
        b = Math.max(w90, thin ? Math.max(p, 1)*1.5 : 0)*Math.sqrt(i+1);
      return {p50:p, lo50:Math.min(p, rounded(Math.max(0, p-a))), hi50:Math.max(p, rounded(p+a)),
        lo90:Math.min(p, rounded(Math.max(0, p-b))), hi90:Math.max(p, rounded(p+b))};
    })};
  }
  function seedFor(sku, asOf) {
    let value = 2166136261;
    for (const char of sku+'\0'+asOf) value = Math.imul(value ^ char.codePointAt(0), 16777619) >>> 0;
    return value || 0x6d2b79f5;
  }
  function next(state) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  }
  function coverEnd(arrival, cover) {
    return arrival + Math.ceil(cover*30);
  }
  function simulateRisk(spec, orderMultiplier = 1) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || typeof spec.sku !== 'string' || !spec.sku || Array.from(spec.sku).length > 1000) fail('Expected spec with SKU');
    const asOf = spec.as_of, firstMonth = month(asOf)+1, today = date(spec.today), order = date(spec.order_by),
      [ty, tm] = parts(today), todayMonth = ty*12+tm-1;
    if (todayMonth < firstMonth) fail('Today precedes forecast start');
    const history = values(spec.history), predictions = values(spec.forecast, 120);
    if (!predictions.length) fail('Forecast must not be empty');
    const stock = Math.max(0, number(spec.on_hand, -1e12)), incoming = number(own(spec, 'on_order') ? spec.on_order : 0),
      lead = number(spec.lead_days, 0, 3650), cover = number(spec.cover_months, 0, 36),
      quantity = number(spec.quantity)*number(orderMultiplier, 0, 100);
    const observed = [], snapshot = ordinal(Math.floor(month(asOf)/12), month(asOf)%12+1, days(Math.floor(month(asOf)/12), month(asOf)%12+1));
    for (const row of (Array.isArray(spec.receipt_history) ? spec.receipt_history.slice(0,1200) : [])) {
      if (!row || typeof row !== 'object' || lead <= 0) continue;
      try {
        const a = date(row.ordered_on ?? row.ordered_date), b = date(row.received_on ?? row.received_date), span = b-a;
        if (b <= snapshot && span >= 0 && span <= Math.min(3650, lead*10)) observed.push(span/lead);
      } catch { /* Malformed receipt evidence is not a zero-day observation. */ }
    }
    const leads = values(own(spec, 'lead_multipliers') ? spec.lead_multipliers : observed.length >= 5 ? observed.slice(-100) : DEFAULT_LEADS, 100);
    if (!leads.length || leads.some(x => x > 10)) fail('Expected 1..100 lead multipliers in 0..10');
    // Explicit receipts, even [], suppress the on_order fallback.
    const receipts = own(spec, 'receipts') ? spec.receipts : [{date:parts(today+Math.ceil(lead)).map((x, i) => String(x).padStart(i ? 2 : 4, '0')).join('-'), quantity:incoming}];
    if (!Array.isArray(receipts) || receipts.length > 1200) fail('Expected bounded dated receipts');
    const supply = new Map();
    for (const receipt of receipts) {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('Expected dated receipt');
      const when = date(receipt.date), amount = number(receipt.quantity);
      if (when >= today && amount > 0) supply.set(when, (supply.get(when) || 0)+amount);
    }
    const timelines = new Map();
    for (const factor of leads) {
      const arrival = Math.max(today, order)+Math.ceil(lead*factor);
      if (timelines.has(arrival)) continue;
      const end = coverEnd(arrival, cover), cutoff = arrival,
        events = new Set([today, arrival, end, cutoff]);
      for (const day of supply.keys()) if (day <= end) events.add(day);
      let cursor = ordinal(ty, tm, 1);
      while (cursor <= end) {
        events.add(Math.max(today, cursor));
        const [y, m] = parts(cursor), index = y*12+m;
        cursor = ordinal(Math.floor(index/12), index%12+1, 1);
      }
      const points = [...events].filter(day => day >= today && day <= end).sort((a, b) => a-b), segments = [];
      for (let i = 0; i < points.length-1; i++) {
        const a = points[i], b = points[i+1], [y, m] = parts(Math.floor(a)), monthIndex = y*12+m-1-todayMonth,
          forecastIndex = Math.min(predictions.length-1, y*12+m-1-firstMonth), demand = predictions[forecastIndex]*(b-a)/days(y, m);
        segments.push([monthIndex, demand, (supply.get(a) || 0)+(a === arrival ? quantity : 0), a < cutoff, a >= arrival]);
      }
      timelines.set(arrival, [segments, segments.length ? segments.at(-1)[0]+1 : 0]);
    }
    const avg = history.length ? history.reduce((a, b) => a+b, 0)/history.length : 0,
      factors = avg ? history.map(v => v/avg) : [1], n = factors.length, seed = seedFor(spec.sku, asOf);
    let state = seed, before = 0, after = 0, shortfallBefore = 0;
    for (let path = 0; path < PATHS; path++) {
      state = next(state);
      const arrival = Math.max(today, order)+Math.ceil(lead*leads[state%leads.length]), [segments, count] = timelines.get(arrival), draws = [];
      let block = 0;
      for (let m = 0; m < count; m++) {
        if (m%3 === 0) { state = next(state); block = state%n; }
        draws.push(factors[(block+m%3)%n]);
      }
      let left = stock, missedBefore = false, missedAfter = false;
      for (const [m, demand, added, pre, post] of segments) {
        left += added;
        const amount = demand*draws[m], missed = amount-left > Math.max(1, amount, left)*1e-12;
        if (pre) shortfallBefore += Math.max(0, amount-left);
        if (missed) { missedBefore ||= pre; missedAfter ||= post; }
        left = Math.max(0, left-amount);
      }
      before += Number(missedBefore); after += Number(missedAfter);
    }
    const result = {before:before/PATHS, after:after/PATHS, paths:PATHS, seed, thin_history:history.length < 8};
    if (spec.include_shortfall === true) result.expected_shortfall_before = shortfallBefore/PATHS;
    return result;
  }
  root.StockRunwayRisk = Object.freeze({predictionBands, simulateRisk});
}(globalThis));
