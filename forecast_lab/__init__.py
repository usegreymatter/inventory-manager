"""Unwired, deterministic forecast laboratory. Standard library; no I/O.

All quantities are continuous (no monthly/pack rounding). See
 docs/forecast-lab/INTEGRATION.md for schema, gates, units and limitations.
"""
import math
import re
from datetime import date

METHODS = ('baseline', 'seasonal_naive', 'holt_damped', 'seasonal', 'croston', 'sba', 'similar')
MAX_VALUE = 1e12


# Frozen offline ICU islamic-umalqura starts, Gregorian 2015..2035.
# Approximation, not a local moon-sighting/holiday decree.
CALENDAR_NOTE = 'approx (Umm al-Qura), confirm locally'
HOLIDAY_STARTS = (('2015-06-18', 'ramadan'), ('2015-09-23', 'adha'), ('2016-06-06', 'ramadan'), ('2016-09-11', 'adha'), ('2017-05-27', 'ramadan'), ('2017-09-01', 'adha'), ('2018-05-16', 'ramadan'), ('2018-08-21', 'adha'), ('2019-05-06', 'ramadan'), ('2019-08-11', 'adha'), ('2020-04-24', 'ramadan'), ('2020-07-31', 'adha'), ('2021-04-13', 'ramadan'), ('2021-07-20', 'adha'), ('2022-04-02', 'ramadan'), ('2022-07-09', 'adha'), ('2023-03-23', 'ramadan'), ('2023-06-28', 'adha'), ('2024-03-11', 'ramadan'), ('2024-06-16', 'adha'), ('2025-03-01', 'ramadan'), ('2025-06-06', 'adha'), ('2026-02-18', 'ramadan'), ('2026-05-27', 'adha'), ('2027-02-08', 'ramadan'), ('2027-05-16', 'adha'), ('2028-01-28', 'ramadan'), ('2028-05-05', 'adha'), ('2029-01-16', 'ramadan'), ('2029-04-24', 'adha'), ('2030-01-05', 'ramadan'), ('2030-04-13', 'adha'), ('2030-12-26', 'ramadan'), ('2031-04-02', 'adha'), ('2031-12-16', 'ramadan'), ('2032-03-22', 'adha'), ('2032-12-04', 'ramadan'), ('2033-03-12', 'adha'), ('2033-11-23', 'ramadan'), ('2034-03-01', 'adha'), ('2034-11-12', 'ramadan'), ('2035-02-19', 'adha'), ('2035-11-01', 'ramadan'))


def _month_shift(month, offset):
    y,m = map(int,month.split('-'))
    index = y*12+m-1+offset
    return f'{index//12:04d}-{index%12+1:02d}'


def calendar_seasonal(values, last_month, horizon=1):
    ys = _values(values)
    _horizon(horizon)
    if not isinstance(last_month,str) or not re.fullmatch(r'[1-9][0-9]{3}-(0[1-9]|1[0-2])',last_month):
        return None
    months = [_month_shift(last_month,i-len(ys)+1) for i in range(len(ys))]
    future = [_month_shift(last_month,i+1) for i in range(horizon)]
    if len(ys)<36 or months[0]<'2015-01' or future[-1]>'2035-12':
        return None
    events = {kind:{d[:7] for d,k in HOLIDAY_STARTS if k==kind} for kind in ('ramadan','adha')}
    ordinary = [v for v,m in zip(ys,months) if all(m not in e for e in events.values())]
    if len(ordinary)<12:
        return None
    effects = {}
    for kind,dates in events.items():
        observed = [v for v,m in zip(ys,months) if m in dates]
        if len(observed)<2:
            return None
        effects[kind] = _mean(observed)-_mean(ordinary)
    cleaned = [max(0,v-_sum(effects[k] for k,e in events.items() if m in e)) for v,m in zip(ys,months)]
    base = forecast(cleaned,horizon,'seasonal')
    return [max(0,v+_sum(effects[k] for k,e in events.items() if m in e)) for v,m in zip(base,future)]


def inventory_classes(items):
    eligible = []
    counts = {}
    for item in items:
        if isinstance(item,dict) and isinstance(item.get('sku'),str):
            counts[item['sku']] = counts.get(item['sku'],0)+1
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get('sku'),str) or counts.get(item['sku']) != 1:
            continue
        try:
            ys = _values(item.get('monthly_sales'))
        except (ValueError,TypeError,OverflowError):
            continue
        if len(ys)>=18:
            eligible.append((item,ys))
    by_value = bool(eligible) and all(isinstance(i.get('unit_cost'),(float,int)) and not isinstance(i.get('unit_cost'),bool) and math.isfinite(i['unit_cost']) and 0<i['unit_cost']<=MAX_VALUE for i,_ in eligible)
    rows = [(i,ys,_sum(ys[-12:])*(i['unit_cost'] if by_value else 1)) for i,ys in eligible]
    rows.sort(key=lambda row:(-row[2],row[0]['sku']))
    total, prior, out = _sum(row[2] for row in rows),0.0,{}
    for item,ys,weight in rows:
        avg = _mean(ys)
        cv = math.sqrt(_mean([(y-avg)*(y-avg) for y in ys]))/avg if avg else None
        sb = demand_class(ys)
        abc = ('A' if prior/total<.8 else 'B' if prior/total<.95 else 'C') if total else 'C'
        xyz = 'X' if cv is not None and cv<=.5 else 'Y' if cv is not None and cv<=1 else 'Z'
        out[item['sku']] = dict(abc=abc,xyz=xyz,demand=sb['class'],adi=sb['adi'],cv2=sb['cv2'],basis='value' if by_value else 'quantity',label=abc+xyz+' '+sb['class'].capitalize())
        prior += weight
    return out


def _number(x, low=0, high=MAX_VALUE):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or not low <= x <= high:
        raise ValueError('Expected a finite number in range')
    return float(x)


def _values(xs):
    if not isinstance(xs, list) or len(xs) > 1200:
        raise ValueError('Expected at most 1200 monthly values')
    return [_number(x) for x in xs]


def _horizon(h):
    if isinstance(h, bool) or not isinstance(h, int) or not 1 <= h <= 120:
        raise ValueError('Horizon must be an integer from 1 to 120')


def _sum(xs):
    """Explicit left fold matches JS; Python 3.12+ changed builtin float sum."""
    total = 0.0
    for value in xs:
        total += value
    return total


def _mean(xs):
    return _sum(xs) / len(xs) if xs else 0.0


def quantile(xs, p):
    """Linear interpolation, index (n-1)*p; null for an empty empirical sample."""
    _number(p, 0, 1)
    if not xs:
        return None
    ordered = sorted(xs)
    index = (len(ordered)-1)*p
    i = math.floor(index)
    return ordered[i] + (ordered[min(i+1, len(ordered)-1)]-ordered[i])*(index-i)


def conformal_quantile(errors, q):
    """One-sided finite-sample order statistic; None is the +infinity rank."""
    _number(q, 0, 1)
    ordered = sorted(_number(e, -1e18, 1e18) for e in errors)
    rank = math.ceil((len(ordered)+1)*q)
    return ordered[max(0, rank-1)] if ordered and rank <= len(ordered) else None


def demand_class(values, *, production=False):
    # Production validates its own history length and permits adopted cleaning
    # uplifts above the raw-input 1e12 cap; retain the exact same classifier.
    ys = values if production else _values(values)
    positive = [y for y in ys if y > 0]
    if not positive:
        return dict(class_='inactive', **{'class': 'inactive'}, adi=None, cv2=None)
    mean = _mean(positive)
    cv2 = _mean([(y-mean)*(y-mean) for y in positive])/(mean*mean)
    adi = len(ys)/len(positive)
    name = ('lumpy' if cv2 >= .49 else 'intermittent') if adi >= 1.32 else ('erratic' if cv2 >= .49 else 'smooth')
    return dict(class_=name, **{'class': name}, adi=adi, cv2=cv2)


def clean_demand(rows, *, supersessions=None, transfers=None, manual_pct=None, suggest_outliers=False):
    """Ordered, immutable cleaning with a trace for every touched input/output.

    one_off is a boolean (entire month) or a numeric quantity; project_qty is
    additive to numeric one_off. Quantities refer to corrected demand units.
    Transfers refer to the FINAL supersession SKU and move demand in that month.
    """
    if not isinstance(rows, list):
        raise ValueError('Rows must be a list')
    data, metadata, trace, flags = {}, {}, [], []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('sku'), str) or not row['sku'].strip():
            raise ValueError('Missing SKU')
        month = row.get('month')
        if not isinstance(month, str) or not re.fullmatch(r'[1-9][0-9]{3}-(0[1-9]|1[0-2])', month):
            raise ValueError('Invalid month')
        key = (row['sku'], month)
        if key in data:
            raise ValueError('Duplicate SKU/month')
        data[key], metadata[key] = _number(row.get('demand')), dict(row)
    def log(step, key, after):
        before = data.get(key, 0.0)
        if not math.isfinite(after) or not 0 <= after <= 1e18:
            raise ValueError('Adjusted demand exceeds arithmetic range')
        trace.append(dict(step=step, sku=key[0], month=key[1], before=before, after=after))
        data[key] = after
    def flag(key, code):
        flags.append(dict(sku=key[0], month=key[1], code=code))
    for key in sorted(data):
        row, fraction = metadata[key], None
        if 'backorder' in row and not isinstance(row['backorder'], bool):
            raise ValueError('backorder must be boolean')
        if 'in_stock_fraction' in row:
            fraction = _number(row['in_stock_fraction'], 0, 1)
        elif 'in_stock_days' in row:
            days = _number(row.get('days_in_month'), 1, 31)
            fraction = _number(row['in_stock_days'], 0, days)/days
        elif 'daily_stock' in row:
            daily = _values(row['daily_stock'])
            if not 1 <= len(daily) <= 31:
                raise ValueError('daily_stock needs 1..31 observed days')
            fraction = _sum(1 for x in daily if x > 0)/len(daily)
        if fraction is None and row.get('month_end_stock') == 0:
            flag(key, 'possible_stockout')
        if fraction is not None and fraction < .25:
            flag(key, 'stockout_floor')
        after = data[key] / max(.25, fraction) if fraction is not None and not row.get('backorder', False) else data[key]
        log('stockout_correction', key, after)
    for key in sorted(data):
        row = metadata[key]
        oneoff = row.get('one_off', False)
        excluded = data[key] if oneoff is True else _number(row.get('project_qty', 0)) + (0 if oneoff is False else _number(oneoff))
        if excluded > data[key]:
            raise ValueError('Project exclusion exceeds corrected demand')
        log('project_exclusion', key, data[key]-excluded)
    if suggest_outliers:
        for sku in sorted({k[0] for k in data}):
            keys = sorted(k for k in data if k[0] == sku)
            if len(keys) < 6:
                continue
            median = quantile([data[k] for k in keys], .5)
            mad = quantile([abs(data[k]-median) for k in keys], .5)
            for key in keys:
                if data[key] > median + max(6*1.4826*mad, 3*max(1, median)):
                    flag(key, 'outlier_suggestion')
    links = supersessions or {}
    if not isinstance(links, dict):
        raise ValueError('Supersessions must be a mapping')
    targets = {}
    for source in sorted(links):
        cursor, seen = source, set()
        while cursor in links:
            if cursor in seen or not isinstance(cursor, str) or not isinstance(links[cursor], str) or not links[cursor].strip():
                raise ValueError('Invalid/cyclic supersession')
            seen.add(cursor)
            cursor = links[cursor]
        targets[source] = cursor
    for key in sorted(list(data)):
        target = targets.get(key[0])
        if target:
            value = data[key]
            log('supersession', key, 0.0)
            dest = (target, key[1])
            log('supersession', dest, data.get(dest, 0.0)+value)
    for transfer in transfers or []:
        source, target, month = transfer.get('from_sku'), transfer.get('to_sku'), transfer.get('month')
        key, dest = (source, month), (target, month)
        qty = _number(transfer.get('quantity'))
        if key not in data or not isinstance(target, str) or not target.strip() or source == target or source in links or target in links:
            raise ValueError('Transfer needs distinct final SKUs and an existing source month')
        if qty > data[key]:
            raise ValueError('Transfer exceeds available demand')
        log('substitute_transfer', key, data[key]-qty)
        log('substitute_transfer', dest, data.get(dest, 0.0)+qty)
    changes = manual_pct or {}
    for sku, pct in changes.items():
        if not isinstance(sku, str):
            raise ValueError('Invalid manual change SKU')
        _number(pct, -100, 1000)
    for key in sorted(data):
        log('manual_change', key, data[key]*(1+changes.get(key[0], 0)/100))
    return dict(rows=[dict(sku=k[0], month=k[1], demand=data[k]) for k in sorted(data)], trace=trace, flags=flags)


def eligible(method, values, similar=None):
    ys = _values(values)
    donor = _values(similar) if similar is not None else None
    return _eligible(method, ys, donor)


def _eligible(method, ys, donor):
    # Private seam: callers have already validated both histories once.
    if method not in METHODS:
        raise ValueError('Unknown method')
    if method == 'baseline':
        return True
    if method in ('seasonal_naive', 'seasonal'):
        return len(ys) >= 24
    if method in ('croston', 'sba'):
        return len(ys) >= 3 and _sum(1 for y in ys if y == 0) > len(ys)/2
    if method == 'similar':
        return donor is not None and len(donor) >= 3
    return len(ys) >= 3


def forecast(values, horizon=1, method='baseline', similar=None, scale=1):
    ys = _values(values)
    _horizon(horizon)
    scale = _number(scale, 0, 100)
    if not _eligible(method, ys, _values(similar) if similar is not None else None):
        raise ValueError('Method needs more/different history')
    n = len(ys)
    if method == 'baseline':
        result = [_mean(ys[-12:])]*horizon
    elif method == 'seasonal_naive':
        result = [ys[n-12+h % 12] for h in range(horizon)]
    elif method == 'holt_damped':
        alpha, beta, phi = .4, .2, .9
        level, trend = ys[0], ys[1]-ys[0]
        for y in ys[1:]:
            previous = level
            level = alpha*y+(1-alpha)*(level+phi*trend)
            trend = beta*(level-previous)+(1-beta)*phi*trend
        damping, result = 0.0, []
        for h in range(1, horizon+1):
            damping += phi**h
            result.append(max(0, level+damping*trend))
    elif method == 'seasonal':
        # Whole years only: normalize each year before averaging indices.
        years = n//12
        window = ys[-years*12:]
        indices = [0.0]*12
        for year in range(years):
            chunk = window[year*12:(year+1)*12]
            avg = _mean(chunk)
            for j in range(12):
                indices[j] += chunk[j]/avg if avg else 1
        indices = [x/years for x in indices]
        level = _mean(ys[-12:])
        result = [level*indices[h % 12] for h in range(horizon)]
    elif method in ('croston', 'sba'):
        positions = [i for i, y in enumerate(ys) if y > 0]
        if not positions:
            result = [0.0]*horizon
        else:
            first = positions[0]
            size, interval, previous = ys[first], float(first+1), first
            for i in positions[1:]:
                size += .1*(ys[i]-size)
                interval += .1*(i-previous-interval)
                previous = i
            rate = size/interval*(.95 if method == 'sba' else 1)
            result = [rate]*horizon
    else:
        donor = _values(similar)
        donor_method = 'seasonal' if len(donor) >= 24 else 'baseline'
        result = forecast(donor, horizon, donor_method)
    return [max(0, x*scale) for x in result]


def _donor_prefix(similar, n, origin):
    if similar is None:
        return None
    # Donor and target end at the same snapshot; never read later donor months.
    return similar[:max(0, len(similar)-(n-origin))]


def backtest(values, method='baseline', horizon=3, similar=None, scale=1):
    ys = _values(values)
    _horizon(horizon)
    if similar is not None:
        _values(similar)
    _number(scale, 0, 100)
    if method not in METHODS:
        raise ValueError('Unknown method')
    folds = []
    for origin in range(max(3, len(ys)-12), len(ys)):
        donor = _donor_prefix(similar, len(ys), origin)
        if eligible(method, ys[:origin], donor):
            actual = ys[origin:origin+horizon]
            prediction = forecast(ys[:origin], len(actual), method, donor, scale)
            folds.append(dict(origin=origin, actual=actual, prediction=prediction,
                              errors=[a-p for a, p in zip(actual, prediction)]))
    return folds


def _metrics(folds):
    actual = [a for f in folds for a in f['actual']]
    error = _sum(abs(e) for f in folds for e in f['errors'])
    return dict(mae=error/len(actual) if actual else None,
                wape=error/_sum(actual) if _sum(actual) else None, points=len(actual), origins=len(folds))


def score_folds(values, folds, *, _scales=None):
    """Training-only MASE/RMSSE, signed CFE, one-step PIS, scaled pinball.

    Seasonal lag=12 with >=24 training months; otherwise lag=1. Degenerate
    seasonal differences fall back to lag=1; all-constant scale is undefined.
    Quantile corrections/coverage use only older fully matured residuals at
    the same horizon. Before calibration, pinball scores the point forecast.
    """
    ys = _values(values)
    # Internal callers share training-only scales within one fixed SKU prefix.
    scales = {} if _scales is None else _scales
    out = _metrics(folds)
    scaled, squares, signed, pin = [], [], [], {str(q): [] for q in (.5,.8,.95)}
    coverage = {str(q): dict(rate=None,samples=0,hits=0) for q in (.8,.95)}
    cfe, cumulative, pis, scaled_cumulative, scaled_pis = 0.0, 0.0, 0.0, 0.0, 0.0
    valid = True
    for f in folds:
        origin = f['origin']
        if origin not in scales:
            prefix = ys[:origin]
            lag = 12 if len(prefix) >= 24 else 1
            diffs = [prefix[i]-prefix[i-lag] for i in range(lag,len(prefix))]
            if not any(diffs) and lag == 12:
                diffs = [prefix[i]-prefix[i-1] for i in range(1,len(prefix))]
            scales[origin] = (_mean([abs(d) for d in diffs]), _mean([d*d for d in diffs]))
        scale, scale2 = scales[origin]
        first = f['errors'][0]
        cumulative += first
        pis -= cumulative
        if scale:
            scaled_cumulative += first/scale
            scaled_pis -= scaled_cumulative
        for h,e in enumerate(f['errors']):
            cfe += e
            if not scale:
                if e != 0:
                    valid = False
                scaled.append(0.0); squares.append(0.0); signed.append(0.0)
            else:
                scaled.append(abs(e)/scale); squares.append(e*e/scale2); signed.append(e/scale)
            past = [r['errors'][h] for r in folds if len(r['errors']) > h and r['origin']+h+1 <= f['origin']]
            # The three finite-sample quantiles share one validated ordering.
            ordered = sorted(_number(e, -1e18, 1e18) for e in past)
            for q in (.5,.8,.95):
                key = str(q)
                rank = math.ceil((len(ordered)+1)*q)
                correction = ordered[max(0,rank-1)] if ordered and rank <= len(ordered) else None
                qe = e-(correction if correction is not None else 0)
                pin[key].append(max(q*qe,(q-1)*qe)/scale if scale else 0.0)
                if q != .5 and correction is not None:
                    coverage[key]['samples'] += 1
                    coverage[key]['hits'] += int(e <= correction)
    for row in coverage.values():
        row['rate'] = row['hits']/row['samples'] if row['samples'] else None
    out.update(mase=_mean(scaled) if scaled and valid else None,
               rmsse=math.sqrt(_mean(squares)) if squares and valid else None,
               cfe=cfe, scaled_cfe=_sum(signed) if signed and valid else None,
               pis=pis, scaled_pis=scaled_pis if signed and valid else None,
               scaled_pinball={q:_mean(v) if v and valid else None for q,v in pin.items()}, coverage=coverage)
    return out


def adoption_gate(candidate, baseline):
    a,b = candidate.get('mase'),baseline.get('mase')
    ar,br = candidate.get('rmsse'),baseline.get('rmsse')
    ac,bc = candidate.get('scaled_cfe'),baseline.get('scaled_cfe')
    coverage = candidate.get('coverage',{}).get('0.8',{})
    return (a is not None and b is not None and b > 0 and a <= .9*b
            and ar is not None and br is not None and ar <= br+1e-12
            and ac is not None and bc is not None and abs(ac) <= abs(bc)+1e-12
            and coverage.get('samples',0) >= 4 and coverage.get('rate') is not None and coverage['rate'] >= .6)


def pattern(values):
    ys = _values(values)
    if len(ys) < 12:
        return 'new'
    if _sum(1 for y in ys if y == 0) > len(ys)/2:
        return 'intermittent'
    if len(ys) >= 24:
        base = _mean(ys[-12:])
        seasonal_error = _mean([abs(ys[i]-ys[i-12]) for i in range(12, len(ys))])
        flat_error = _mean([abs(x-base) for x in ys[-12:]])
        if flat_error > 0 and seasonal_error < .7*flat_error:
            return 'seasonal'
    first, last = _mean(ys[:6]), _mean(ys[-6:])
    if abs(last-first) > .3*max(1, _mean(ys)):
        return 'trending'
    return 'smooth'


def _bands(folds, future, horizon, aggregate=False):
    bands = []
    for h in range(1, horizon+1):
        records = [(f['origin'], _sum(f['errors'][:h]) if aggregate else f['errors'][h-1])
                   for f in folds if len(f['errors']) >= h]
        errors = [e for _, e in records]
        center = _sum(future[:h]) if aggregate else future[h-1]
        def value(p):
            offset = conformal_quantile(errors,p)
            return max(0,center+offset) if offset is not None else None
        hits, checks = 0, 0
        for origin, error in records:
            # Older h-step errors must have matured before this forecast origin.
            past = [e for o, e in records if o+h <= origin]
            lo,hi = conformal_quantile([-e for e in past],.95),conformal_quantile(past,.95)
            if lo is not None and hi is not None:
                checks += 1
                hits += int(-lo <= error <= hi)
        bands.append(dict(horizon=h, lower=value(.05), upper=value(.95), lean=value(.5),
                          recommended=value(.8), stock_up=value(.95), samples=len(errors),
                          label='split conformal; finite tails only',
                          coverage=dict(rate=hits/checks if checks else None, samples=checks, target=.90)))
    return bands


def _lead_time(receipts):
    if receipts is None:
        receipts = []
    if not isinstance(receipts, list):
        raise ValueError('Receipts must be a list')
    spans = []
    for row in receipts:
        try:
            a, b = row['ordered_date'], row['received_date']
            if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', a) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', b):
                raise ValueError('Invalid date')
            try:
                days = (date.fromisoformat(b)-date.fromisoformat(a)).days
            except ValueError:
                raise ValueError('Invalid receipt date') from None
            _number(days, 0, 3650)
            spans.append(days)
        except (KeyError, TypeError):
            raise ValueError('Receipt requires ordered_date and received_date') from None
    enabled = len(spans) >= 5
    mean = _mean(spans) if enabled else None
    sd = math.sqrt(_sum((x-mean)**2 for x in spans)/(len(spans)-1)) if enabled else None
    return dict(enabled=enabled, samples=len(spans), mean_days=mean, sd_days=sd,
                slow_days=quantile(spans, .95) if enabled else None)


def lead_demand_quantile(values, lead_days, service_level=.95):
    """IID observed-month resampling, no Markov states or artificial jitter.

    A fractional month is proportional demand from one independent month draw.
    Fixed 4096 draws and a shared unsigned LCG seed make ports reproducible.
    """
    ys = _values(values)
    lead = _number(lead_days,0,7300) # maximum lead + review protection window
    if service_level not in (.90,.95,.99):
        raise ValueError('Unsupported service level')
    if len(ys) < 24 or len([y for y in ys if y>0]) < 3:
        return None
    months = lead/30
    avg = _mean(ys)
    expected = avg*months
    kind = demand_class(ys)['class']
    if kind in ('intermittent','lumpy'):
        whole, fraction = math.floor(months), months-math.floor(months)
        state, draws = 271828, []
        for _ in range(4096):
            total = 0.0
            for j in range(whole+int(fraction>0)):
                state = (1664525*state+1013904223) & 0xffffffff
                total += ys[(state*len(ys))//4294967296]*(1 if j<whole else fraction)
            draws.append(total)
        target = sorted(draws)[max(0,math.ceil(len(draws)*service_level)-1)]
        method = 'empirical'
    else:
        sigma = math.sqrt(_mean([(y-avg)*(y-avg) for y in ys]))
        z = {.90:1.2816,.95:1.6449,.99:2.3263}[service_level]
        target = expected+z*sigma*math.sqrt(months)
        method = 'normal'
    return dict(quantile=max(0,target), mean=expected, buffer=max(0,target-expected),
                method=method, service_level=service_level, samples=len(ys), draws=4096 if method=='empirical' else 0)


def safety_stock(errors, mean_monthly, lead_days=30, review_days=30, receipts=None, service_z=1.6448536269514722):
    if not isinstance(errors, list):
        raise ValueError('Errors must be a list')
    es = [_number(x, -1e18, 1e18) for x in errors]
    mean_monthly = _number(mean_monthly, 0, 1e18)
    lead_days, review_days = _number(lead_days, 0, 3650), _number(review_days, 0, 3650)
    z = _number(service_z, 0, 4)
    lead = _lead_time(receipts)
    typical = lead['mean_days'] if lead['enabled'] else lead_days
    protection = typical+review_days
    mse = _mean([e*e for e in es]) if es else None
    demand_variance = mse*protection/30 if es else None
    lead_variance = (mean_monthly/30)**2*lead['sd_days']**2 if lead['enabled'] else 0.0
    return dict(quantity=z*math.sqrt(demand_variance+lead_variance) if es else None,
                error_rmse=math.sqrt(mse) if es else None, error_bias=_mean(es) if es else None,
                error_samples=len(es), protection_days=protection, demand_variance=demand_variance,
                lead_variance=lead_variance, lead_time=lead, label='approximate cycle-service buffer')


def analyze(values, horizon=3, similar=None, scale=1, lead_days=30, review_days=30, receipts=None, service_z=1.6448536269514722):
    ys = _values(values)
    _horizon(horizon)
    _number(scale, 0, 100)
    donor = _values(similar) if similar is not None else None
    cutoff = max(3,len(ys)-12)
    tuning = ys[:cutoff]
    tuning_donor = _donor_prefix(donor,len(ys),cutoff)
    baseline_folds = backtest(tuning, 'baseline', horizon, tuning_donor, scale)
    selected, best_gain, candidates = 'baseline', 0.0, {}
    chosen_folds, chosen_base = baseline_folds, baseline_folds
    for method in METHODS[1:]:
        if not eligible(method, ys, donor):
            continue
        folds = backtest(tuning, method, horizon, tuning_donor, scale)
        origins = {f['origin'] for f in folds}
        base = [f for f in baseline_folds if f['origin'] in origins]
        metric, baseline_metric = score_folds(tuning,folds), score_folds(tuning,base)
        gain = (1-metric['mase']/baseline_metric['mase']) if metric['mase'] is not None and baseline_metric['mase'] else 0.0
        beats = len(folds) >= 4 and adoption_gate(metric,baseline_metric)
        candidates[method] = dict(selected=metric, baseline=baseline_metric, beats_baseline=beats)
        if beats and gain > best_gain+1e-12:
            selected, best_gain, chosen_folds, chosen_base = method, gain, folds, base
    future = forecast(ys, horizon, selected, donor, scale)
    # Error estimation uses the displayed method, not in-sample fitted residuals.
    error_folds = [f for f in backtest(ys, selected, horizon, donor, scale) if f['origin'] >= cutoff]
    errors = [f['errors'][0] for f in error_folds]
    safety = safety_stock(errors, _mean(future), lead_days, review_days, receipts, service_z)
    return dict(method=selected, pattern=pattern(ys), badge='basic' if selected == 'baseline' else 'backtested',
                forecast=future, accuracy=dict(selected=score_folds(tuning,chosen_folds), baseline=score_folds(tuning,chosen_base),
                    relative_mae_gain=best_gain, candidates=candidates, note='selection OOS; not independent final validation'),
                uncertainty=_bands(error_folds, future, horizon),
                aggregate_uncertainty=_bands(error_folds, future, horizon, True), safety_stock=safety,
                similar_proposal=forecast(ys, horizon, 'similar', donor, scale) if eligible('similar', ys, donor) else None)


def analyze_sku(sku, values, **options):
    """Identity-bearing per-SKU report; see analyze for forecast options."""
    if not isinstance(sku, str) or not sku.strip():
        raise ValueError('Missing SKU')
    return dict(sku=sku, **analyze(values, **options))
