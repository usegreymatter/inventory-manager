#!/usr/bin/env python3
"""Offline deterministic scale probe; timings are measurements, not CI limits.

Run with /usr/bin/python3 scripts/bench_scale.py, then
node scripts/bench_scale.mjs .scratch/scale/data.json [--browser].
Artifacts include exact CLI CSV and JSON results for before/after comparison.
"""
import argparse
import calendar
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def synthetic_data(size=1000, seed=73021):
    rng = random.Random(seed)
    months = [f'{2022 + i // 12:04d}-{i % 12 + 1:02d}' for i in range(48)]
    items = []
    for i in range(size):
        base = rng.randint(20, 300)
        sales = [max(0, base + rng.randint(-base // 3, base // 3) + (j % 12) * (i % 5)) for j in range(48)]
        items.append(dict(sku=f'SCALE-{i:04d}', name=f'Synthetic item {i}', unit='ea',
                          on_hand=rng.randint(0, base * 8), on_order=0,
                          supplier_days=14, monthly_sales=sales))
    return dict(as_of='2025-12-31', months=months, items=items)


def synthetic_diary(data):
    """Known synthetic input predictions, not measured model performance."""
    rows = []
    for item in data['items']:
        for index in range(42, 48):
            origin = data['months'][index - 1]
            forecast = []
            for h in range(3):
                year, month = divmod(2022 * 12 + index + h, 12)
                value = item['monthly_sales'][min(index + h, 47)] * .9
                forecast.append(dict(month=f'{year:04d}-{month + 1:02d}', p50=value,
                                     base_p50=value, p80=value * 1.2, p95=value * 1.4))
            rows.append(dict(version=1, sku=item['sku'], as_of=origin, method='champion', scale=10, forecast=forecast))
    return rows


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', type=int, default=1000)
    parser.add_argument('--output', type=Path, default=ROOT / '.scratch/scale')
    args = parser.parse_args()
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    data = synthetic_data(args.size)
    (out / 'data.json').write_text(json.dumps(data), encoding='utf-8')
    with (out / 'stock.csv').open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['sku', 'name', 'unit', 'on_hand', 'on_order', 'supplier_days', *data['months']])
        for item in data['items']:
            writer.writerow([item[k] for k in ('sku', 'name', 'unit', 'on_hand', 'on_order', 'supplier_days')] + item['monthly_sales'])
    seed = synthetic_diary(data)
    (out / 'seed-diary.json').write_text(json.dumps(seed), encoding='utf-8')
    result = dict(size=args.size, months=48, seed=73021, python=sys.executable, ms={}, sha256={})
    for name, learning in [('no-diary', False), ('diary-learn', True)]:
        cmd = [sys.executable, str(ROOT / 'stock_runway.py'), str(out / 'stock.csv'), '--today', '2026-01-01', '--all', '-o', str(out / f'{name}.csv')]
        if learning:
            diary = out / 'diary.jsonl'; log = out / 'log.jsonl'
            diary.write_text(''.join(json.dumps(row) + '\n' for row in seed), encoding='utf-8')
            log.write_text('', encoding='utf-8')
            cmd += ['--forecast-diary', str(diary), '--learning-log', str(log), '--learn']
        start = time.perf_counter()
        run = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True)
        result['ms'][name] = round((time.perf_counter() - start) * 1000, 2)
        (out / f'{name}.summary.txt').write_text(run.stdout + run.stderr, encoding='utf-8')
        result['sha256'][name + '.csv'] = digest(out / f'{name}.csv')
    spec = importlib.util.spec_from_file_location('scale_cli', ROOT / 'stock_runway.py')
    cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)
    engine, sources = cli._load_modules()
    settings = dict(default_delivery_days=14, buffer_days=7, months_of_cover=2, service_level=.95, include_backup_in_orders=False)
    loaded = sources.load_csv(str(out / 'stock.csv'))
    for name, ready in [('no-diary', loaded), ('diary-learn', engine.prepare_learning(loaded, seed, dict(learning_enabled=True)))]:
        rows = engine.evaluation_pass(cli._export_rows)(ready, engine, '2026-01-01', settings, True)
        path = out / f'{name}.json'; path.write_text(json.dumps(rows, sort_keys=True), encoding='utf-8')
        result['sha256'][name + '.json'] = digest(path)
    for file in ('diary.jsonl', 'log.jsonl'):
        result['sha256'][file] = digest(out / file)
    (out / 'timings.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
