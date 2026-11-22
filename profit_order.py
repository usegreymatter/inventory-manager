"""Pure opt-in, empirical single-review profit suggestion (not an order).

Demand uncertainty reuses risk.py's FNV/xorshift + circular three-month block
sampler, read-only. No fitting, filesystem, global RNG, or forecast changes.
See docs/PROFIT-ORDER.md for the economic horizon and approximation limits.
"""
import bisect
import math
from datetime import date

try:
    from .risk import _seed, _next
except ImportError:
    from risk import _seed, _next

MAX_PATHS = 200
GENERATED_PATHS = 96
SAFE_TICKS = 9007199254740991


def _sum(xs):
    # Explicit binary64 order also matches JS on Python 3.12+.
    total = 0.0
    for x in xs:
        total += x
    return total


def _number(x, low=0, high=1e12):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or not low <= x <= high:
        raise ValueError('Expected a finite number in range')
    return float(x)


def _values(xs, maximum=1200):
    if not isinstance(xs, list) or not xs or len(xs) > maximum:
        raise ValueError('Expected a nonempty bounded numeric list')
    return [_number(x) for x in xs]


def _round(x):
    return math.floor(x*1e6+.5)/1e6


def _paths(s, lead, review, window):
    """Return paired pre-arrival and usable post-arrival demand totals."""
    supplied = s.get('demand_paths')
    duration = min(review, max(0, window))
    if supplied is not None:
        if not isinstance(supplied, list) or not supplied or len(supplied) > 10000:
            raise ValueError('Expected 1..10000 demand paths')
        result = []
        for i in range(min(MAX_PATHS, len(supplied))):
            row = supplied[i*len(supplied)//min(MAX_PATHS, len(supplied))]
            if isinstance(row, dict):
                pre, post = _number(row.get('lead', 0)), _number(row.get('demand'))
                post *= duration/review if review else 0
            elif isinstance(row, list):
                daily = _values(row, 7300)
                a, b = math.ceil(lead), math.ceil(lead+duration)
                if len(daily) < b:
                    raise ValueError('Daily path does not cover lead plus usable review')
                pre, post = _sum(daily[:a]), _sum(daily[a:b])
            else:
                pre, post = _number(s.get('lead_demand', 0)), _number(row)*(duration/review if review else 0)
            result.append((pre, post))
        return result
    predictions = _values(s.get('forecast', [s.get('forecast_mean')]), 120)
    if 'history' in s and not isinstance(s['history'], list):
        raise ValueError('Expected numeric history list')
    history = _values(s['history']) if s.get('history') else []
    avg = _sum(history)/len(history) if history else 0
    factors = [v/avg for v in history] if avg else [1.0]
    sku, as_of = s.get('sku', ''), s.get('as_of', '')
    if not isinstance(sku, str) or len(sku) > 1000 or not isinstance(as_of, str) or len(as_of) > 32:
        raise ValueError('Expected bounded SKU and snapshot strings')
    # Planner convention: 30-day demand months. Existing cloud shape, no refit.
    count = max(1, math.ceil((lead+review)/30))
    segments = []
    for m in range(count):
        p = predictions[min(m, len(predictions)-1)]/30
        pre = max(0, min(lead, (m+1)*30)-m*30)*p
        post = max(0, min(lead+duration, (m+1)*30)-max(lead, m*30))*p
        segments.append((pre, post))
    state = _seed(sku, as_of)
    out = []
    for _ in range(GENERATED_PATHS):
        # risk.py consumes a lead draw before each demand path. Nominal lead here.
        state = _next(state)
        pre = post = 0.0
        block = 0
        for m, (a, b) in enumerate(segments):
            if m % 3 == 0:
                state = _next(state)
                block = state % len(factors)
            f = factors[(block+m % 3) % len(factors)]
            pre += a*f
            post += b*f
        out.append((pre, post))
    return out


def _timeline(receipts, lead, duration):
    if not isinstance(receipts, list) or len(receipts) > 1200:
        raise ValueError('Expected bounded dated receipts')
    supply = {}
    end = lead+duration
    for row in receipts:
        if not isinstance(row, dict):
            raise ValueError('Expected dated receipt')
        day, amount = _number(row.get('day'), 0, 7300), _number(row.get('quantity'))
        if day <= end:
            supply[day] = supply.get(day, 0)+amount
    points = sorted({0.0, lead, end, *supply})
    return [(a, b-a, supply.get(a, 0), a >= lead) for a, b in zip(points, points[1:])]


def _residual(pre, post, stock, incoming, lead, duration, timeline):
    if timeline is None:
        return max(0, post-max(0, stock-pre)-incoming)
    left, missed = stock, 0.0
    for start, days, added, after in timeline:
        left += added+(incoming if start == lead else 0)
        demand = (post/duration if duration else 0) * days if after else (pre/lead if lead else 0) * days
        if after:
            missed += max(0, demand-left)
        left = max(0, left-demand)
    return missed


def suggest(item_inputs):
    """Return a separate suggestion or None when either price is absent.

    demand_paths: post-arrival totals, {lead,demand} totals, or daily arrays;
    otherwise forecast monthly values + history use the existing risk sampler.
    incoming is assumed usable at proposed arrival. MOQ (alias minimum_order),
    pack (alias pack_size), usable_window_days (alias W), shelf_cap_qty optional.
    """
    s = item_inputs
    if not isinstance(s, dict):
        raise ValueError('Expected item inputs')
    if s.get('sale_price') is None or s.get('unit_cost') is None:
        return None
    price, cost = _number(s['sale_price']), _number(s['unit_cost'])
    stock, incoming = _number(s.get('on_hand', 0)), _number(s.get('incoming', 0))
    lead, review = _number(s.get('lead_days', 0), 0, 3650), _number(s.get('review_days', 30), 0, 3650)
    holding = _number(s.get('annual_holding_pct', 20), 0, 100)
    fixed = _number(s.get('ordering_cost', 0))
    salvage = _number(s.get('salvage_pct', 0), 0, 100)
    moq = _number(s.get('MOQ', s.get('minimum_order', 0)))
    pack = _number(s.get('pack', s.get('pack_size', 1)), .000001)
    if abs(pack*1e6-round(pack*1e6)) > .00001 or abs(moq*1e6-round(moq*1e6)) > .00001:
        raise ValueError('Pack and MOQ need at most six decimals')
    raw_window = s.get('usable_window_days', s.get('W'))
    if raw_window is None and s.get('shelf_life_days') is not None:
        raw_window = (_number(s['shelf_life_days'], 0, 36500)
                      - _number(s.get('arrival_age_days', 0), 0, 36500)
                      - _number(s.get('min_remaining_life_days', 0), 0, 36500))
    window = review if raw_window is None else _number(raw_window, -73000, 36500)
    cap = _number(s.get('shelf_cap_qty', 1e12))
    margin = price-cost
    h = cost*holding/100*review/365
    writeoff = cost*(1-salvage/100) if raw_window is not None and window <= review else 0
    overage = h+writeoff
    ratio = margin/(margin+overage) if margin > 0 and margin+overage > 0 else 0
    paths = _paths(s, lead, review, window)
    # Existing stock is consumed before the new lot; past lost sales are not debt.
    duration = min(review, max(0, window))
    timeline = _timeline(s['receipts'], lead, duration) if 'receipts' in s else None
    residual = sorted(_residual(pre, post, stock, incoming, lead, duration, timeline) for pre, post in paths)
    n = len(residual)
    prefix = [0.0]
    for d in residual:
        prefix.append(prefix[-1]+d)
    if pack*1e6 > SAFE_TICKS:
        raise ValueError('Pack exceeds safe six-decimal grid precision')
    grid = int(math.floor(pack*1e6+.5))
    if max(residual[-1], moq)*1e6 > SAFE_TICKS:
        raise ValueError('Quantity exceeds safe six-decimal grid precision')
    moq_ticks = math.floor(moq*1e6+.5)
    minimum = max(1, (moq_ticks+grid-1)//grid)
    cap_ticks = min(SAFE_TICKS, math.floor(cap*1e6+.0001))
    maximum = min(cap_ticks//grid, max(minimum, math.ceil(residual[-1]*1e6/grid)))
    candidates = {0}
    # Piecewise-linear concavity: only the empirical critical fractile's adjacent
    # grid points, MOQ boundary and cap can maximise the positive-order objective.
    if margin > 0 and review > 0 and window > 0 and minimum <= maximum:
        target = residual[max(0, min(n-1, math.ceil(ratio*n-1e-12)-1))]
        center = math.floor(target*1e6/grid)
        for k in [minimum, maximum, *range(center-2, center+4)]:
            if minimum <= k <= maximum:
                candidates.add(k)
    ranked = []
    for k in candidates:
        q = k*grid/1e6
        j = bisect.bisect_right(residual, q)
        sold = (prefix[j]+q*(n-j))/n
        profit = margin*sold-overage*(q-sold)-(fixed if q > 0 else 0)
        ranked.append(dict(qty=q, expected_profit=_round(profit)))
    ranked.sort(key=lambda row: (-row['expected_profit'], row['qty']))
    best = ranked[0]
    reason = ('Cannot stock: no usable shelf-life window.' if window <= 0 else
              'Usable supply covers simulated demand, or a positive order does not repay modeled costs.' if best['qty'] == 0 else
              'Highest simulated margin after holding, write-off and ordering costs; MOQ/pack and shelf cap respected.')
    return dict(**best, alt=ranked[1:3], reason=reason, critical_ratio=_round(ratio), method='simulated')


def unavailable_reason(item, settings, guidance=None, resolved=None):
    product = settings.get('product_overrides', {}).get(item.get('sku'), {})
    if product.get('profit_suggestion', settings.get('profit_suggestion', False)) is not True:
        return None
    if guidance is not None and guidance.get('shelf_cap_qty') is not None:
        values = resolved['values'] if resolved is not None else {**item, **product}
        pack = values.get('pack_size') or 1
        moq = values.get('minimum_order') or 0
        grid = math.floor(pack * 1e6 + .5)
        minimum = max(1, (math.floor(moq * 1e6 + .5) + grid - 1) // grid)
        cap_ticks = math.floor(guidance['shelf_cap_qty'] * 1e6 + .0001)
        if cap_ticks <= 0:
            return 'Shelf life is too short for any order to be sold in time; using standard amount.'
        if minimum * grid > cap_ticks:
            return 'Shelf-life cap conflicts with the minimum order or pack size; using standard amount.'
    history = item.get('monthly_sales') or []
    try:
        from .forecast_methods import classify
    except ImportError:
        from forecast_methods import classify
    classification = classify(history) if history else {}
    if (classification.get('adi') is not None and classification['adi'] >= 1.32
            or classification.get('cv2') is not None and classification['cv2'] >= .49):
        return 'Sales too irregular for a reliable profit estimate; using standard amount.'
    return None


def for_guidance(item, guidance, settings, resolved, now=None, supply=None, evaluate=None):
    """Small integration adapter; never alters guidance or ordinary quantity."""
    product = settings.get('product_overrides', {}).get(item.get('sku'), {})
    enabled = product.get('profit_suggestion', settings.get('profit_suggestion', False))
    if enabled is not True or guidance.get('quantity') is None or guidance.get('status') == 'needs-data':
        return None
    if unavailable_reason(item, settings, guidance, resolved):
        return None
    values = resolved['values']
    forecast = [row['demand'] for row in item.get('projection', [])]
    if not forecast:
        forecast = [item.get('monthly_demand', 0)]
    if now is not None:
        current = date.fromordinal(now)
        snapshot = item.get('as_of', '')[:7]
        offset = max(0, current.year*12+current.month-(int(snapshot[:4])*12+int(snapshot[5:]))-1)
        forecast = forecast[min(offset, len(forecast)-1):]
    spec = dict(sku=item.get('sku', ''), as_of=item.get('as_of', '')[:7],
                history=item.get('monthly_sales', []), forecast=forecast,
                on_hand=max(0, guidance.get('projected_balance_today', item.get('on_hand', 0))),
                incoming=item.get('on_order', 0), lead_days=guidance['lead_days'],
                review_days=values['review_days'], unit_cost=values['unit_cost'],
                sale_price=product.get('sale_price', item.get('sale_price', settings.get('sale_price'))),
                annual_holding_pct=settings.get('holding_pct', 20), ordering_cost=settings.get('order_cost') or 0,
                MOQ=values['minimum_order'] or 0, pack=values['pack_size'] or 1)
    if guidance.get('shelf_cap_qty') is not None:
        spec['shelf_cap_qty'] = guidance['shelf_cap_qty']
    for k in ('shelf_life_days', 'arrival_age_days', 'min_remaining_life_days', 'salvage_pct'):
        value = resolved['values'].get(k) if k != 'salvage_pct' else product.get(k, item.get(k, settings.get(k)))
        if value is not None:
            spec[k] = value
    if now is not None and supply:
        spec['receipts'] = [dict(day=row['date']-now, quantity=row['quantity']) for row in supply if row['date'] > now]
    result = (evaluate or suggest)(spec)
    if result is not None:
        result = dict(result)  # Never annotate a caller's cached pure result.
        result['reason'] = ('Order-now estimate (' + str(int(values['review_days'])) + '-day review; current plan has '
                            + str(math.ceil(resolved['settings']['months_of_cover']*30)) + '-day cover). ' + result['reason'])
    return result
