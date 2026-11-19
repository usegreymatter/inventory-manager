#!/usr/bin/env python3
"""Read-only advisory stockout and opt-in before/after report (stdlib only).

Default inputs are committed fictional sample/demo snapshots. JSON is written
only to stdout; redirect to an explicitly chosen report path if needed. This is
not a backtest, an accuracy claim, or a recommendation to place an order.
"""
import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import sys
from typing import Any

import engine

ROOT = Path(__file__).resolve().parent
FIELDS = ('status', 'quantity', 'monthly_demand', 'order_by', 'runout_date',
          'safety_stock', 'reorder_point', 'reason')


@engine.evaluation_pass
def build_report(data, today):
    """Count every item and report both actual guidance runs for flagged items."""
    if not isinstance(data, dict) or not isinstance(data.get('items'), list):
        raise ValueError('Dataset must contain an items list.')
    today = date.fromisoformat(today).isoformat()
    as_of, months = data['as_of'], data['months']
    if engine.date_ordinal(as_of) is None or engine.history_reason(months):
        raise ValueError('Dataset needs a valid snapshot and consecutive full months.')
    result: dict[str, Any] = dict(as_of=as_of, today=today, items_scanned=len(data['items']), items_flagged=0,
                  known_months=0, likely_months=0, months_without_estimate=0,
                  items_with_changed_guidance=0, items=[])
    for raw in data['items']:
        detection = engine.detect_stockout_months(raw, as_of[:7])
        if not detection['flagged']:
            continue
        counts = Counter(f['confidence'] for f in detection['flagged'])
        result['items_flagged'] += 1
        result['known_months'] += counts['known']
        result['likely_months'] += counts['likely']
        result['months_without_estimate'] += sum(f['adjusted_demand'] is None for f in detection['flagged'])
        physical = engine.forecast(raw, months, as_of, today=today)
        calculated = {**raw, **physical, 'on_hand': raw.get('on_hand'), 'as_of': as_of}
        before = engine.order_guidance(calculated, today, {'stockout_adjust':False}, as_of)
        after = engine.order_guidance(calculated, today, {'stockout_adjust':True}, as_of)
        before, after = ({k: guidance.get(k) for k in FIELDS} for guidance in (before, after))
        changed = before != after
        result['items_with_changed_guidance'] += changed
        result['items'].append(dict(sku=raw.get('sku'), flagged=detection['flagged'],
                                   raw_sales=list(raw['monthly_sales']), adjusted_sales=detection['adjusted_sales'],
                                   guidance_changed=changed, before=before, after=after))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('datasets', nargs='*', type=Path,
                        help='local JSON datasets (defaults: data/sample.json data/demo-1000.json)')
    parser.add_argument('--today', default='2026-11-17',
                        help='fixed planning date, YYYY-MM-DD (default: 2026-11-17)')
    args = parser.parse_args(argv)
    paths = args.datasets or [ROOT/'data/sample.json', ROOT/'data/demo-1000.json']
    try:
        reports = []
        for path in paths:
            report = build_report(json.loads(path.read_text(encoding='utf-8-sig')), args.today)
            reports.append(dict(dataset=path.name, **report))
        print(json.dumps(dict(method='advisory-stockout-v1', reports=reports), indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print('Stockout report: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
