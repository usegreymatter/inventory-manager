#!/usr/bin/env python3
"""Inline cost/risk display modules outside frozen core for Desktop's single blob.

Desktop runtime plugins cannot use relative imports. Standalone still embeds
these same authored modules independently outside its unchanged order core.
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START, END = '// COST_DISPLAY_START', '// COST_DISPLAY_END'


def generated():
    return START + '\n' + '\n'.join((ROOT / path).read_text().rstrip() for path in
        ('desktop/cost-view.js', 'standalone/design/risk.js', 'desktop/profit-warnings.js')) + '\n' + END


def synchronized_source(source):
    block = generated()
    if START in source:
        if source.count(START) != 1 or source.count(END) != 1:
            raise ValueError('Cost display markers must be unique')
        before, rest = source.split(START)
        _, after = rest.split(END)
        return before + block + after
    anchor = '// Cost/profit presentation lives outside the frozen order/forecast core.'
    if source.count(anchor) != 1:
        raise ValueError('Cost adapter anchor must be unique')
    return source.replace(anchor, block + '\n\n' + anchor, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = ROOT / 'desktop/plugin.js'
    current = target.read_text()
    updated = synchronized_source(current)
    if args.check:
        if current != updated:
            raise SystemExit('Cost display is stale; run scripts/sync_cost_view.py')
        print('Cost display mirrors are in sync; frozen core untouched.')
    else:
        target.write_text(updated)
        print('Synced display-only cost/risk modules outside frozen core.')


if __name__ == '__main__':
    main()
