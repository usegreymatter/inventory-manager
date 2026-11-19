/* Opt-in monthly forecast library. No dependencies, I/O or engine integration.
 * Fixed rules and fallback contract: docs/forecast-methods-spec.md.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockRunwayForecastMethods = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const METHODS = Object.freeze(['auto', 'naive', 'seasonal_naive', 'ma3', 'ma6', 'ma12', 'ses',
    'holt_damped', 'hw_additive', 'hw_multiplicative', 'theta', 'croston', 'sba', 'tsb', 'adida', 'combination']);
  const METHOD_LABELS = Object.freeze(Object.fromEntries(METHODS.map((m, i) => [m, [
    'Automatic (fixed rules)', 'Last month', 'Same month last year',
    '3-month average', '6-month average', '12-month average',
    'Simple exponential smoothing', 'Damped trend', 'Additive seasonal smoothing',
    'Multiplicative seasonal smoothing', 'Theta (level + drift)', 'Croston',
    'Syntetos–Boylan approximation', 'TSB (occurrence + size)',
    'ADIDA (aggregate + disaggregate)', 'Median combination'][i]])));
  const PRESETS = Object.freeze(Object.fromEntries(Object.entries({
    distributor: {method: 'auto', note: 'Starting point only; review lead times and demand history.'},
    retail: {method: 'ses', note: 'Level-based starting point; review promotions separately.'},
    'spare-parts': {method: 'sba', note: 'Intermittent-demand starting point; review criticality separately.'},
    restaurant: {method: 'ma3', note: 'Recent-demand starting point; review waste and service constraints separately.'},
    pharmacy: {method: 'auto', note: 'Demand-planning starting point only; qualified staff must review product-specific constraints.'},
    seasonal: {method: 'hw_additive', note: 'Needs at least 24 monthly observations; otherwise uses SES.'},
    ecommerce: {method: 'theta', note: 'Trend-aware starting point; review promotions and assortment changes.'},
  }).map(([key, value]) => [key, Object.freeze(value)])));
  const MAX_VALUE = 1e12;
  const sum = xs => xs.reduce((total, x) => total + x, 0);
  const mean = xs => xs.length ? sum(xs) / xs.length : 0;
  const rounded = x => Math.floor(x * 1e9 + .5) / 1e9;
  function fail(message) { throw new RangeError(message); }
  function values(xs) {
    if (!Array.isArray(xs) || xs.length > 1200) fail('Expected a list of at most 1200 monthly values');
    // Array.from also checks holes: sparse arrays are not observations.
    const copy = Array.from(xs, x => {
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > MAX_VALUE)
        fail('Expected finite monthly values from 0 to 1e12');
      return x;
    });
    const scale = copy.length ? Math.max(...copy) : 0;
    return [copy.map(x => x > 0 ? Math.max(Number.MIN_VALUE, x / scale) : 0), scale];
  }
  function ses(ys) {
    let bestError = Infinity, bestLevel = ys[0];
    for (let step = 1; step < 10; step++) {
      const alpha = step / 10;
      let level = ys[0], error = 0;
      for (const y of ys.slice(1)) {
        error += (y - level) * (y - level);
        level += alpha * (y - level);
      }
      if (error < bestError) { bestError = error; bestLevel = level; }
    }
    return bestLevel;
  }
  function slope(ys) {
    const center = (ys.length - 1) / 2, avg = mean(ys);
    let numerator = 0, denominator = 0;
    ys.forEach((y, i) => {
      const offset = i - center;
      numerator += offset * (y - avg);
      denominator += offset * offset;
    });
    return denominator ? numerator / denominator : 0;
  }
  function damped(ys, horizon) {
    if (ys.length < 2) return Array(horizon).fill(ses(ys));
    let level = ys[0], trend = ys[1] - ys[0];
    for (const y of ys.slice(1)) {
      const previous = level;
      level = .4 * y + .6 * (level + .9 * trend);
      trend = .2 * (level - previous) + .8 * .9 * trend;
    }
    let damping = 0, power = 1;
    const result = [];
    for (let h = 0; h < horizon; h++) {
      power *= .9; damping += power;
      result.push(level + damping * trend);
    }
    return result;
  }
  function hw(ys, horizon, multiplicative, metadata) {
    const fallback = () => { if (metadata) metadata.method = 'ses'; return Array(horizon).fill(ses(ys)); };
    if (ys.length < 24 || (multiplicative && ys.some(y => y === 0))) return fallback();
    let level = mean(ys.slice(0, 12));
    if (multiplicative && level <= 1e-12) return fallback();
    let trend = (mean(ys.slice(12, 24)) - level) / 12;
    const seasons = ys.slice(0, 12).map(y => multiplicative ? y / level : y - level);
    for (let i = 12; i < ys.length; i++) {
      const slot = i % 12, previous = level, seasonal = seasons[slot];
      if (multiplicative) {
        if (seasonal <= 1e-12) return fallback();
        level = .3 * (ys[i] / seasonal) + .7 * (level + .9 * trend);
        if (level <= 1e-12 || !Number.isFinite(level)) return fallback();
        seasons[slot] = .2 * (ys[i] / level) + .8 * seasonal;
      } else {
        level = .3 * (ys[i] - seasonal) + .7 * (level + .9 * trend);
        seasons[slot] = .2 * (ys[i] - level) + .8 * seasonal;
      }
      trend = .1 * (level - previous) + .9 * .9 * trend;
    }
    let damping = 0, power = 1;
    const result = [];
    for (let h = 0; h < horizon; h++) {
      power *= .9; damping += power;
      const base = level + damping * trend, seasonal = seasons[(ys.length + h) % 12];
      result.push(multiplicative ? base * seasonal : base + seasonal);
    }
    return result;
  }
  function intermittent(ys, method) {
    const first = ys.findIndex(y => y > 0);
    let size = ys[first], interval = first + 1, previous = first;
    if (method === 'tsb') {
      let probability = 1 / interval;
      for (const y of ys.slice(first + 1)) {
        probability += .1 * ((y > 0 ? 1 : 0) - probability);
        if (y > 0) size += .1 * (y - size);
      }
      return probability * size;
    }
    for (let i = first + 1; i < ys.length; i++) if (ys[i] > 0) {
      size += .1 * (ys[i] - size);
      interval += .1 * (i - previous - interval);
      previous = i;
    }
    return size / interval * (method === 'sba' ? .95 : 1);
  }
  function classifyValues(ys) {
    const n = ys.length, positives = ys.filter(y => y > 0), avg = mean(positives);
    const adi = positives.length ? n / positives.length : null;
    const cv2 = positives.length ? mean(positives.map(y => (y / avg - 1) * (y / avg - 1))) : null;
    const b = slope(ys), trend = positives.length ? b / mean(ys) : 0;
    let strength = 0;
    if (n >= 24 && positives.length) {
      const residual = ys.map((y, i) => y - b * (i - (n - 1) / 2));
      const avgResidual = mean(residual);
      const phaseTotals = Array(12).fill(0), phaseCounts = Array(12).fill(0);
      for (let i = 0; i < n; i++) { phaseTotals[i % 12] += residual[i]; phaseCounts[i % 12]++; }
      const phases = phaseTotals.map((v, j) => v / phaseCounts[j]);
      const total = sum(residual.map(v => (v - avgResidual) * (v - avgResidual)));
      const error = sum(residual.map((v, i) => (v - phases[i % 12]) * (v - phases[i % 12])));
      strength = total > 1e-20 ? Math.max(0, Math.min(1, 1 - error / total)) : 0;
    }
    let zeroRun = 0;
    for (let i = n - 1; i >= 0 && ys[i] === 0; i--) zeroRun++;
    const priorAdi = positives.length ? (n - zeroRun) / positives.length : 0;
    let name;
    if (n < 12) name = 'new';
    else if (!positives.length) name = 'inactive';
    else if ((positives.length >= 4 && zeroRun >= Math.max(6, Math.ceil(3 * priorAdi))) ||
             (n >= 18 && ys.slice(-18, -6).filter(y => y > 0).length >= 6 && mean(ys.slice(-6)) <= .25 * mean(ys.slice(-18, -6)))) name = 'dying';
    else if (n >= 24 && strength >= .6) name = 'seasonal';
    else name = adi >= 1.32 ? (cv2 >= .49 ? 'lumpy' : 'intermittent') : (cv2 >= .49 ? 'erratic' : 'smooth');
    const method = {new: 'ses', inactive: 'naive', dying: 'naive', seasonal: 'hw_additive',
      smooth: 'ses', erratic: 'combination', intermittent: 'sba', lumpy: 'adida'}[name];
    return {class: name, adi: adi === null ? null : rounded(adi), cv2: cv2 === null ? null : rounded(cv2),
      history_months: n, seasonality_strength: rounded(strength),
      trend: (trend < 0 ? -1 : 1) * rounded(Math.abs(trend)), method};
  }
  function classify(xs) { return classifyValues(values(xs)[0]); }
  function forecastValues(ys, horizon, selected, metadata) {
    const method = selected === 'auto' ? classifyValues(ys).method : selected, n = ys.length;
    if (method === 'naive') return Array(horizon).fill(ys[n - 1]);
    if (method === 'seasonal_naive') {
      if (n < 12 && metadata) metadata.method = 'naive';
      return Array.from({length: horizon}, (_, h) => n >= 12 ? ys[n - 12 + h % 12] : ys[n - 1]);
    }
    if (['ma3', 'ma6', 'ma12'].includes(method)) return Array(horizon).fill(mean(ys.slice(-Number(method.slice(2)))));
    if (method === 'ses') return Array(horizon).fill(ses(ys));
    if (method === 'holt_damped') return damped(ys, horizon);
    if (['hw_additive', 'hw_multiplicative'].includes(method)) return hw(ys, horizon, method === 'hw_multiplicative', metadata);
    if (method === 'theta') {
      const level = ses(ys), drift = slope(ys) / 2;
      return Array.from({length: horizon}, (_, h) => level + drift * (h + 1));
    }
    if (['croston', 'sba', 'tsb'].includes(method)) return Array(horizon).fill(intermittent(ys, method));
    if (method === 'adida') {
      const block = Math.min(12, Math.max(1, Math.floor(n / ys.filter(y => y > 0).length + .5)));
      const start = n % block, aggregates = [];
      for (let i = start; i < n; i += block) aggregates.push(sum(ys.slice(i, i + block)));
      return Array(horizon).fill(ses(aggregates) / block);
    }
    const members = ['ses', 'theta', 'holt_damped'].map(m => forecastValues(ys, horizon, m));
    return Array.from({length: horizon}, (_, h) => members.map(member => member[h]).sort((a, b) => a - b)[1]);
  }
  function forecast(xs, horizon = 12, method = 'ses') {
    const [ys, scale] = values(xs);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 120) fail('Horizon must be an integer from 1 to 120');
    if (!METHODS.includes(method)) fail('Unknown method');
    if (!scale) return Array(horizon).fill(0);
    return forecastValues(ys, horizon, method).map(v => rounded(Math.min(MAX_VALUE, Math.max(0, v * scale))));
  }
  function forecast_with_metadata(xs, horizon = 12, method = 'ses') {
    const [ys, scale] = values(xs);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 120) fail('Horizon must be an integer from 1 to 120');
    if (!METHODS.includes(method)) fail('Unknown method');
    const classification = classifyValues(ys), selected = method === 'auto' ? classification.method : method;
    const metadata = {method: selected};
    let curve;
    if (scale) curve = forecastValues(ys, horizon, selected, metadata).map(v => rounded(Math.min(MAX_VALUE, Math.max(0, v * scale))));
    else {
      curve = Array(horizon).fill(0);
      if (selected === 'hw_multiplicative' || selected === 'hw_additive' && ys.length < 24) metadata.method = 'ses';
      else if (selected === 'seasonal_naive' && ys.length < 12) metadata.method = 'naive';
    }
    return {forecast: curve, classification, ...metadata, fallback: metadata.method !== selected};
  }
  return Object.freeze({METHODS, METHOD_LABELS, PRESETS, forecast, classify, forecast_with_metadata});
}));
