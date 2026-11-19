"""Real subprocess method CLI acceptance. Synthetic local CSV, fixed planning date.

No patched engine, subprocess mocks, Hermes services, or customer inputs.
"""
import csv
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest
import engine
import forecast_methods
from tests.test_cli import load_cli

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'stock_runway.py'
TODAY = '2026-11-01'
METHODS = ('current', 'auto', *[m for m in forecast_methods.METHODS if m != 'auto'])


@pytest.fixture
def sample():
    scratch = ROOT / '.scratch'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='methods-cli-', dir=scratch) as folder:
        folder = Path(folder)
        stock = folder / 'synthetic-sample.csv'
        months = [engine.month_after('2023-11', i) for i in range(36)]
        with stock.open('w', newline='') as handle:
            writer = csv.writer(handle)
            writer.writerow(['sku', 'name', 'unit', 'on_hand', 'supplier_days', *months])
            writer.writerow(['SYN-TREND', 'Synthetic trend', 'units', 0, 14,
                             *[10 + i * 3 + (i % 3) * 5 for i in range(36)]])
            writer.writerow(['SYN-SPARSE', 'Synthetic intermittent', 'units', 500, 21,
                             *[40 + i if i % 5 == 0 else 0 for i in range(36)]])
            writer.writerow(['SYN-COVERED', 'Synthetic covered', 'units', 3000, 14,
                             *[30 + i % 3 for i in range(36)]])
        yield folder, stock


def run(stock, *args):
    env = dict(os.environ, TMPDIR=str(ROOT / '.scratch'))
    result = subprocess.run([sys.executable, str(CLI), str(stock), '--today', TODAY,
                             *map(str, args)], cwd=ROOT, env=env, capture_output=True,
                            text=True, timeout=60)
    assert 'Traceback' not in result.stderr, result.stderr
    return result


def exported(stock, *args):
    result = run(stock, *args)
    assert result.returncode == 0, result.stderr
    rows = list(csv.DictReader(io.StringIO(result.stdout)))
    assert rows, result.stdout
    return result, rows


@pytest.mark.parametrize('method', METHODS)
def test_real_subprocess_all_methods_match_engine(sample, method):
    _, stock = sample
    result, rows = exported(stock, '--all', '--method', method)
    assert len(rows) == 3
    assert {r['sku'] for r in rows} == {'SYN-TREND', 'SYN-SPARSE', 'SYN-COVERED'}
    assert '3 items exported (of 3)' in result.stderr
    # Independent adapter oracle retains actual CSV importer + engine output.
    # Other suites install a package named stock_runway for relative imports.
    # Load the actual CLI file, not that unrelated package namespace.
    cli = load_cli()
    core, sources = cli._load_modules()
    expected = cli._export_rows(sources.load_csv(str(stock)), core, TODAY,
                            {'forecast_method': method}, True)
    output = io.StringIO()
    cli._write_csv(output, expected)
    assert rows == list(csv.DictReader(io.StringIO(output.getvalue())))


def test_default_current_repeatable_and_all_filter(sample):
    _, stock = sample
    implicit, all_rows = exported(stock, '--all')
    explicit, _ = exported(stock, '--all', '--method', 'current')
    repeat, _ = exported(stock, '--all')
    assert implicit.stdout == explicit.stdout == repeat.stdout
    _, filtered = exported(stock)
    assert filtered == [r for r in all_rows if r['status'] in ('order', 'running-low')]
    assert len(filtered) < len(all_rows)
    _, naive = exported(stock, '--all', '--method', 'naive')
    assert naive != all_rows  # Proves opt-in actually reaches forecast/order outputs.


def test_settings_roundtrip_and_priority(sample):
    folder, stock = sample
    settings = folder / 'settings.json'
    saved = {'forecast_method': 'naive', 'industry_preset': 'retail',
             'months_of_cover': 3, 'buffer_days': 2, 'service_level': .99,
             'default_delivery_days': 19}
    settings.write_text(json.dumps(saved))
    original = settings.read_bytes()
    a, _ = exported(stock, '--all', '--settings', settings)
    copy = folder / 'roundtrip.json'
    copy.write_text(json.dumps(json.loads(settings.read_text())))
    b, _ = exported(stock, '--all', '--settings', copy)
    flags = ['--all', '--months-of-cover', '3', '--buffer-days', '2',
             '--service-level', '.99', '--delivery-days', '19']
    c, _ = exported(stock, *flags, '--method', 'naive')
    assert a.stdout == b.stdout == c.stdout
    # Explicit preset overrides saved method; explicit method overrides both,
    # regardless of flag order. Ordering knobs remain the saved values.
    for preset, info in forecast_methods.PRESETS.items():
        preset_result, _ = exported(stock, '--all', '--settings', settings, '--preset', preset)
        expected, _ = exported(stock, *flags, '--method', info['method'])
        assert preset_result.stdout == expected.stdout
        assert f'Using: {info["method"]}' in preset_result.stderr
        for override in [('--method', 'ma3', '--preset', preset),
                         ('--preset', preset, '--method', 'ma3')]:
            actual, _ = exported(stock, '--all', '--settings', settings, *override)
            wanted, _ = exported(stock, *flags, '--method', 'ma3')
            assert actual.stdout == wanted.stdout
            assert 'Using: ma3' in actual.stderr
    assert settings.read_bytes() == original
    target = folder / 'orders.csv'
    result = run(stock, '--all', '--settings', copy, '-o', target)
    assert result.returncode == 0, result.stderr
    assert target.read_text(encoding='utf-8-sig') == a.stdout
    assert '3 items exported (of 3)' in result.stdout


@pytest.mark.parametrize('args', [('--method', 'invented'), ('--preset', 'invented'),
                                  ('--method', 'AUTO'), ('--method', '')])
def test_invalid_flags_fail_without_csv(sample, args):
    result = run(sample[1], '--all', *args)
    assert result.returncode == 2
    assert 'invalid choice' in result.stderr
    assert not result.stdout


@pytest.mark.parametrize('bad', [{'forecast_method': 'invented'}, {'industry_preset': 'invented'},
                                 {'forecast_method': None}, {'forecast_method': 7},
                                 {'forecast_method': True}, [], '{broken'])
def test_invalid_settings_fail_without_touching_output(sample, bad):
    folder, stock = sample
    settings, target = folder / 'bad.json', folder / 'orders.csv'
    settings.write_text(bad if isinstance(bad, str) else json.dumps(bad))
    target.write_text('existing output sentinel')
    result = run(stock, '--all', '--settings', settings, '-o', target)
    assert result.returncode == 2
    assert 'error:' in result.stderr
    assert not result.stdout
    assert target.read_text() == 'existing output sentinel'


def test_library_default_stays_deterministic_ses():
    history = [10, 12, 14, 9, 15, 18, 16, 14, 13, 19, 21, 17]
    before = list(history)
    assert forecast_methods.forecast(history) == forecast_methods.forecast(history, method='ses')
    assert forecast_methods.forecast(history) == forecast_methods.forecast(history)
    assert history == before
