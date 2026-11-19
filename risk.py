"""Display-only empirical ranges and offline stockout scenarios; never order maths.

Bands: last 60 eligible one-step origins (prefix >=3), frozen forecast_lab
method, absolute-error linear quantiles .50/.90, sqrt(h) width. `flat` aliases
lab's baseline; `champion` reuses engine.forecast_method_values, unchanged.
Donor/external methods require unavailable context and are rejected, not mapped.
Below 8 errors, widths are at least 50% / 150% of max(p50,1).
No observed coverage or real-world calibration guarantee is implied.

Risk: 1000 circular moving-block (3 months) history draws, divided by history
mean and scaled to each supplied monthly forecast. Empty/all-zero history uses
factor 1. Forecast starts the month after as_of; its last value repeats beyond
its supplied horizon. Calendar daily demand is uniform, integrated at events,
not simulated day-by-day. Missing lead evidence uses scenario multipliers
[.9,1,1,1.1,1.25,1.5], NOT a fitted supplier distribution.

Seed: FNV-1a over Unicode code points of sku + NUL + as_of (uint32); zero
maps to 0x6d2b79f5. PRNG: xorshift32 (13,17,5); indices use uint32 % length.
Each path draws lead first, then one block start per 3 calendar demand months.
Output numeric band endpoints use floor(x*1e6+.5)/1e6; p50 is untouched.

Receipts are start-of-day supply, including today's. Past receipts are ignored.
Only ABSENT receipts enables the on_order fallback at today + nominal lead;
an explicit [] disables it (caller must reconcile unmatched on_order itself).
Order date is max(today,order_by), arrival adds ceil(sampled lead days).
`before` is any lost sale before the suggested arrival, including intervals
after existing receipts. `after` is any lost sale during the cover window starting
at sampled suggested arrival (ceil(cover_months*30) days, same as planner).
Stock floors at zero after every demand segment: prior lost sales are NOT debt.
Order multiplier changes proposed supply only; paths and seed stay paired.
"""
import calendar
import math
import re
from datetime import date, timedelta

try:
    from . import forecast_lab as lab
except ImportError:
    import forecast_lab as lab

PATHS = 1000
DEFAULT_LEADS = [.9, 1, 1, 1.1, 1.25, 1.5]


def _number(x, low=0.0, high=1e12):
    if isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) or not low <= x <= high:
        raise ValueError('Expected a finite number in range')
    return float(x)


def _values(xs, maximum=1200):
    if not isinstance(xs, list) or len(xs) > maximum:
        raise ValueError('Expected a bounded numeric list')
    return [_number(x) for x in xs]


def _month(value):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{3}-(0[1-9]|1[0-2])', value):
        raise ValueError('Expected YYYY-MM')
    return int(value[:4])*12 + int(value[5:])-1


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}', value):
        raise ValueError('Expected ISO date')
    return date.fromisoformat(value)


def _shift(month, offset):
    y, m = divmod(_month(month)+offset, 12)
    return f'{y:04d}-{m+1:02d}'


def _rounded(x):
    return math.floor(x*1e6+.5)/1e6


def prediction_bands(history, predictions, method='flat', as_of='2026-10', absolute_errors=None) -> dict:
    """Return display bands without replacing or adjusting any prediction."""
    ys, ps = _values(history), _values(predictions, 120)
    _month(as_of)
    method = 'baseline' if method == 'flat' else method
    if (method not in lab.METHODS and method not in ('calendar_seasonal', 'champion') and not (method == 'external' and absolute_errors is not None)) or method == 'similar':
        raise ValueError('Unsupported risk band method')
    champion = None
    if method == 'champion':
        try:
            from .engine import forecast_method_values as champion
        except ImportError:
            from engine import forecast_method_values as champion
    errors = []
    for origin in range(max(3, len(ys)-60), len(ys)) if absolute_errors is None else []:
        prefix = ys[:origin]
        if champion is not None:
            fitted = champion({}, method, prefix, _shift(as_of, origin-len(ys)), 1)
        elif method == 'calendar_seasonal':
            fitted = lab.calendar_seasonal(prefix, _shift(as_of, origin-len(ys)), 1)
        else:
            fitted = lab.forecast(prefix, 1, method) if lab.eligible(method, prefix) else None
        if fitted is not None:
            errors.append(abs(ys[origin]-fitted[0]))
    if absolute_errors is not None:
        errors = _values(absolute_errors)[-60:]
    thin = len(errors) < 8
    w50 = (lab.quantile(errors, .5) or 0)
    w90 = (lab.quantile(errors, .9) or 0)
    bands = []
    for h, p in enumerate(ps, 1):
        a = max(w50, max(p, 1)*.5 if thin else 0)*math.sqrt(h)
        b = max(w90, max(p, 1)*1.5 if thin else 0)*math.sqrt(h)
        bands.append(dict(p50=p, lo50=min(p, _rounded(max(0, p-a))), hi50=max(p, _rounded(p+a)),
                          lo90=min(p, _rounded(max(0, p-b))), hi90=max(p, _rounded(p+b))))
    return dict(thin_history=thin, samples=len(errors), bands=bands)


def _seed(sku, as_of):
    value = 2166136261
    for char in sku+'\0'+as_of:
        value = ((value ^ ord(char))*16777619) & 0xffffffff
    return value or 0x6d2b79f5


def _next(state):
    state ^= (state << 13) & 0xffffffff
    state ^= state >> 17
    state ^= (state << 5) & 0xffffffff
    return state & 0xffffffff


def _cover_end(arrival, cover):
    return arrival.toordinal() + math.ceil(cover*30)


def simulate_risk(spec, order_multiplier=1):
    """Paired deterministic demand/lead scenarios, not calibrated probabilities."""
    if not isinstance(spec, dict) or not isinstance(spec.get('sku'), str) or not spec['sku'] or len(spec['sku']) > 1000:
        raise ValueError('Expected spec with SKU')
    as_of = spec.get('as_of')
    first_month = _month(as_of)+1
    today, order = _date(spec.get('today')), _date(spec.get('order_by'))
    if today.year*12+today.month-1 < first_month:
        raise ValueError('Today precedes forecast start')
    history, predictions = _values(spec.get('history')), _values(spec.get('forecast'), 120)
    if not predictions:
        raise ValueError('Forecast must not be empty')
    stock = max(0, _number(spec.get('on_hand'), -1e12))
    incoming = _number(spec.get('on_order', 0))
    lead = _number(spec.get('lead_days'), 0, 3650)
    cover = _number(spec.get('cover_months'), 0, 36)
    quantity = _number(spec.get('quantity'))*_number(order_multiplier, 0, 100)
    # Completed supplier receipt spans are evidence only through the snapshot.
    # Five spans are needed; missing/invalid rows never become zero-day receipts.
    observed = []
    sy, sm = divmod(first_month-1, 12)
    snapshot = date(sy, sm+1, calendar.monthrange(sy, sm+1)[1])
    for row in spec.get('receipt_history', [])[:1200] if isinstance(spec.get('receipt_history', []), list) else []:
        if not isinstance(row, dict) or lead <= 0:
            continue
        try:
            start_date = _date(row.get('ordered_on') if row.get('ordered_on') is not None else row.get('ordered_date'))
            end_date = _date(row.get('received_on') if row.get('received_on') is not None else row.get('received_date'))
            span = (end_date-start_date).days
            if end_date <= snapshot and 0 <= span <= min(3650, lead*10):
                observed.append(span/lead)
        except (ValueError, TypeError):
            continue
    leads = _values(spec.get('lead_multipliers', observed[-100:] if len(observed) >= 5 else DEFAULT_LEADS), 100)
    if not leads or any(x > 10 for x in leads):
        raise ValueError('Expected 1..100 lead multipliers in 0..10')
    receipts = spec.get('receipts', None)
    if 'receipts' not in spec:
        receipts = [dict(date=(today+timedelta(days=math.ceil(lead))).isoformat(), quantity=incoming)]
    if not isinstance(receipts, list) or len(receipts) > 1200:
        raise ValueError('Expected bounded dated receipts')
    supply = {}
    for receipt in receipts:
        if not isinstance(receipt, dict):
            raise ValueError('Expected dated receipt')
        when, amount = _date(receipt.get('date')), _number(receipt.get('quantity'))
        if when >= today and amount > 0:
            key = when.toordinal()
            supply[key] = supply.get(key, 0)+amount
    start = today.toordinal()
    # Unique timelines avoid sorting/rebuilding calendar events in every path.
    timelines = {}
    for factor in leads:
        arrival = max(today, order).toordinal()+math.ceil(lead*factor)
        if arrival in timelines:
            continue
        end = _cover_end(date.fromordinal(arrival), cover)
        cutoff = arrival
        events = set([start, arrival, end, cutoff])
        events.update(day for day in supply if day <= end)
        cursor = today.replace(day=1)
        while cursor.toordinal() <= end:
            events.add(max(start, cursor.toordinal()))
            y, m = divmod(cursor.year*12+cursor.month, 12)
            cursor = date(y, m+1, 1)
        points = sorted(day for day in events if start <= day <= end)
        segments = []
        for a, b in zip(points, points[1:]):
            d = date.fromordinal(math.floor(a))
            month_index = d.year*12+d.month-1-(today.year*12+today.month-1)
            forecast_index = min(len(predictions)-1, d.year*12+d.month-1-first_month)
            demand = predictions[forecast_index]*(b-a)/calendar.monthrange(d.year, d.month)[1]
            segments.append((month_index, demand, supply.get(a, 0)+(quantity if a == arrival else 0),
                             a < cutoff, a >= arrival))
        month_count = segments[-1][0]+1 if segments else 0
        timelines[arrival] = (segments, month_count)
    avg = lab._mean(history)
    factors = [v/avg for v in history] if avg else [1]
    n = len(factors)
    seed = state = _seed(spec['sku'], as_of)
    before = after = 0
    for _ in range(PATHS):
        state = _next(state)
        arrival = max(today, order).toordinal()+math.ceil(lead*leads[state % len(leads)])
        segments, count = timelines[arrival]
        draws, block = [], 0
        for month in range(count):
            if month % 3 == 0:
                state = _next(state)
                block = state % n
            draws.append(factors[(block+month % 3) % n])
        left, missed_before, missed_after = stock, False, False
        for month, demand, added, pre, post in segments:
            left += added
            amount = demand*draws[month]
            missed = amount-left > max(1, amount, left)*1e-12
            if missed:
                missed_before = missed_before or pre
                missed_after = missed_after or post
            left = max(0, left-amount)
        before += missed_before
        after += missed_after
    return dict(before=before/PATHS, after=after/PATHS, paths=PATHS, seed=seed, thin_history=len(history) < 8)
