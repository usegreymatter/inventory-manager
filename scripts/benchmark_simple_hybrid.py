#!/usr/bin/env python3
"""Offline paired synthetic production replay; fixed seed, no tuning or real data.

Reuse the lab generator/cleaning prefixes. Compare the pre-Phase-4 production
model seam against the simple hybrid, with identical smart gates and holdouts.
Latent truth is read only after all prefix forecasts. Not a live-accuracy claim.
"""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine
from scripts.synth_demand import generate
from scripts.benchmark_forecast_lab import prepare_history, _row_index


def run():
    data = generate(skus=100)
    index = _row_index(data)
    groups = {}
    hybrid = engine.demand_model
    try:
        for item in data['skus']:
            sku = item['sku']
            rows = index[sku]
            n = len(rows)
            for origin in ([3, 6] if n < 12 else [36, 48, 54]):
                cutoff = rows[origin]['month']
                prefix = prepare_history(data, sku, cutoff, index)
                last = engine.month_after(cutoff, -1)
                raw = dict(monthly_sales=prefix)
                predictions = {}
                for name, model in [('before', engine.legacy_demand_model), ('after', hybrid)]:
                    engine.demand_model = model
                    predictions[name] = dict(
                        champion=engine.forecast_method_values(raw, 'champion', prefix, last, 3),
                        smart=engine.forecast_selection(raw, last)['forecast'][:3])
                    if not predictions[name]['smart']:
                        predictions[name]['smart'] = predictions[name]['champion']
                truth = {r['month']: r['demand'] for r in data['latent_demand'][sku]}
                actual = [truth[r['month']] for r in rows[origin:origin+3]]
                for group in ('all', item['pattern']):
                    record = groups.setdefault(group, dict(points=0, actual=0, metrics={}))
                    record['points'] += 3
                    record['actual'] += sum(actual)
                    for name, methods in predictions.items():
                        for method, pred in methods.items():
                            score = record['metrics'].setdefault(name+'_'+method, dict(error=0, bias=0))
                            score['error'] += sum(abs(p-a) for p,a in zip(pred, actual))
                            score['bias'] += sum(p-a for p,a in zip(pred, actual))
    finally:
        engine.demand_model = hybrid
    for record in groups.values():
        for score in record['metrics'].values():
            score.update(wape_pct=round(100*score.pop('error')/record['actual'], 2),
                         bias_pct=round(100*score.pop('bias')/record['actual'], 2))
    assert groups['all']['points'] == sum(v['points'] for k,v in groups.items() if k != 'all')
    return dict(synthetic=True, seed=20261112, skus=100, horizon=3, groups=groups)


if __name__ == '__main__':
    print(json.dumps(run(), indent=2))
