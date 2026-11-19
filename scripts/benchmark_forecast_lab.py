#!/usr/bin/env python3
"""Offline SYNTHETIC held-out forecast benchmark (stdlib only).

Run from the repository root. Generates data in process; no credentials, ERP,
network, clock, or observed future values are consulted. Three disjoint rolling
holdouts per regular SKU, one for short-history new SKUs. Each candidate is paired
with baseline on IDENTICAL eligible folds; common_all_methods additionally uses
the strict intersection across every method. Selection and interval coverage use
analyze(prefix) only, never analyze(full_history). Latent truth is used solely
for held-out scoring; service_z retains the API default, without test-set tuning.

Cleaning uses forecast_lab.clean_demand on observed connected-component rows
strictly before each cutoff, including its .25 in-stock-fraction floor. Maps and
transfers are assumed known operational metadata. Optional manual uplift is NOT
applied in this method-accuracy benchmark (it is an operator scenario, not truth).
No latent demand or future observed rows are used in training.
"""
import argparse
from collections import defaultdict
import importlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def _row_index(data):
    index = defaultdict(list)
    for row in data['rows']:
        index[row['sku']].append(row)
    return {sku: sorted(rows, key=lambda r: r['month']) for sku, rows in index.items()}


def prepare_history(data, sku, cutoff, index=None):
    """Run the actual lab pipeline on the known prefix; never access latent truth."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from forecast_lab import clean_demand
    index = _row_index(data) if index is None else index
    options = data['cleaning_options']
    members = {sku}
    edges = list(options['supersessions'].items()) + [
        (t['from_sku'], t['to_sku']) for t in options['transfers'] if t['month'] < cutoff]
    changed = True
    while changed:
        old = len(members)
        for source, target in edges:
            if source in members or target in members:
                members.update((source, target))
        changed = old != len(members)
    rows = [row for member in sorted(members) for row in index[member] if row['month'] < cutoff]
    links = {old:new for old,new in options['supersessions'].items() if old in members}
    transfers = [t for t in options['transfers'] if t['from_sku'] in members and t['month'] < cutoff]
    cleaned = clean_demand(rows, supersessions=links, transfers=transfers)
    return [r['demand'] for r in cleaned['rows'] if r['sku'] == sku]


def _predictions(values, horizon):
    values = [float(v) for v in values]
    if len(values) != horizon or any(not math.isfinite(v) or v < 0 for v in values):
        raise ValueError('forecast must have exactly horizon finite nonnegative values')
    return values


def evaluate_fold(data, sku, origin, api, horizon=3, index=None):
    """Evaluate one prefix against latent holdout; api is injectable for unit tests."""
    index = _row_index(data) if index is None else index
    observed = index[sku]
    if origin < 1 or origin + horizon > len(observed):
        raise ValueError('origin must leave a complete holdout')
    cutoff = observed[origin]['month']
    history = prepare_history(data, sku, cutoff, index)
    metadata = {s['sku']: s for s in data['skus']}
    donors = [s['sku'] for s in data['skus'] if s['sku'] != sku
              and s['pattern'] == metadata[sku]['pattern']]
    similar = prepare_history(data, donors[0], cutoff, index) if donors else None
    scale = 1  # operator uplift is a scenario, not part of method skill scoring
    candidates = {}
    for method in api.METHODS:
        ok = bool(api.eligible(method, history, similar=similar))
        candidates[method] = {'eligible': ok, 'prediction': None}
        if ok:
            candidates[method]['prediction'] = _predictions(
                api.forecast(history, horizon=horizon, method=method, similar=similar, scale=scale), horizon)
    if not candidates.get('baseline', {}).get('eligible'):
        raise ValueError('baseline must be eligible on benchmark folds')
    selected = api.analyze(history, horizon=horizon, similar=similar, scale=scale)
    prediction = _predictions(selected['forecast'], horizon)
    bands = selected.get('uncertainty', selected.get('bands', selected.get('uncertainty_bands')))
    if isinstance(bands, dict):
        bands = bands.get('bands')
    if not isinstance(bands, list) or len(bands) != horizon:
        raise ValueError('analyze must return one uncertainty band per horizon')
    # Truth is intentionally first read AFTER all forecast calls.
    truth_by_month = {r['month']: r['demand'] for r in data['latent_demand'][sku]}
    truth = [float(truth_by_month[r['month']]) for r in observed[origin:origin + horizon]]
    return {'sku': sku, 'origin': origin, 'cutoff': cutoff, 'train_months': len(history),
            'truth': truth, 'methods': candidates,
            'selected': {'method': selected['method'], 'prediction': prediction}, 'bands': bands}


def _metrics(pairs):
    if not pairs:
        return {'points': 0, 'mae': None, 'wape': None}
    error = sum(abs(actual - predicted) for actual, predicted in pairs)
    total = sum(abs(actual) for actual, _ in pairs)
    return {'points': len(pairs), 'mae': error / len(pairs),
            'wape': error / total if total else None}


def load_api():
    """Import the parent's experimental module only when running real benchmarks."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    api = importlib.import_module('forecast_lab')
    for name in ('forecast', 'analyze', 'eligible', 'METHODS'):
        if not hasattr(api, name):
            raise RuntimeError('forecast_lab API is not ready: missing ' + name)
    return api


def run_benchmark(data, api=None, horizon=3):
    api = load_api() if api is None else api
    index = _row_index(data)
    groups = defaultdict(list)
    for item in data['skus']:
        sku = item['sku']
        n = len(index[sku])
        origins = [origin for origin in (n - 3 * horizon, n - 2 * horizon, n - horizon)
                   if origin >= 6]
        for origin in origins:
            groups[item['pattern']].append(evaluate_fold(data, sku, origin, api, horizon, index))
    report = {'synthetic': True, 'seed': data['seed'], 'sku_count': len(data['skus']),
              'horizon': horizon, 'methods': list(api.METHODS),
              'target': data['target_definition'], 'wape_unit': 'fraction; null when total actual is zero',
              'policy': 'Rolling disjoint holdouts, prefix-only selection/cleaning/donors; paired baseline on exact eligible folds; strict all-method intersection also reported',
              'interval_policy': 'Split-conformal finite P05/P95 tails only; null bounds suppress coverage/width points, not counted as hits or misses; null rate when no finite interval',
              'caveat': 'SYNTHETIC scenarios only, not production validation; pattern labels and static cleaning metadata are known; no actual Hijri calendar',
              'by_pattern': {}}
    for pattern, folds in sorted(groups.items()):
        baseline_pairs, selected_pairs = [], []
        selections = defaultdict(int)
        coverage = [{'horizon': h + 1, 'covered': 0, 'points': 0,
                     'total_points': 0, 'suppressed_points': 0,
                     'width_sum': 0.0, 'calibration_samples_min': None} for h in range(horizon)]
        common = [f for f in folds if all(m['eligible'] for m in f['methods'].values())]
        group = {'folds': len(folds), 'methods': {}, 'common_all_methods': {'folds': len(common), 'methods': {}}}
        for method in api.METHODS:
            paired, matched_baseline, ineligible = [], [], 0
            for fold in folds:
                candidate = fold['methods'][method]
                if not candidate['eligible']:
                    ineligible += 1
                    continue
                paired.extend(zip(fold['truth'], candidate['prediction']))
                matched_baseline.extend(zip(fold['truth'], fold['methods']['baseline']['prediction']))
            metrics = _metrics(paired)
            base = _metrics(matched_baseline)
            metrics.update({'baseline': base, 'eligible_folds': len(folds) - ineligible,
                            'ineligible_folds': ineligible,
                            'status': 'eligible' if paired else 'ineligible',
                            'mae_improvement_vs_baseline': (base['mae'] - metrics['mae']) if paired else None})
            group['methods'][method] = metrics
            group['common_all_methods']['methods'][method] = _metrics(
                [(actual, predicted) for fold in common for actual, predicted in
                 zip(fold['truth'], fold['methods'][method]['prediction'])])
        for fold in folds:
            baseline_pairs.extend(zip(fold['truth'], fold['methods']['baseline']['prediction']))
            selected_pairs.extend(zip(fold['truth'], fold['selected']['prediction']))
            selections[fold['selected']['method']] += 1
            by_horizon = {b['horizon']: b for b in fold['bands']}
            for h, actual in enumerate(fold['truth']):
                band, counter = by_horizon[h + 1], coverage[h]
                lower, upper = band['lower'], band['upper']
                # Null is an unavailable finite tail, not zero, infinity, a hit,
                # or a miss. Invalid non-null bounds remain hard failures.
                if any(isinstance(v, bool) or not isinstance(v, (int, float))
                       or not math.isfinite(v) or v < 0
                       for v in (lower, upper) if v is not None):
                    raise ValueError('invalid uncertainty interval')
                samples = int(band['samples'])
                old = counter['calibration_samples_min']
                counter['calibration_samples_min'] = samples if old is None else min(old, samples)
                counter['total_points'] += 1
                if lower is None or upper is None:
                    counter['suppressed_points'] += 1
                    continue
                if lower > upper:
                    raise ValueError('invalid uncertainty interval')
                counter['covered'] += int(lower <= actual <= upper)
                counter['points'] += 1
                counter['width_sum'] += upper - lower
        group['selection'] = _metrics(selected_pairs)
        group['selection']['baseline'] = _metrics(baseline_pairs)
        group['selection']['chosen_methods'] = dict(sorted(selections.items()))
        for counter in coverage:
            counter['coverage'] = counter['covered'] / counter['points'] if counter['points'] else None
            counter['mean_width'] = counter.pop('width_sum') / counter['points'] if counter['points'] else None
        group['coverage'] = coverage
        report['by_pattern'][pattern] = group
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261112)
    parser.add_argument('--skus', type=int, default=500)
    parser.add_argument('--output', type=Path, default=Path('.scratch/benchmark.json'))
    args = parser.parse_args(argv)
    if str(Path(__file__).resolve().parent) not in sys.path:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
    from synth_demand import generate
    try:
        report = run_benchmark(generate(seed=args.seed, skus=args.skus))
    except (ImportError, ValueError, RuntimeError) as exc:
        parser.exit(2, str(exc) + '\n')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(f"SYNTHETIC benchmark: {report['sku_count']} SKUs, seed={args.seed}; WAPE is a fraction")
    for pattern, group in report['by_pattern'].items():
        selected, baseline = group['selection'], group['selection']['baseline']
        cov = ','.join(f"h{c['horizon']}=" + (f"{c['coverage']:.3f}" if c['coverage'] is not None else 'null') + f"({c['points']}/{c['total_points']} finite)" for c in group['coverage'])
        print(f"{pattern:18s} folds={group['folds']:3d} baseline_MAE={baseline['mae']:.3f} selected_MAE={selected['mae']:.3f} coverage[{cov}]")
    print('Output:', args.output)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
