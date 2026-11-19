"""Synthetic external archives are challengers, never trusted purchase tails."""
import copy
import csv
import json
import subprocess
import sys
from pathlib import Path
import pytest
import engine
import importlib.util

spec = importlib.util.spec_from_file_location('phase3_external_cli', Path(__file__).resolve().parents[1] / 'stock_runway.py')
assert spec is not None and spec.loader is not None
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
_load_modules = cli._load_modules


def external_item(vintaged=True):
    sales = [10 + (i % 5)*7 + i for i in range(48)]
    item = dict(sku='EXT', name='Synthetic', unit='box', on_hand=60,
                supplier_days=14, monthly_sales=sales, receipts={})
    last = '2026-10'
    months = [engine.month_after(last, i-47) for i in range(60)]
    # Deliberately oracle-like SYNTHETIC fixed archive: not evidence of real skill.
    rows = [dict(month=m, p50=sales[i] if i<48 else 80, source='synthetic-archive',
                 p80=1e12, p95=1e12, p95_flag='heuristic') for i,m in enumerate(months)]
    if vintaged:
        rows = [dict(row, origin=engine.month_after(last, origin-48))
                for origin in range(12,49) for row in rows
                if engine.month_after(last, origin-48) < row['month']]
    item['external_forecasts'] = rows
    return item, months[:48]


@pytest.mark.parametrize('source', ['\t', '\u001c', '\ufeff', '\u00a0', 'archive\n', 'a'*41])
def test_external_source_rule_rejects_non_ascii_whitespace(source):
    item, _ = external_item()
    for row in item['external_forecasts']:
        row['source'] = source
    assert engine.forecast_selection(item, '2026-10')['method'] != 'external'


def test_unvintaged_is_diagnostic_only_and_cannot_calibrate():
    item, _ = external_item(False)
    assert engine.forecast_selection(item, '2026-10')['method'] != 'external'
    assert engine.forecast_method_values(item, 'external', item['monthly_sales'], '2026-10', 1) is None


def test_external_wins_same_folds_and_bad_or_partial_archive_is_ignored():
    item, _ = external_item()
    selected = engine.forecast_selection(item, '2026-10')
    assert selected['method'] == 'external'
    assert selected['candidates']['external']['passes']
    assert [r['origin'] for r in selected['folds']] == list(range(24,36))
    assert selected['accuracy']['mase'] == 0
    for mutate in ('bad', 'missing_fold', 'missing_future', 'duplicate', 'source', 'null_origin'):
        bad = copy.deepcopy(item)
        if mutate == 'bad':
            for r in bad['external_forecasts']: r['p50'] = 1e6
        elif mutate == 'missing_fold':
            bad['external_forecasts'] = [r for r in bad['external_forecasts']
                                         if not (r['origin'] == '2024-10' and r['month'] == '2024-11')]
        elif mutate == 'missing_future': bad['external_forecasts'].pop()
        elif mutate == 'duplicate': bad['external_forecasts'].append(bad['external_forecasts'][0])
        elif mutate == 'source': bad['external_forecasts'][0]['source'] = 'other'
        else: bad['external_forecasts'][0]['origin'] = None
        assert engine.forecast_selection(bad, '2026-10')['method'] != 'external'
    vintaged, _ = external_item(True)
    assert engine.forecast_selection(vintaged, '2026-10')['method'] == 'external'


def test_tails_are_conformal_not_uploaded_marginal_quantiles():
    item, months = external_item()
    p = engine.forecast(item, months, '2026-10-31', 6)
    full = dict(item, **p, as_of='2026-10-31')
    g = engine.order_guidance(full, '2026-11-01', {}, '2026-10-31')
    details = engine.forecast_details(full, g, as_of='2026-10-31')
    assert details['method'] == 'external'
    assert details['scenarios'] is None  # 12 residuals cannot yield a finite P95.
    unflagged = copy.deepcopy(item)
    for r in unflagged['external_forecasts']:
        r.pop('p95_flag'); r['p80'] = r['p50']; r['p95'] = r['p50']
    assert engine.forecast(unflagged, months, '2026-10-31', 6) == p
    # A real same-class peer supplies sufficient independent-SKU residuals.
    peer = dict(item, sku='PEER')
    d = engine.forecast_details(full, dict(quantity=100, endpoint='2026-11-30', incoming=0),
                                as_of='2026-10-31', peers=[peer])
    assert d['scenarios']['label'] == 'Conformal range'
    assert d['scenarios']['p95'] < 1e12


def test_unknown_external_sku_does_not_discard_valid_stock(tmp_path):
    _, sources = _load_modules()
    item, months = external_item()
    write_bundle(tmp_path,item,months)
    with (tmp_path/'forecasts.csv').open('a') as f:
        f.write('UNKNOWN,2026-11,1,2,3,archive,,2026-10\n')
    data=sources.load_bundle(tmp_path,today='2026-11-01')
    assert data['items'][0]['sku'] == 'EXT'
    assert data['external_ignored'] is True
    assert 'external_forecasts' not in data['items'][0]


def write_bundle(root, item, months):
    with (root/'stock.csv').open('w', newline='') as f:
        w=csv.writer(f); w.writerow(['sku','name','unit','on_hand','supplier_days']+months)
        w.writerow(['EXT','Synthetic','box',60,14]+item['monthly_sales'])
    with (root/'forecasts.csv').open('w', newline='') as f:
        w=csv.DictWriter(f, fieldnames=['sku','month','p50','p80','p95','source','p95_flag','origin'])
        w.writeheader()
        for row in item['external_forecasts']:
            w.writerow(dict(row, sku='EXT'))


def test_csv_bundle_bridge_cli_and_absent_bytes(tmp_path):
    _, sources = _load_modules()
    item, months = external_item()
    write_bundle(tmp_path, item, months)
    data = sources.load_bundle(tmp_path, today='2026-11-01')
    imported = data['items'][0]
    assert 'p95' not in imported['external_forecasts'][0]
    assert imported['external_forecasts'][0]['p95_flag'] == 'heuristic'
    assert engine.forecast_selection(imported,'2026-10')['method'] == 'external'
    bridge = subprocess.run([sys.executable,'bundle_import.py',str(tmp_path),'--today','2026-11-01'],capture_output=True,text=True,check=True)
    assert json.loads(bridge.stdout) == data
    cli = subprocess.run([sys.executable,'stock_runway.py','--bundle',str(tmp_path),'--today','2026-11-01'],capture_output=True,text=True)
    assert cli.returncode == 0, cli.stderr
    assert 'EXT' in cli.stdout
    (tmp_path/'forecasts.csv').unlink()
    before = json.dumps(sources.load_bundle(tmp_path, today='2026-11-01'))
    assert 'external_forecasts' not in before
    assert json.dumps(sources.load_bundle(tmp_path, today='2026-11-01')) == before


@pytest.mark.parametrize('replacement', ['NaN','-1','1000000000001'])
def test_invalid_csv_p50_drops_only_archive(tmp_path, replacement):
    _, sources = _load_modules()
    item, months = external_item()
    item['external_forecasts'][0]['p50'] = replacement
    write_bundle(tmp_path,item,months)
    data = sources.load_bundle(tmp_path, today='2026-11-01')
    assert data['external_ignored'] is True
    assert 'external_forecasts' not in data['items'][0]
    from health import data_health
    assert dict(code='external_ignored',sku='',severity='warning',short_label='Import ignored') in data_health(data)['warnings']
