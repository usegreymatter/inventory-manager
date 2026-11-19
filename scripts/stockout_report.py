#!/usr/bin/env python3
"""Print the reproducible advisory before/after table for committed snapshots."""
from pathlib import Path
import argparse
import json
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stockout_report import build_report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('datasets', nargs='*', type=Path)
    parser.add_argument('--today', default='2026-11-17')
    args = parser.parse_args()
    for path in args.datasets or [ROOT/'data/sample.json', ROOT/'data/demo-1000.json']:
        report = build_report(json.loads(path.read_text()), args.today)
        print('\n## '+path.name+'\n')
        print(f"Scanned {report['items_scanned']} SKUs; flagged {report['items_flagged']}; known months {report['known_months']}; likely months {report['likely_months']}; changed guidance {report['items_with_changed_guidance']}.")
        print('\n| SKU | Flagged months | Order before | Order after | Delta |')
        print('| --- | --- | ---: | ---: | ---: |')
        for item in report['items']:
            before, after = item['before']['quantity'], item['after']['quantity']
            months = ', '.join(f["month"]+' ('+f["confidence"]+')' for f in item['flagged'])
            delta = after-before if before is not None and after is not None else None
            print(f"| {item['sku']} | {months} | {before} | {after} | {delta} |")
        if not report['items']:
            print('| (none flagged) | — | unchanged | unchanged | 0 |')
    return 0

if __name__ == '__main__':
    sys.exit(main())
