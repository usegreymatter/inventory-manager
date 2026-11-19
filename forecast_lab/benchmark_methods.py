"""Offline method comparison; run with /usr/bin/python3 -m forecast_lab.benchmark_methods.

No installs, network, ERP, or production artifacts. Generator labels are NOT fed
into fitting. Inventory is a fixed-origin, single recommended-order experiment,
not an alternative replenishment policy: engine.order_guidance owns every order.
"""
import argparse
import calendar
from collections import Counter, defaultdict
from contextlib import ExitStack
from datetime import date, timedelta
import importlib
import json
import math
from pathlib import Path
import random
import time
from unittest.mock import patch
from typing import Any

import engine
from forecast_lab import score_folds

CLASSES = ('smooth', 'erratic', 'intermittent', 'lumpy', 'seasonal', 'new',
           'dying', 'trend', 'structural_break', 'censored')
SEED = 20261118
ROOT = Path(__file__).resolve().parents[1]


def generate(count=3000, seed=SEED) -> list:
    """Equal allocation; independent stable PRNG per series; 60 or 12 months.

    Nonzero sizes are genuinely random. Intermittent demand is Bernoulli times
    positive size, NOT a small continuous demand every month. Censoring changes
    observed sales only; latent demand is retained separately for evaluation.
    """
    if isinstance(count, bool) or not isinstance(count, int) or count < 10 or count % 10:
        raise ValueError('count must be a positive multiple of ten (>=10)')
    rows = []
    for i in range(count):
        kind = CLASSES[i % len(CLASSES)]
        rng = random.Random(seed * 100003 + i)
        level = rng.uniform(20, 200)
        n = 12 if kind == 'new' else 60
        latent, observed = [], []
        phase = rng.randrange(12)
        jump = rng.choice((.25, 2.5))
        for t in range(n):
            value = max(0, rng.gauss(level, .10 * level))
            if kind == 'erratic':
                value = rng.lognormvariate(math.log(level) - .5, 1.0)
            elif kind == 'intermittent':
                value = rng.uniform(.8, 1.2) * level if rng.random() < .25 else 0.0
            elif kind == 'lumpy':
                value = rng.lognormvariate(math.log(level) - .72, 1.2) if rng.random() < .2 else 0.0
            elif kind == 'seasonal':
                value *= 1 + .8 * math.sin(2 * math.pi * (t + phase) / 12)
            elif kind == 'new':
                value *= .4 + .10 * t
            elif kind == 'dying':
                value *= max(0, 1 - max(0, t - 30) / 20)
            elif kind == 'trend':
                value *= .4 + .025 * t
            elif kind == 'structural_break':
                value *= jump if t >= 48 else 1
            value = round(value, 6)
            latent.append(value)
            # Independent stock availability, not a demand-driven zero process.
            fraction = rng.choice((0.0, .25, .5)) if kind == 'censored' and rng.random() < .30 else 1.0
            observed.append(round(value * fraction, 6))
        rows.append(dict(sku=f'SYN-{i:05d}', seed=seed, process=kind, observed=observed,
                         latent=latent, months=[engine.month_after('2020-01', t) for t in range(n)]))
    return rows


def origins(row, horizon=3):
    """Disjoint target windows; all fitting uses the strictly preceding prefix."""
    n = len(row['observed'])
    return [o for o in (n - 3 * horizon, n - 2 * horizon, n - horizon) if o >= 3]


def sample_rows(path=ROOT / 'data/sample.json'):
    """Read eligible pre-July columns ONLY; stock/receipts never become history.

    July--September 2026 (and all later observations) are neither training nor
    targets. Historical stock/cost data are unavailable, so sample inventory uses
    the same explicitly synthetic starting-stock/cost/lead scenario as generation.
    """
    data = json.loads(Path(path).read_text())
    indices = [i for i, month in enumerate(data['months']) if month < '2026-07']
    return [dict(sku=item['sku'], process='sample_pre_july',
                 months=[data['months'][i] for i in indices],
                 observed=[item['monthly_sales'][i] for i in indices],
                 latent=[item['monthly_sales'][i] for i in indices]) for item in data['items']]


def current_forecast(values, months, horizon):
    """ACTUAL default engine hybrid, not forecast_lab's flat baseline."""
    item = dict(sku='BENCH', name='Benchmark', unit='units', on_hand=0,
                monthly_sales=list(values), receipts={})
    result = engine._forecast(item, months, month_end(months[-1]), horizon)
    if result.get('held'):
        raise ValueError('Current engine held: ' + str(result.get('reason')))
    return [r['demand'] for r in result['projection']]


def month_end(month):
    y, m = map(int, month.split('-'))
    return f'{month}-{calendar.monthrange(y, m)[1]:02d}'


def _validated(prediction, horizon):
    if (len(prediction) != horizon or any(isinstance(v, bool) or not isinstance(v, (int, float))
            or not math.isfinite(v) or v < 0 for v in prediction)):
        raise ValueError('Expected exactly horizon finite nonnegative predictions')
    return list(prediction)


def inventory_case(values, months, curve, truth, method='current', safety_multiplier=1.0,
                   safety_stock_basis='sales_variation', base_buffer=None):
    """One engine recommendation, daily lost-sales ledger; no second order rule.

    Supply arrives before demand; monthly truth is uniform within calendar month.
    Forecast curve is installed in the engine's existing monthly-demand callback
    only during this serial call, without changing history, scale, or order math.
    Beyond 12 forecast months the first forecast year repeats, NOT actuals.
    """
    as_of = month_end(months[-1])
    today = date.fromisoformat(as_of) + timedelta(days=1)
    stock = sum(values[-12:]) / min(12, len(values))  # identical ex-ante one-month stock
    settings = dict(default_delivery_days=14, months_of_cover=2, buffer_days=0,
                    include_backup_in_orders=True, stockout_adjust=False, forecast_method=method,
                    safety_stock_basis=safety_stock_basis)
    item = dict(sku='BENCH', name='Benchmark', unit='units', monthly_sales=list(values),
                on_hand=stock, receipts={}, as_of=as_of, monthly_demand=curve[0],
                seasonal=False, unit_cost=1, supplier_days=14)
    with ExitStack() as stack:
        if safety_multiplier != 1 or base_buffer is not None:
            original_planning = engine.inventory_planning
            def scaled_planning(*args, **kwargs):
                result = original_planning(*args, **kwargs) if base_buffer is None else {'safety_stock': base_buffer}
                return {**result, 'safety_stock': engine.planning_ceil((result.get('safety_stock') or 0) * safety_multiplier)}
            stack.enter_context(patch.object(engine, 'inventory_planning', scaled_planning))
        if method != 'current':
            # Injection seam only: planner, safety stock, exact-decimal rounding,
            # trigger and order-up-to window all remain production functions.
            def demand_at(_item):
                def at(month):
                    offset = (int(month[:4]) - int(as_of[:4])) * 12 + int(month[5:]) - int(as_of[5:7]) - 1
                    # Planner's annual-zero guard probes 2000 calendar months.
                    if month < as_of[:7]:
                        return curve[(int(month[5:]) - int(engine.month_after(as_of[:7], 1)[5:])) % 12]
                    return curve[max(0, offset) % len(curve)]
                return at
            stack.enter_context(patch.object(engine, '_guidance_demand', demand_at))
        else:
            model = engine.demand_model(values, months[-1])
            item['seasonal'] = model['seasonal']
        guidance = engine.order_guidance(item, today.isoformat(), settings, as_of)
    held = guidance['status'] == 'needs-data' or guidance.get('quantity') is None
    # Engine holds are not successful recommendations. Explicit no-execution
    # scenario: do not invent an order or silently drop this difficult case.
    arrival, quantity = None, 0 if held else guidance['quantity']
    if quantity:
        arrival = date.fromisoformat(guidance['order_date']) + timedelta(days=guidance['lead_days'])
    lost = sold = value_days = 0.0
    days = stockout_days = 0
    for h, actual in enumerate(truth, 1):
        month = engine.month_after(as_of[:7], h)
        y, m = map(int, month.split('-'))
        length = calendar.monthrange(y, m)[1]
        rate = actual / length
        for d in range(1, length + 1):
            day = date(y, m, d)
            if day == arrival:
                stock += quantity
            fulfilled = min(stock, rate)
            stock -= fulfilled
            shortage = rate - fulfilled
            sold += fulfilled
            lost += shortage
            stockout_days += int(shortage > 1e-9)
            value_days += stock  # end-of-day inventory, unit cost=1 currency unit
            days += 1
    return dict(sold=sold, lost=lost, stockout_days=stockout_days,
                value_days=value_days, days=days, cases=1, planner_holds=int(held))


def _accumulator() -> dict[str, Any]:
    return dict(origins=0, points=0, scaled_points=0, unavailable_scale_points=0,
                absolute=0.0, square_scaled=0.0, absolute_scaled=0.0,
                signed=0.0, actual=0.0, inventory=defaultdict(float))


def finish(acc):
    points, scaled = acc['points'], acc['scaled_points']
    inv = acc['inventory']
    demand = inv.get('sold', 0) + inv.get('lost', 0)
    return dict(origins=acc['origins'], points=points, scaled_points=scaled,
                unavailable_scale_points=acc['unavailable_scale_points'],
                mase=acc['absolute_scaled']/scaled if scaled else None,
                rmsse=math.sqrt(acc['square_scaled']/scaled) if scaled else None,
                bias_units=acc['signed']/points if points else None,
                bias_pct=100*acc['signed']/acc['actual'] if acc['actual'] else None,
                bias_actual_denominator=acc['actual'], mae=acc['absolute']/points if points else None,
                inventory_cases=int(inv.get('cases', 0)), inventory_days=int(inv.get('days', 0)),
                planner_holds=int(inv.get('planner_holds', 0)),
                inventory_demand=demand, fill_rate=inv.get('sold', 0)/demand if demand else None,
                stockout_days=inv.get('stockout_days') if inv else None,
                stockout_days_per_case=inv.get('stockout_days', 0)/inv['cases'] if inv.get('cases') else None,
                average_inventory_value=inv.get('value_days', 0)/inv['days'] if inv.get('days') else None)


def run(rows, api=None, horizon=3, inventory_per_class=20) -> dict[str, Any]:
    """Every method sees identical origins; fail loudly, never skip bad forecasts."""
    if not isinstance(horizon, int) or isinstance(horizon, bool) or not 1 <= horizon <= 12:
        raise ValueError('horizon must be an integer from 1 to 12')
    if not isinstance(inventory_per_class, int) or isinstance(inventory_per_class, bool) or inventory_per_class < 0:
        raise ValueError('inventory_per_class must be a nonnegative integer')
    api = importlib.import_module('forecast_methods') if api is None else api
    methods = ['current'] + list(api.METHODS)
    groups = defaultdict(lambda: {m: _accumulator() for m in methods})
    counts, inventory_counts = Counter(), Counter()
    origin_count = 0
    started = time.monotonic()
    for row in rows:
        kind = row['process']
        counts[kind] += 1
        use_inventory = inventory_counts[kind] < inventory_per_class
        if use_inventory:
            inventory_counts[kind] += 1
        for origin in origins(row, horizon):
            origin_count += 1
            prefix, months = row['observed'][:origin], row['months'][:origin]
            # Future curves are fitted before target truth is accessed.
            curves = {'current': current_forecast(prefix, months, 12)}
            for method in api.METHODS:
                curves[method] = _validated(api.forecast(prefix, horizon=12, method=method), 12)
            truth = row['latent'][origin:origin+horizon]
            scales = {}
            for method in methods:
                prediction = curves[method][:horizon]
                fold: dict[str, Any] = dict(origin=origin, actual=truth, prediction=prediction,
                            errors=[a-p for a, p in zip(truth, prediction)])
                # DRY: established lab scoring computes training-only scales,
                # seasonal lag/fallback, MASE and RMSSE; no competing formula.
                scored = score_folds(row['observed'][:origin+horizon], [fold], _scales=scales)
                valid_scale = scales[origin][0] > 0 and scales[origin][1] > 0
                inventory = inventory_case(prefix, months, curves[method], truth, method) if use_inventory else {}
                for group in (kind, 'overall'):
                    acc = groups[group][method]
                    acc['origins'] += 1
                    acc['points'] += len(truth)
                    acc['actual'] += sum(truth)
                    acc['absolute'] += sum(abs(e) for e in fold['errors'])
                    acc['signed'] -= sum(fold['errors'])  # prediction minus actual
                    if valid_scale:
                        acc['scaled_points'] += len(truth)
                        acc['absolute_scaled'] += scored['mase'] * len(truth)
                        acc['square_scaled'] += scored['rmsse']**2 * len(truth)
                    else:
                        acc['unavailable_scale_points'] += len(truth)
                    for key, value in inventory.items():
                        acc['inventory'][key] += value
    return dict(seed=rows[0].get('seed') if rows else None, series_count=len(rows), class_counts=dict(counts), horizon=horizon,
                origin_count=origin_count, methods=methods, inventory_series_counts=dict(inventory_counts),
                elapsed_seconds=time.monotonic()-started,
                groups={g: {m: finish(a) for m, a in ms.items()} for g, ms in groups.items()})


def _fmt(value):
    return 'n/a' if value is None else f'{value:.4f}'


def tables(report):
    lines = []
    for group in ['overall'] + sorted(g for g in report['groups'] if g != 'overall'):
        lines += [f'### {group}', '',
                  '| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |',
                  '|---|---:|---:|---:|---:|---:|---:|---:|']
        for method in report['methods']:
            m = report['groups'][group][method]
            lines.append('| ' + method + ' | ' + ' | '.join(_fmt(m[k]) for k in
                         ('mase', 'rmsse', 'bias_pct', 'fill_rate', 'stockout_days_per_case', 'average_inventory_value', 'planner_holds')) + ' |')
        denominator = report['groups'][group]['current']
        lines += ['', f"Denominators: {denominator['origins']} origins; {denominator['points']} target points; "
                  f"{denominator['scaled_points']} scaled points; {denominator['unavailable_scale_points']} unavailable-scale points; "
                  f"{denominator['inventory_cases']} inventory cases / {denominator['inventory_days']} calendar days.", '']
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, default=3000)
    parser.add_argument('--inventory-per-class', type=int, default=20)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--markdown', type=Path)
    args = parser.parse_args(argv)
    synthetic = run(generate(args.count), inventory_per_class=args.inventory_per_class)
    sample = run(sample_rows(), inventory_per_class=args.inventory_per_class)
    result = dict(synthetic=synthetic, sample_pre_july=sample,
                  note='Synthetic diagnostic, not production validation; no July--September 2026 sample observations used for fitting or scoring')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    if args.markdown:
        args.markdown.write_text('# Synthetic results\n\n' + tables(synthetic) + '\n\n# Sample pre-July results\n\n' + tables(sample))
    print(json.dumps({k: {field: result[k][field] for field in
                         ('series_count', 'origin_count', 'elapsed_seconds')} for k in ('synthetic', 'sample_pre_july')}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
