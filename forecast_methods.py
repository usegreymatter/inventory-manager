"""Opt-in monthly forecasting reference; no engine integration or I/O.

See docs/forecast-methods-spec.md for fixed rules, fallbacks and limits.
"""
import math

METHODS = ['auto', 'naive', 'seasonal_naive', 'ma3', 'ma6', 'ma12', 'ses',
           'holt_damped', 'hw_additive', 'hw_multiplicative', 'theta',
           'croston', 'sba', 'tsb', 'adida', 'combination']
METHOD_LABELS = dict(zip(METHODS, [
    'Automatic (fixed rules)', 'Last month', 'Same month last year',
    '3-month average', '6-month average', '12-month average',
    'Simple exponential smoothing', 'Damped trend', 'Additive seasonal smoothing',
    'Multiplicative seasonal smoothing', 'Theta (level + drift)', 'Croston',
    'Syntetos–Boylan approximation', 'TSB (occurrence + size)',
    'ADIDA (aggregate + disaggregate)', 'Median combination']))
PRESETS = {
    'distributor': {'method': 'auto', 'note': 'Starting point only; review lead times and demand history.'},
    'retail': {'method': 'ses', 'note': 'Level-based starting point; review promotions separately.'},
    'spare-parts': {'method': 'sba', 'note': 'Intermittent-demand starting point; review criticality separately.'},
    'restaurant': {'method': 'ma3', 'note': 'Recent-demand starting point; review waste and service constraints separately.'},
    'pharmacy': {'method': 'auto', 'note': 'Demand-planning starting point only; qualified staff must review product-specific constraints.'},
    'seasonal': {'method': 'hw_additive', 'note': 'Needs at least 24 monthly observations; otherwise uses SES.'},
    'ecommerce': {'method': 'theta', 'note': 'Trend-aware starting point; review promotions and assortment changes.'},
}
MAX_VALUE = 1e12


def _sum(xs):
    total = 0.0
    for x in xs:
        total += x
    return total


def _mean(xs):
    return _sum(xs) / len(xs) if xs else 0.0


def _values(values):
    if not isinstance(values, list) or len(values) > 1200:
        raise ValueError('Expected a list of at most 1200 monthly values')
    for x in values:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not 0 <= x <= MAX_VALUE or not math.isfinite(x):
            raise ValueError('Expected finite monthly values from 0 to 1e12')
    scale = max(values, default=0)
    return [max(5e-324, x / scale) if x > 0 else 0.0 for x in values] if scale else [0.0] * len(values), scale


def _rounded(x):
    # Same positive half-up operation as JS, not Python bankers' round.
    return math.floor(x * 1e9 + 0.5) / 1e9


def _ses(ys):
    best_error, best_level = float('inf'), ys[0]
    for step in range(1, 10):
        alpha = step / 10
        level, error = ys[0], 0.0
        for y in ys[1:]:
            error += (y - level) * (y - level)
            level += alpha * (y - level)
        if error < best_error:  # ascending alpha wins ties
            best_error, best_level = error, level
    return best_level


def _slope(ys):
    center, avg = (len(ys) - 1) / 2, _mean(ys)
    numerator, denominator = 0.0, 0.0
    for i, y in enumerate(ys):
        offset = i - center
        numerator += offset * (y - avg)
        denominator += offset * offset
    return numerator / denominator if denominator else 0.0


def _damped(ys, horizon):
    if len(ys) < 2:
        return [_ses(ys)] * horizon
    level, trend = ys[0], ys[1] - ys[0]
    for y in ys[1:]:
        previous = level
        level = .4 * y + .6 * (level + .9 * trend)
        trend = .2 * (level - previous) + .8 * .9 * trend
    damping, power, result = 0.0, 1.0, []
    for _ in range(horizon):
        power *= .9
        damping += power
        result.append(level + damping * trend)
    return result


def _hw(ys, horizon, multiplicative, metadata=None):
    def fallback():
        if metadata is not None:
            metadata['method'] = 'ses'
        return [_ses(ys)] * horizon
    if len(ys) < 24 or (multiplicative and any(y == 0 for y in ys)):
        return fallback()
    level = _mean(ys[:12])
    if multiplicative and level <= 1e-12:
        return fallback()
    trend = (_mean(ys[12:24]) - level) / 12
    seasons = [y / level if multiplicative else y - level for y in ys[:12]]
    for i in range(12, len(ys)):
        slot, previous = i % 12, level
        seasonal = seasons[slot]
        if multiplicative:
            if seasonal <= 1e-12:
                return fallback()
            level = .3 * (ys[i] / seasonal) + .7 * (level + .9 * trend)
            if level <= 1e-12 or not math.isfinite(level):
                return fallback()
            seasons[slot] = .2 * (ys[i] / level) + .8 * seasonal
        else:
            level = .3 * (ys[i] - seasonal) + .7 * (level + .9 * trend)
            seasons[slot] = .2 * (ys[i] - level) + .8 * seasonal
        trend = .1 * (level - previous) + .9 * .9 * trend
    result, damping, power = [], 0.0, 1.0
    for h in range(horizon):
        power *= .9
        damping += power
        base, seasonal = level + damping * trend, seasons[(len(ys) + h) % 12]
        result.append(base * seasonal if multiplicative else base + seasonal)
    return result


def _intermittent(ys, method):
    first = next(i for i, y in enumerate(ys) if y > 0)
    size, interval, previous = ys[first], float(first + 1), first
    if method == 'tsb':
        probability = 1 / interval
        for y in ys[first + 1:]:
            probability += .1 * ((1 if y > 0 else 0) - probability)
            if y > 0:
                size += .1 * (y - size)
        return probability * size
    for i in range(first + 1, len(ys)):
        if ys[i] > 0:
            size += .1 * (ys[i] - size)
            interval += .1 * (i - previous - interval)
            previous = i
    return size / interval * (.95 if method == 'sba' else 1)


def _classify(ys):
    n, positives = len(ys), [y for y in ys if y > 0]
    avg = _mean(positives)
    adi = n / len(positives) if positives else None
    cv2 = _mean([(y / avg - 1) * (y / avg - 1) for y in positives]) if positives else None
    slope = _slope(ys)
    trend = slope / _mean(ys) if positives else 0.0
    strength = 0.0
    if n >= 24 and positives:
        # Remove linear trend, then estimate phase means over ALL observations.
        residual = [y - slope * (i - (n - 1) / 2) for i, y in enumerate(ys)]
        avg_residual = _mean(residual)
        phases = [_mean(residual[j::12]) for j in range(12)]
        total = _sum([(v - avg_residual) * (v - avg_residual) for v in residual])
        error = _sum([(v - phases[i % 12]) * (v - phases[i % 12]) for i, v in enumerate(residual)])
        strength = max(0.0, min(1.0, 1 - error / total)) if total > 1e-20 else 0.0
    zero_run = 0
    for y in reversed(ys):
        if y > 0:
            break
        zero_run += 1
    prior_n = n - zero_run
    prior_adi = prior_n / len(positives) if positives else 0
    if n < 12:
        name = 'new'
    elif not positives:
        name = 'inactive'
    elif ((len(positives) >= 4 and zero_run >= max(6, math.ceil(3 * prior_adi)))
          or (n >= 18 and len([y for y in ys[-18:-6] if y > 0]) >= 6
              and _mean(ys[-6:]) <= .25 * _mean(ys[-18:-6]))):
        name = 'dying'
    elif n >= 24 and strength >= .6:
        name = 'seasonal'
    else:
        assert adi is not None and cv2 is not None
        name = ('lumpy' if cv2 >= .49 else 'intermittent') if adi >= 1.32 else ('erratic' if cv2 >= .49 else 'smooth')
    method = {'new': 'ses', 'inactive': 'naive', 'dying': 'naive', 'seasonal': 'hw_additive',
              'smooth': 'ses', 'erratic': 'combination', 'intermittent': 'sba', 'lumpy': 'adida'}[name]
    return {'class': name, 'adi': None if adi is None else _rounded(adi),
            'cv2': None if cv2 is None else _rounded(cv2), 'history_months': n,
            'seasonality_strength': _rounded(strength),
            'trend': (-1 if trend < 0 else 1) * _rounded(abs(trend)), 'method': method}


def classify(values):
    """Describe history and select a fixed-rule advisory method; not a backtest."""
    ys, _ = _values(values)
    return _classify(ys)


def _forecast(ys, horizon, method, metadata=None):
    if method == 'auto':
        method = _classify(ys)['method']
    n = len(ys)
    if method == 'naive':
        return [ys[-1]] * horizon
    if method == 'seasonal_naive':
        if n < 12 and metadata is not None:
            metadata['method'] = 'naive'
        return [ys[n - 12 + h % 12] for h in range(horizon)] if n >= 12 else [ys[-1]] * horizon
    if method in ('ma3', 'ma6', 'ma12'):
        return [_mean(ys[-int(method[2:]):])] * horizon
    if method == 'ses':
        return [_ses(ys)] * horizon
    if method == 'holt_damped':
        return _damped(ys, horizon)
    if method in ('hw_additive', 'hw_multiplicative'):
        return _hw(ys, horizon, method == 'hw_multiplicative', metadata)
    if method == 'theta':
        level, drift = _ses(ys), _slope(ys) / 2
        return [level + drift * (h + 1) for h in range(horizon)]
    if method in ('croston', 'sba', 'tsb'):
        return [_intermittent(ys, method)] * horizon
    if method == 'adida':
        # Nearest integer ADI, capped at 12; discard oldest incomplete block.
        block = min(12, max(1, math.floor(n / len([y for y in ys if y > 0]) + .5)))
        start = n % block
        aggregates = [_sum(ys[i:i + block]) for i in range(start, n, block)]
        return [_ses(aggregates) / block] * horizon
    members = [_forecast(ys, horizon, m) for m in ('ses', 'theta', 'holt_damped')]
    return [sorted([member[h] for member in members])[1] for h in range(horizon)]


def forecast(values, horizon=12, method='ses'):
    """Return bounded nonnegative monthly point forecasts (nine decimal places)."""
    ys, scale = _values(values)
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 120:
        raise ValueError('Horizon must be an integer from 1 to 120')
    if not isinstance(method, str) or method not in METHODS:
        raise ValueError('Unknown method')
    if not scale:
        return [0.0] * horizon
    return [_rounded(min(MAX_VALUE, max(0.0, v * scale))) for v in _forecast(ys, horizon, method)]


def forecast_with_metadata(values, horizon=12, method='ses'):
    """Fit once, reporting the method actually used by the numerical path."""
    ys, scale = _values(values)
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 120:
        raise ValueError('Horizon must be an integer from 1 to 120')
    if not isinstance(method, str) or method not in METHODS:
        raise ValueError('Unknown method')
    classification = _classify(ys)
    selected = classification['method'] if method == 'auto' else method
    metadata = {'method': selected}
    if scale:
        curve = [_rounded(min(MAX_VALUE, max(0.0, v * scale)))
                 for v in _forecast(ys, horizon, selected, metadata)]
    else:
        curve = [0.0] * horizon
        if selected == 'hw_multiplicative' or selected == 'hw_additive' and len(ys) < 24:
            metadata['method'] = 'ses'
        elif selected == 'seasonal_naive' and len(ys) < 12:
            metadata['method'] = 'naive'
    return {'forecast': curve, 'classification': classification, **metadata,
            'fallback': metadata['method'] != selected}


# Deliberately separate from METHODS: the November fixed-candidate registry and
# all existing forecast/classify behaviour remain frozen.
RECOMMEND_CANDIDATES = ('current', 'ses', 'seasonal_naive', 'sba', 'combination')


def recommend_forecast(values, horizon=12, method='current'):
    """Candidate point curve, including the shipped raw-history Current hybrid.

    Current's calendar factors are represented relative to the next month;
    no actual calendar labels or real-world observations are needed.
    """
    _values(values)
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 120:
        raise ValueError('Horizon must be an integer from 1 to 120')
    if not isinstance(method, str) or method not in RECOMMEND_CANDIDATES:
        raise ValueError('Unknown recommendation candidate')
    if method != 'current':
        return forecast(values, horizon, method)
    if not values:
        return [0.0] * horizon
    positive = [y for y in values if y > 0]
    avg = _mean(positive)
    smooth = (len(values) >= 3 and bool(positive) and len(values) / len(positive) < 1.32
              and _mean([(y - avg) * (y - avg) for y in positive]) / (avg * avg) < .49
              if avg * avg > 0 else False)
    tail = values[-12:]
    if smooth:
        curve = [_mean(tail)] * horizon
    else:
        base = _mean(tail) if len(values) >= 12 else 0.0
        factors = [max(.5, min(2.0, y / base)) if base else 1.0 for y in tail]
        if len(values) < 12:
            factors = [1.0] * 12
        level = _mean(values[-3:])
        # tail[0] is the next month's phase; the last 3 are slots 9..11.
        if len(values) >= 12:
            level = _mean([y / factors[9 + j] for j, y in enumerate(values[-3:])])
        curve = [level * factors[h % 12] for h in range(horizon)]
    return [_rounded(min(MAX_VALUE, max(0.0, y))) for y in curve]


def recommend(values, previous=None, stockout_adjust=False):
    """Pure, bounded rolling-origin recommendation; opt-in, not calibration.

    Inputs are sales (or externally corrected sales). Numeric observations alone
    cannot identify stockouts: the flag records mode, never invents lost demand.
    Pass a previous candidate ID to retain it unless clearly beaten.
    """
    return _recommend(values, previous, stockout_adjust)


def _recommend(values, previous=None, stockout_adjust=False, prior_only=False, fit_cache=None):
    _values(values)
    if previous is not None and (not isinstance(previous, str) or previous not in RECOMMEND_CANDIDATES):
        raise ValueError('Unknown previous recommendation candidate')
    if not isinstance(stockout_adjust, bool):
        raise ValueError('stockout_adjust must be boolean')
    xs = values[-48:]
    # One public recommendation owns this memo, including its reconstructed
    # prior month. Fit inputs are exact values/horizon/candidate, not SKU or
    # incumbent/mode (which affect selection, never these pure point fits).
    # <= 9 unique origins x 5 candidates + 2 final curves; no retained state.
    if fit_cache is None:
        fit_cache = {}

    def predict(prefix, horizon, method):
        key = (tuple(prefix), horizon, method)
        if key not in fit_cache:
            fit_cache[key] = recommend_forecast(prefix, horizon, method)
        return fit_cache[key]

    # A clean import has no saved choice. Reconstruct one prior-month choice
    # without hidden state or recursive reselection; overlapping fits are shared.
    reconstructed = previous is None and len(xs) >= 21 and not prior_only
    if reconstructed:
        previous = _recommend(xs[:-1], stockout_adjust=stockout_adjust, prior_only=True, fit_cache=fit_cache)['method']
    incumbent = previous or 'current'
    suffix = (' Stockout adjustment on: supplied values must already be corrected; zeros alone are not evidence.'
              if stockout_adjust else ' Stockout adjustment off: observed sales may understate demand.')
    folds, scores, proxies = [], {}, {}
    if len(xs) >= 20 and any(xs):
        for origin in range(max(12, len(xs) - 10), len(xs) - 2):
            prefix, actual = xs[:origin], xs[origin:origin + 3]
            predictions = {m: predict(prefix, 3, m) for m in RECOMMEND_CANDIDATES}
            folds.append({'origin': origin, 'actual': actual, 'predictions': predictions})
        for method in RECOMMEND_CANDIDATES:
            losses, costs = [], []
            for fold in folds:
                prefix = xs[:fold['origin']]
                # Numeric rescaling only: target values never enter fitting.
                scale = max(prefix + fold['actual']) or 1.0
                p = [y / scale for y in prefix]
                lag = 12 if len(p) >= 24 else 1
                differences = [(p[i] - p[i-lag]) ** 2 for i in range(lag, len(p))]
                denominator = max(_mean(differences), (.05 * _mean(p)) ** 2, 1e-24)
                errors = [(pred - actual) / scale for pred, actual in
                          zip(fold['predictions'][method], fold['actual'])]
                losses.append((.5 * _mean([e*e for e in errors]) + .5 * _mean(errors)**2) / denominator)
                # One replenishment / 3-month total proxy: shortage costs 2x
                # excess. Not a daily inventory simulation or equal-stock test.
                error = _sum(errors)
                costs.append((max(error, 0.0) + 2 * max(-error, 0.0)) / max(_mean(p) * 3, 1e-12))
            scores[method] = _rounded(math.sqrt(_mean(losses)))
            proxies[method] = _rounded(_mean(costs))
    picked, improvement = incumbent, 0.0
    if scores:
        winner = min(RECOMMEND_CANDIDATES, key=lambda m: scores[m])
        improvement = (scores[incumbent] - scores[winner]) / scores[incumbent] if scores[incumbent] else 0.0
        margin = .15 if previous and not (reconstructed and previous == 'current') else .10
        if winner != incumbent and improvement >= margin and proxies[winner] <= proxies[incumbent] * 1.02:
            picked = winner
            reason = 'rolling-origin scaled error improves by at least ' + str(int(margin*100)) + '% with no material worsening of the backtest order proxy'
        else:
            reason = ('keeping reconstructed prior-month choice' if reconstructed else 'keeping previous choice' if previous else 'keeping basic Current hybrid') + ': no clear error and order-proxy advantage'
    else:
        reason = ('keeping reconstructed prior-month choice' if reconstructed else 'keeping previous choice' if previous else 'keeping basic Current hybrid') + ': fewer than 20 months or no positive demand'
    return {'method': picked, 'reason': reason + suffix,
            'forecast': predict(xs, 12, picked), 'scores': scores,
            'order_proxy': proxies, 'folds': len(folds), 'backtest': folds,
            'improvement': _rounded(max(0.0, improvement)), 'stockout_adjust': stockout_adjust,
            'history_used': len(xs), 'range_available': False,
            'previous_method': previous, 'hysteresis': previous is not None}

