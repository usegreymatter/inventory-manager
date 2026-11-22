#!/usr/bin/env python3
"""Embed the exact standalone profit module without touching generated HTML."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '/* STOCK_RUNWAY_PROFIT_ORDER_START */\n'
END = '/* STOCK_RUNWAY_PROFIT_ORDER_END */\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT/'desktop/plugin.js'
    source = path.read_text()
    block = START+(ROOT/'desktop/profit-order.js').read_text()+END
    if START in source:
        before, rest = source.split(START)
        _, after = rest.split(END)
        updated = before+block+after
    else:
        updated = source.replace('export const DEFAULT_ORDER_SETTINGS', block+'\nexport const DEFAULT_ORDER_SETTINGS', 1)
    if args.check:
        if updated != source:
            raise SystemExit('Profit module embed differs; run scripts/sync_profit_order.py')
        print('Exact profit module embed verified')
    else:
        path.write_text(updated)
        print('Embedded exact desktop/profit-order.js')


if __name__ == '__main__':
    main()
