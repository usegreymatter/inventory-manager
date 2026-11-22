#!/usr/bin/env python3
"""Synthetic demo-1000 timing: actual forecast/guidance, feature off vs on."""
import json
from pathlib import Path
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine


def main():
    data = json.loads((ROOT/'data/demo-1000.json').read_text())
    items = [{**row, 'unit_cost': 10, 'sale_price': 20} for row in data['items']]
    def evaluate(enabled):
        settings = {'profit_suggestion': True} if enabled else {}
        @engine.evaluation_pass
        def run():
            count = 0
            for raw in items:
                physical = engine.forecast(raw, data['months'], data['as_of'], settings=settings, today='2026-11-01')
                item = {**raw, **physical, 'on_hand': raw['on_hand'], 'monthly_sales': raw['monthly_sales'], 'as_of': data['as_of']}
                guidance = engine.order_guidance(item, '2026-11-01', settings)
                count += 'profit_suggestion' in guidance
            return count
        start = time.perf_counter()
        count = run()
        return (time.perf_counter()-start)*1000, count
    evaluate(False); evaluate(True)
    off, on, counts = [], [], []
    for i in range(5):
        # Alternate the paired order to avoid always favoring the warmed side.
        samples = {enabled: evaluate(enabled) for enabled in ([False, True] if i % 2 == 0 else [True, False])}
        off.append(samples[False][0]); on.append(samples[True][0]); counts.append(samples[True][1])
    result = dict(items=len(items),paths=96,eligible_suggestions=counts,
                  off_ms=off,on_ms=on,paired_added_ms=[b-a for a,b in zip(off,on)],
                  median_added_ms=statistics.median([b-a for a,b in zip(off,on)]))
    print(json.dumps(result, indent=2))
    if result['median_added_ms'] >= 300:
        raise SystemExit('Profit suggestion exceeds 300 ms added-time budget')


if __name__ == '__main__':
    main()
