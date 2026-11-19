#!/usr/bin/env python3
"""Deterministic synthetic scale fixtures + real CLI timing; all output in .scratch.

/usr/bin/python3 scripts/stress_scale.py --count 5000 --seed 73021
node scripts/stress_scale.mjs .scratch/stress/5000/catalog.html
No diary, network, live data, installs or tracked HTML builds.
"""
import argparse
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Dict, cast

from bench_scale import synthetic_data

ROOT = Path(__file__).resolve().parents[1]


def catalog(count, seed):
    data = cast(Dict[str, Any], synthetic_data(count, seed))
    data.update(dataset='Fictional scale fixture', note='Wholly synthetic; no live stock or suppliers.', decision_date='2026-01-01')
    for n, item in enumerate(data['items']):
        item.update(category=f'Type {n % 8 + 1}', supplier='' if n % 20 == 0 else f'Synthetic supplier {n % 15 + 1}',
                    unit_cost=None if n % 7 == 0 else round(0.5 + (n % 300) / 10, 2))
        if n % 10 == 0:
            item['monthly_sales'] = [0] * 48
        elif n % 10 == 1:
            item['monthly_sales'] = [v if j % 4 == 0 else 0 for j, v in enumerate(item['monthly_sales'])]
    return data


def scratch_path(value):
    result = Path(value).resolve()
    if not result.is_relative_to((ROOT / '.scratch').resolve()):
        raise argparse.ArgumentTypeError('Outputs must be inside this checkout .scratch')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, default=5000)
    parser.add_argument('--seed', type=int, default=73021)
    parser.add_argument('--output', type=scratch_path)
    parser.add_argument('--skip-cli', action='store_true')
    parser.add_argument('--method', choices=['current','auto'], default='current')
    parser.add_argument('--cli-max-bytes', type=int)
    args = parser.parse_args()
    if not 1 <= args.count <= 50000:
        parser.error('--count must be between 1 and 50000')
    out = args.output or ROOT / '.scratch/stress' / str(args.count)
    out.mkdir(parents=True, exist_ok=True)
    data = catalog(args.count, args.seed)
    encoded = json.dumps(data, separators=(',', ':'), allow_nan=False).encode()
    (out / 'data.json').write_bytes(encoded)
    keys = ['sku', 'name', 'unit', 'on_hand', 'on_order', 'supplier_days', 'category', 'supplier', 'unit_cost']
    with (out / 'stock.csv').open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(keys + data['months'])
        for item in data['items']:
            writer.writerow([item[k] for k in keys] + item['monthly_sales'])
    spec = importlib.util.spec_from_file_location('stress_build', ROOT / 'standalone/build.py')
    assert spec is not None and spec.loader is not None
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    # Trusted generated fixtures use build() directly: the public --data importer
    # intentionally caps input at 16 MiB; this does not relax that safety boundary.
    html = build.build('option-gm-b', data=data)
    startup = 'initializeSheets();initializeLearning();syncSettings(); if(data.items.length<=1000)render();else{withDatasetEvaluation(()=>{});setTimeout(()=>render(),0)}'
    assert html.count(startup) == 1, 'Review startup instrumentation anchor'
    # Scratch-only wrappers measure actual boot phases without altering inputs.
    instrumentation = """
const stressBoot=globalThis.stressBoot={started:performance.now(),core_ms:0,legacy_list_ms:0,health_ms:0};
const stressRender=render;
render=function(...args){const value=stressRender(...args);if(data.items.length<=1000){stressBoot.full_analysis_ms=performance.now()-stressBoot.started;requestAnimationFrame(()=>{stressBoot.first_useful_ms=performance.now()-stressBoot.started})}return value};
const stressCore=standaloneRows,stressLegacyList=buildList,stressHealth=updateHealth;
standaloneRows=function(...args){const t=performance.now();try{return stressCore(...args)}finally{stressBoot.core_ms+=performance.now()-t}};
buildList=function(...args){const t=performance.now();try{return stressLegacyList(...args)}finally{stressBoot.legacy_list_ms+=performance.now()-t}};
updateHealth=function(...args){const t=performance.now();try{return stressHealth(...args)}finally{stressBoot.health_ms+=performance.now()-t}};
"""
    html = html.replace(startup, instrumentation + ("localStorage.setItem(gmSettingsKey(data),JSON.stringify({...DEFAULT_ORDER_SETTINGS,forecast_method:'auto'}));" if args.method == 'auto' else '') + startup)
    bridge = """
// Scratch-only measurement bridge to the real module closures.
globalThis.stressAPI={count:()=>currentRows.length, rows:()=>currentRows,
 state:()=>({count:currentRows.length,visible:filteredRows.length,mode:wl.mode,columns:wl.columns}),
 tab:s=>wlSetStatus(s),search:q=>{$('search').value=q;buildList()},
 group:g=>{wl.group=g;buildList()},sort:k=>{wl.sort=k;buildList()},
 product:()=>openProductPage(filteredRows.find(r=>riskReady(r))||filteredRows[0]),
 closeProduct:()=>closeProductPage(), risk:()=>{const r=currentRows.find(r=>riskReady(r));riskCache.delete(r);return productRisk(r)},
 summary:()=>weeklySummaryOpen(),closeSummary:()=>document.getElementById('weekly-summary')?.close(),
 excel:()=>{const download=wlDownload;try{wlDownload=()=>{};return wlExcel(currentRows).byteLength}finally{wlDownload=download}},
 riskAll:()=>{wlMode('custom');wl.columns=['product','risk'];wlLayout()},riskMetrics:()=>riskMetrics};
const stressReadyTimer=setInterval(()=>{if((data.items.length<=1000||document.body.dataset.analysisState==='complete')&&currentRows.length===data.items.length){document.body.dataset.stressReady='true';clearInterval(stressReadyTimer)}},20);
"""
    html = html.replace('</script>', bridge + '</script>')
    (out / 'catalog.html').write_text(html, encoding='utf-8')
    result = dict(count=args.count, seed=args.seed, months=48, dataset_sha256=hashlib.sha256(encoded).hexdigest(),
                  json_bytes=len(encoded), html_bytes=len(html.encode()), python=sys.version, cli=None)
    if not args.skip_cli:
        command = [sys.executable, str(ROOT / 'stock_runway.py'), str(out / 'stock.csv'), '--today', data['decision_date'], '--all', '-o', str(out / 'orders.csv')]
        if args.cli_max_bytes is not None:
            command.extend(['--max-bytes', str(args.cli_max_bytes)])
        start = time.perf_counter()
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=1800)
        elapsed = (time.perf_counter() - start) * 1000
        (out / 'cli.log').write_text(run.stdout + run.stderr)
        rows = []
        if run.returncode == 0:
            with (out / 'orders.csv').open() as handle:
                rows = list(csv.DictReader(handle))
            assert len(rows) == args.count, (len(rows), args.count)
        result['cli'] = dict(ms=round(elapsed, 2), bytes=(out / 'orders.csv').stat().st_size if run.returncode == 0 else None,
                             rows=len(rows), exit_code=run.returncode, error=run.stderr.strip() if run.returncode else None)
    elif (out / 'python.json').exists():
        previous = json.loads((out / 'python.json').read_text())
        if previous['dataset_sha256'] == result['dataset_sha256']:
            result['cli'] = previous['cli']
    (out / 'python.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
