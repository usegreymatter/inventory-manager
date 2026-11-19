"""File-backed synthetic benchmark/report acceptance; never connects to ERP."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_report_covers_every_method_pattern_and_honest_limits():
    report = ROOT / 'docs/forecast-lab/REPORT.md'
    results = ROOT / 'docs/forecast-lab/benchmark_results.json'
    assert report.exists(), 'benchmark report missing'
    assert results.exists(), 'reproducible benchmark evidence missing'
    text = report.read_text()
    data = json.loads(results.read_text())
    assert data['synthetic'] is True
    assert data['sku_count'] == 500
    assert len(data['by_pattern']) == 10
    assert sum(group['folds'] for group in data['by_pattern'].values()) == 1400
    for name in data['methods']:
        assert name in text
    for pattern, group in data['by_pattern'].items():
        assert pattern in text
        for method, metric in group['methods'].items():
            if metric['wape'] is not None:
                assert f"{metric['wape']*100:.2f}%" in text, (pattern,method)
    # Phase 3: finite P95 tails are suppressed (not "undercovered") and production adapters exist
    # (no longer "not wired"); the report must still state both limits honestly.
    for caveat in ('synthetic ≠ real', 'selection bias', 'unattainable', 'zero finite p95',
                   'not a benchmark of the production', 'retired', 'manual'):
        assert caveat in text.lower()


def test_integration_contract_preserves_future_gate():
    text = (ROOT / 'docs/forecast-lab/INTEGRATION.md').read_text()
    for term in ('NOT connected', 'proposed', 'aggregate_uncertainty', 'NOT sums',
                 'sigma_L_days', 'cycle service', '≥5 receipts', 'basic', 'backorder=True',
                 'Python/JS', 'forecast_demand', 'suggested_order_quantity'):
        assert term in text
