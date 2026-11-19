#!/usr/bin/env python3
"""Compare reviewed golden numbers to current JS/Python/CLI export results.

Run without flags for a before/after Markdown table; --write accepts current
numbers only after every surface agrees. --before FILE compares another snapshot.
CLI export is exercised through its actual _export_rows boundary because the
command-line interface does not expose SKU-specific MOQ/pack settings.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/golden/numbers.json'
FIELDS = ('order_qty', 'order_by', 'run_out', 'status')


def collect(inputs):
    spec = importlib.util.spec_from_file_location('golden_cli', ROOT / 'stock_runway.py')
    assert spec is not None and spec.loader is not None
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    engine, _ = cli._load_modules()
    result = subprocess.run(['node', str(ROOT / 'scripts/golden_js.cjs')],
                            input=json.dumps(inputs), text=True, capture_output=True, check=True, cwd=ROOT)
    js_rows = json.loads(result.stdout)
    rows = []
    for case, js_row in zip(inputs['cases'], js_rows):
        data = {'items': [case['item']], 'months': case['months'], 'as_of': inputs['as_of']}
        settings = case.get('settings', {})
        raw = case['item']
        physical = engine.forecast(raw, case['months'], inputs['as_of'], settings=settings, today=inputs['today'])
        item = {**raw, **physical, 'on_hand': raw['on_hand'], 'monthly_sales': raw['monthly_sales'], 'as_of': inputs['as_of']}
        guidance = engine.order_guidance(item, inputs['today'], settings, inputs['as_of'])
        python = dict(order_qty=guidance.get('quantity'), order_by=guidance.get('order_by'),
                      run_out=guidance.get('runout_date'), status=engine.order_bucket(item, inputs['today'], settings, inputs['as_of']))
        exported, = cli._export_rows(data, engine, inputs['today'], settings, True)
        cli_row = {k: exported[k] for k in FIELDS}
        assert python == js_row == cli_row, (raw['sku'], python, js_row, cli_row)
        rows.append({'sku': raw['sku'], 'js': js_row, 'python': python, 'cli': cli_row})
    assert len(rows) == len(inputs['cases']) == len(js_rows)
    return rows


def diff_table(before, after):
    old = {row['sku']: row for row in before}
    lines = ['| sku | field | before | after |', '| --- | --- | --- | --- |']
    for row in after:
        for field in FIELDS:
            previous = old.get(row['sku'], {}).get('js', {}).get(field)
            current = row['js'][field]
            if previous != current:
                lines.append(f"| {row['sku']} | {field} | {previous} | {current} |")
    if len(lines) == 2:
        lines.append('| (all SKUs) | (all fields) | unchanged | unchanged |')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, default=ROOT / 'tests/golden/inputs.json')
    parser.add_argument('--output', type=Path, default=FIXTURE)
    parser.add_argument('--before', type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    inputs = json.loads(args.inputs.read_text())
    before_path = args.before or args.output
    before = json.loads(before_path.read_text()) if before_path.exists() else []
    after = collect(inputs)
    print(diff_table(before, after))
    if args.write:
        args.output.write_text(json.dumps(after, indent=2, allow_nan=False) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
