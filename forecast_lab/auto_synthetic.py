"""Lane M's own reproducible synthetic development/evaluation families only.

No real data, calendar labels, imports from the independent Stress lane, or
November scorer. Constants are frozen before running this evaluation. Run:
  python3 -m forecast_lab.auto_synthetic --output .scratch/auto-evaluation.json
"""
import argparse
import json
import math
from pathlib import Path
import random

try:
    from .. import forecast_methods as fm
    from .. import engine
except ImportError:
    import forecast_methods as fm
    import engine

FAMILIES = ('level_jitter', 'ramp', 'two_peak_cycle', 'random_lots', 'restricted_supply')
METHODS = ('recommended', 'current', 'auto', 'combination', 'ses')


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def generate(family, seed):
    """Return 36 history + 3 future months; supply exposure is explicit truth."""
    if family not in FAMILIES:
        raise ValueError('Unknown synthetic family')
    rng = random.Random(seed)
    level = rng.uniform(20, 200)
    phase = rng.randrange(12)
    growth = rng.uniform(.02, .07)
    latent, exposure = [], []
    for t in range(39):
        noise = rng.uniform(.85, 1.15)
        if family == 'ramp':
            y = level * (1 + growth * t) * noise
        elif family == 'two_peak_cycle':
            slot = (t + phase) % 12
            y = level * (4 if slot in (2, 8) else .3) * noise
        elif family == 'random_lots':
            y = level * rng.uniform(1, 4) if rng.random() < .25 else 0.0
        else:
            y = level * noise
        fraction = .25 if family == 'restricted_supply' and t >= 12 and rng.random() < .35 else 1.0
        latent.append(y)
        exposure.append(fraction)
    return dict(latent=latent, exposure=exposure,
                observed=[y * f for y, f in zip(latent, exposure)])


def metrics(prefix, actual, curve):
    """Scaled RMSE + one order's shortage/excess proxy, not daily simulation."""
    lag = 12 if len(prefix) >= 24 else 1
    denominator = max(mean([(prefix[i] - prefix[i-lag])**2 for i in range(lag, len(prefix))]),
                      (.05 * mean(prefix))**2, 1e-24)
    errors = [p-a for p, a in zip(curve, actual)]
    error = sum(errors)
    return dict(scaled_error=math.sqrt(mean([e*e for e in errors]) / denominator),
                order_proxy=(max(error, 0) + 2 * max(-error, 0)) / max(mean(prefix) * 3, 1e-12))


def quantile(xs, p):
    xs = sorted(xs)
    x = (len(xs)-1)*p
    i = int(x)
    return xs[i] + (xs[min(i+1, len(xs)-1)] - xs[i])*(x-i)


def interval(deltas, bootstrap, seed):
    rng = random.Random(seed)
    means = [mean([deltas[rng.randrange(len(deltas))] for _ in deltas]) for _ in range(bootstrap)]
    return dict(mean=mean(deltas), ci90=[quantile(means, .05), quantile(means, .95)])


def current_curve(prefix):
    """Actual shipped Current pipeline, including adopted challengers."""
    months = [engine.month_after('2030-01', i) for i in range(len(prefix))]
    last = months[-1]
    import calendar
    asof = last + '-%02d' % calendar.monthrange(*map(int, last.split('-')))[1]
    item = dict(sku='SYNTHETIC', name='Synthetic', unit='u', on_hand=100,
                supplier_days=14, monthly_sales=prefix)
    result = engine.forecast(item, months, asof, 3)
    if result.get('held'):
        raise ValueError('Current synthetic comparison unexpectedly held')
    return [r['demand'] for r in result['projection']]


def evaluate(seeds=80, bootstrap=1000):
    """Equal-weight series; paired SKU bootstrap CIs, all baselines retained.

    Seeds 0..999 are reserved for development. This report uses disjoint
    10000+ seeds, but self-authored families are not independent validation.
    Adjustment ON uses known synthetic exposure; it does NOT validate the
    production stockout detector or claim true demand is recoverable in use.
    """
    if seeds < 1 or bootstrap < 1:
        raise ValueError('Positive seeds and bootstrap required')
    report = dict(synthetic_only=True, series=seeds*len(FAMILIES), bootstrap=bootstrap,
                  ci='paired series bootstrap 90%; exploratory, no multiplicity correction',
                  evaluation_seeds=[10000, 10000+seeds-1], development_seeds=[0, 999],
                  limitations=['Self-authored synthetic families; not independent Stress evidence',
                               'Order proxy is one 3-month replenishment, not fill rate, expiry or equal inventory',
                               'Adjustment ON uses known synthetic exposure, not production detector'], modes={})
    for adjust in (False, True):
        rows, choices = [], {}
        for family in FAMILIES:
            for seed in range(10000, 10000+seeds):
                generated = generate(family, seed)
                prefix = generated['observed'][:36]
                if adjust:
                    prefix = [y/max(.25, f) for y, f in zip(prefix, generated['exposure'][:36])]
                actual = generated['latent'][36:39]
                selected = fm.recommend(prefix, stockout_adjust=adjust)
                choices[selected['method']] = choices.get(selected['method'], 0) + 1
                curves = {'recommended': selected['forecast'][:3],
                          'current': current_curve(prefix),
                          **{m: fm.forecast(prefix, 3, m) for m in ('auto', 'combination', 'ses')}}
                rows.append(dict(family=family, scores={m: metrics(prefix, actual, curve) for m, curve in curves.items()}))
        averages = lambda data: {m: {key: mean([r['scores'][m][key] for r in data])
                                        for key in ('scaled_error', 'order_proxy')} for m in METHODS}
        paired = {}
        for baseline in METHODS[1:]:
            paired[baseline] = {key: interval([r['scores']['recommended'][key]-r['scores'][baseline][key] for r in rows],
                                              bootstrap, 93017) for key in ('scaled_error', 'order_proxy')}
        report['modes']['on' if adjust else 'off'] = dict(metrics=averages(rows), paired_deltas=paired,
            choices=choices, families={family: averages([r for r in rows if r['family']==family]) for family in FAMILIES})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seeds', type=int, default=80)
    parser.add_argument('--bootstrap', type=int, default=1000)
    args = parser.parse_args()
    result = evaluate(args.seeds, args.bootstrap)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
