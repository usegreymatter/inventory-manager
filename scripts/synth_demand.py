#!/usr/bin/env python3
"""Deterministic, entirely SYNTHETIC monthly demand; no ERP or calendar services.

``latent_demand`` is uncensored routine demand, not a model input. Projects and
one-offs are intentionally excluded from that target. All dates are fixed
Gregorian monthly labels; ramadan_shifting is an invented moving-event stress
scenario, NOT actual Hijri calendar data. No current date or global RNG is used.
"""
import argparse
import calendar
import json
import math
from pathlib import Path
import random

PATTERNS = ('smooth', 'seasonal', 'trending', 'intermittent', 'new',
            'ramadan_shifting', 'project', 'stockout', 'supersession', 'substitute')


def generate(seed=20261112, skus=500):
    """Return JSON-safe data. Pair members count toward the exact SKU total."""
    if isinstance(skus, bool) or not isinstance(skus, int) or skus < 1:
        raise ValueError('skus must be a positive integer')
    rng = random.Random(seed)
    months = [f'{2020 + i // 12:04d}-{i % 12 + 1:02d}' for i in range(60)]
    data = {'schema_version': 1, 'synthetic': True, 'seed': seed,
            'scenario': 'SYNTHETIC offline demand stress scenarios; not real sales',
            'ramadan_calendar_note': 'SYNTHETIC shifting event, not actual Hijri calendar; invented 11.6-month cycle',
            'months': months, 'skus': [], 'rows': [], 'latent_demand': {},
            'linked_pairs': [], 'cleaning_options': {'supersessions': {},
                                                     'transfers': [], 'manual_pct': {}},
            'target_definition': 'Uncensored routine end-user demand, excluding project and one-off quantities',
            'manual_pct_convention': 'Percentage points: 10 means +10%; optional operator assumption, never latent truth'}
    by_sku = {}
    pattern_ids = {p: [] for p in PATTERNS}
    for i in range(skus):
        sku, pattern = f'SYN-{i + 1:04d}', PATTERNS[i % len(PATTERNS)]
        base = rng.uniform(12, 150)
        phase = rng.uniform(0, math.tau)
        data['skus'].append({'sku': sku, 'pattern': pattern,
                             'label': f'SYNTHETIC {pattern} {sku}', 'synthetic': True})
        pattern_ids[pattern].append(sku)
        rows, latent = [], []
        for t, month in enumerate(months):
            if pattern == 'new' and t < 51:
                continue
            level = base
            if pattern == 'seasonal':
                level *= 1 + .65 * math.sin(math.tau * t / 12 + phase)
            elif pattern == 'trending':
                level *= .45 + .025 * t
            elif pattern == 'ramadan_shifting':
                distance = abs(((t - 3 + 5.8) % 11.6) - 5.8)
                level *= 2.8 if distance < 1 else .8
            demand = float(max(0, round(rng.gauss(level, max(1, level * .12)))))
            if pattern == 'intermittent':
                demand = float(rng.randint(1, 4) * round(base)) if rng.random() < .23 else 0.0
            days = calendar.monthrange(int(month[:4]), int(month[5:]))[1]
            project = float(round(base * 3)) if pattern == 'project' and t % 11 == 4 else 0.0
            one_off = float(round(base * 1.7)) if pattern == 'project' and t % 17 == 8 else 0.0
            stock_days = days
            observed = demand + project + one_off
            if pattern == 'stockout' and t % 7 in (2, 3):
                stock_days = rng.randint(3, 12)
                observed = float(round(demand * stock_days / days))
            rows.append({'sku': sku, 'month': month, 'demand': observed,
                         'project_qty': project, 'one_off': one_off,
                         'in_stock_days': stock_days, 'days_in_month': days,
                         'month_end_stock': 0.0 if stock_days < days else float(round(base * 1.5)),
                         'backorder': False,
                         'lost_sales_qty': float(max(0, demand - observed)) if stock_days < days else 0.0})
            latent.append({'month': month, 'demand': demand})
        data['rows'].extend(rows)
        data['latent_demand'][sku] = latent
        by_sku[sku] = rows
    for pattern in ('supersession', 'substitute'):
        ids = pattern_ids[pattern]
        for j in range(0, len(ids) - 1, 2):
            old, new = ids[j:j + 2]
            pair = {'kind': pattern, 'from_sku': old, 'to_sku': new,
                    'effective_month': months[36] if pattern == 'supersession' else months[0]}
            data['linked_pairs'].append(pair)
            if pattern == 'supersession':
                data['cleaning_options']['supersessions'][old] = new
                # One demand stream changes identifier; keep explicit zero rows.
                for t in range(60):
                    demand = data['latent_demand'][old][t]['demand']
                    for item, active in ((old, t < 36), (new, t >= 36)):
                        value = demand if active else 0.0
                        by_sku[item][t]['demand'] = value
                        data['latent_demand'][item][t]['demand'] = value
            else:
                # Demand fulfilled by substitute: reverse in cleaning, not truth.
                for t in range(5, 60, 9):
                    quantity = float(round(by_sku[old][t]['demand'] * .6))
                    if quantity <= 0:
                        continue
                    by_sku[old][t]['demand'] -= quantity
                    by_sku[new][t]['demand'] += quantity
                    data['cleaning_options']['transfers'].append(
                        {'from_sku': new, 'to_sku': old, 'month': months[t], 'quantity': quantity})
    for sku in pattern_ids['trending'][::5]:
        data['cleaning_options']['manual_pct'][sku] = 10
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261112)
    parser.add_argument('--skus', type=int, default=500)
    parser.add_argument('--output', type=Path, default=Path('.scratch/synthetic.json'))
    args = parser.parse_args(argv)
    try:
        data = generate(seed=args.seed, skus=args.skus)
    except ValueError as exc:
        parser.error(str(exc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
    counts = {p: sum(s['pattern'] == p for s in data['skus']) for p in PATTERNS}
    print(json.dumps({'synthetic': True, 'seed': args.seed, 'skus': len(data['skus']),
                      'rows': len(data['rows']), 'patterns': counts, 'output': str(args.output)}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
