"""Equal-inventory diagnostics: no model tuning; same fixed-origin production policy.

The safety multiplier is a lab-only patch of the production buffer, never a new
order rule. Unattainable budgets are disclosed, not silently called equal spend.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import time
import engine
import forecast_methods as api
from forecast_lab.benchmark_methods import (generate, sample_rows, origins,
    current_forecast, inventory_case, _accumulator, finish)

BUDGETS = (.8, 1.0, 1.2)
BASES = ('sales_variation', 'forecast_misses')


def prepare(rows, inventory_per_class=20, methods=None, origin_selector=origins, horizon=3):
    methods = methods or ['current'] + api.METHODS
    counts, cases = Counter(), []
    for row in rows:
        kind = row['process']
        if counts[kind] >= inventory_per_class:
            continue
        counts[kind] += 1
        for origin in origin_selector(row):
            values, months = row['observed'][:origin], row['months'][:origin]
            curves = {m: current_forecast(values, months, 12) if m == 'current' else api.forecast(values, 12, m) for m in methods}
            buffers = {}
            for m in methods:
                for basis in BASES:
                    item = dict(sku=row['sku'], monthly_sales=values, on_hand=0, supplier_days=14, receipts={})
                    plan = engine.inventory_planning(item, months[-1], dict(forecast_method=m, safety_stock_basis=basis))
                    buffers[m, basis] = plan['safety_stock'] or 0
            cases.append(dict(sku=row['sku'], process=kind, values=values, months=months,
                              curves=curves, buffers=buffers, truth=row['latent'][origin:origin+horizon]))
    return cases


def replay(cases, method, basis, multiplier, details=False):
    acc = _accumulator()
    by_sku = defaultdict(lambda: defaultdict(float))
    for c in cases:
        inv = inventory_case(c['values'], c['months'], c['curves'][method], c['truth'], method,
                             multiplier, basis, c['buffers'][method, basis])
        for key, value in inv.items():
            acc['inventory'][key] += value
            by_sku[c['sku']][key] += value
    result = finish(acc)
    result['safety_multiplier'] = multiplier
    if details:
        result['by_sku'] = dict(by_sku)
    return result


def match_budget(evaluate, target, tolerance=.005, iterations=16):
    """Bisection on one nonnegative multiplier shared by every case in a group.

    MOQ/ceilings and order-date switches make the budget discrete. Return the
    nearest observed policy and a match flag; never pad inventory or drop holds.
    """
    sampled = {}
    def at(x):
        if x not in sampled:
            sampled[x] = evaluate(x)
        return sampled[x]
    low, high = 0.0, 1.0
    floor = at(low)['average_inventory_value']
    while at(high)['average_inventory_value'] < target and high < 128:
        high *= 2
    ceiling = at(high)['average_inventory_value']
    if floor <= target <= ceiling and min(abs(floor-target),abs(ceiling-target)) > max(1e-8,target*tolerance):
        for _ in range(iterations):
            middle = (low+high)/2
            value = at(middle)['average_inventory_value']
            if abs(value-target) <= max(1e-8,target*tolerance):
                break
            if value < target:
                low = middle
            else:
                high = middle
    nearest = min(sampled.values(), key=lambda r: abs(r['average_inventory_value']-target))
    gap = nearest['average_inventory_value']-target
    matched = abs(gap) <= max(1e-8, target*tolerance)
    ordered = sorted(sampled.items())
    monotone = all(b['average_inventory_value']+1e-8 >= a['average_inventory_value'] for (_, a), (_, b) in zip(ordered, ordered[1:]))
    reason = 'matched within 0.5%' if matched else ('below zero-buffer floor' if target < floor else 'above multiplier-128 ceiling' if target > ceiling else 'discrete/date-switch gap')
    return {**nearest, 'target_inventory_value': target, 'budget_gap': gap,
            'matched': matched and monotone, 'match_note': reason if monotone else 'non-monotone budget response: inconclusive', 'monotone_observed': monotone,
            'zero_buffer_inventory': floor, 'evaluations': len(sampled)}


def run(rows, inventory_per_class=20, methods=None, budgets=BUDGETS):
    start = time.monotonic()
    methods = methods or ['current'] + api.METHODS
    cases = prepare(rows, inventory_per_class, methods)
    groups = {'overall': cases}
    groups.update({k:[c for c in cases if c['process']==k] for k in sorted({c['process'] for c in cases})})
    result = {}
    for group, selected in groups.items():
        baseline = replay(selected, 'current', 'sales_variation', 1)
        frontier = {}
        for method in methods:
            for basis in BASES:
                cache = {}
                def evaluate(multiplier):
                    if multiplier not in cache:
                        cache[multiplier] = replay(selected, method, basis, multiplier)
                    return cache[multiplier]
                key = method + ('+misses' if basis=='forecast_misses' else '')
                frontier[key] = {str(b):match_budget(evaluate, baseline['average_inventory_value']*b) for b in budgets}
        result[group] = dict(current=baseline, frontier=frontier, cases=len(selected), skus=len({c['sku'] for c in selected}))
    return dict(note='Synthetic fixed-origin budget sensitivity, not validation. Matched means <=0.5% inventory gap; unmatched policies cannot win at equal spend.',
                inventory_per_class=inventory_per_class, budgets=list(budgets), methods=methods,
                elapsed_seconds=time.monotonic()-start, groups=result)


def summary_table(report):
    lines=['| Class | Current fill / days / value | Auto-fixed fill / days / value | Best matched other, selected in-sample (fill / days / value) |',
           '|---|---|---|---|']
    def cell(r):
        fill='n/a' if r['fill_rate'] is None else f"{r['fill_rate']*100:.2f}%"
        return f"{fill} / {r['stockout_days_per_case']:.2f} / {r['average_inventory_value']:.2f}" + ('' if r.get('matched', True) else ' [UNMATCHED]')
    for name, group in report['groups'].items():
        one={k:v['1.0'] for k,v in group['frontier'].items()}
        eligible={k:r for k,r in one.items() if k not in ('current','auto') and r['matched'] and r['fill_rate'] is not None}
        best=max(eligible,key=lambda k:(eligible[k]['fill_rate'],-eligible[k]['stockout_days_per_case'])) if eligible else None
        lines.append(f"| {name} | {cell(group['current'])} | {cell(one['auto'])} | {best+': '+cell(one[best]) if best else 'n/a (no matched demand-bearing comparator)'} |")
    return '\n'.join(lines)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--count',type=int,default=3000)
    p.add_argument('--inventory-per-class',type=int,default=20)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--markdown',type=Path)
    a=p.parse_args()
    report=dict(synthetic=run(generate(a.count),a.inventory_per_class),sample_pre_july=run(sample_rows(),a.inventory_per_class))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    if a.markdown:
        a.markdown.write_text('# Synthetic equal-budget results\n\n'+summary_table(report['synthetic'])+'\n\n# Sample pre-July (separate)\n\n'+summary_table(report['sample_pre_july'])+'\n')
    print(json.dumps({k:v['elapsed_seconds'] for k,v in report.items()}))


if __name__=='__main__':
    main()
