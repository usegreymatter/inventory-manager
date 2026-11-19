"""Offline stdlib tests; never imports a live ERP adapter."""
import copy
import importlib.util
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    path = ROOT / 'scripts' / (name + '.py')
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


synth = load_script('synth_demand')
bench = load_script('benchmark_forecast_lab')


class SyntheticTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(synth, 'synthetic generator is not implemented')
        self.data = synth.generate(seed=20261112, skus=500)

    def test_default_exact_count_patterns_and_reproducibility(self):
        self.assertEqual(self.data, synth.generate(seed=20261112))
        self.assertNotEqual(self.data, synth.generate(seed=3))
        self.assertEqual(len(self.data['skus']), 500)
        self.assertEqual(len({s['sku'] for s in self.data['skus']}), 500)
        self.assertEqual(set(s['pattern'] for s in self.data['skus']), set(synth.PATTERNS))
        self.assertTrue(self.data['synthetic'])
        self.assertIn('SYNTHETIC', self.data['scenario'])
        self.assertIn('not actual Hijri', self.data['ramadan_calendar_note'])

    def test_monthly_schema_latent_separate_and_history_lengths(self):
        rows_by_sku = {}
        for row in self.data['rows']:
            self.assertTrue({'sku', 'month', 'demand', 'project_qty', 'one_off',
                             'in_stock_days', 'days_in_month', 'month_end_stock',
                             'backorder'} <= set(row))
            self.assertNotIn('latent_demand', row)
            self.assertGreaterEqual(row['demand'], 0)
            self.assertLessEqual(row['in_stock_days'], row['days_in_month'])
            rows_by_sku.setdefault(row['sku'], []).append(row)
        for sku in self.data['skus']:
            rows = rows_by_sku[sku['sku']]
            self.assertEqual(len(rows), 9 if sku['pattern'] == 'new' else 60)
            self.assertEqual(len(rows), len(self.data['latent_demand'][sku['sku']]))
            self.assertEqual([r['month'] for r in rows], sorted(r['month'] for r in rows))
        stockout = next(s['sku'] for s in self.data['skus'] if s['pattern'] == 'stockout')
        self.assertTrue(any(r['demand'] < t['demand'] for r, t in zip(
            rows_by_sku[stockout], self.data['latent_demand'][stockout])))

    def test_pairs_and_cleaning_options_are_resolvable(self):
        ids = {s['sku'] for s in self.data['skus']}
        options = self.data['cleaning_options']
        self.assertTrue(options['supersessions'])
        self.assertTrue(options['transfers'])
        self.assertTrue(options['manual_pct'])
        for old, new in options['supersessions'].items():
            self.assertIn(old, ids)
            self.assertIn(new, ids)
            self.assertNotEqual(old, new)
        for pair in self.data['linked_pairs']:
            self.assertIn(pair['from_sku'], ids)
            self.assertIn(pair['to_sku'], ids)
        for transfer in options['transfers']:
            self.assertGreater(transfer['quantity'], 0)
            self.assertIn(transfer['from_sku'], ids)
            self.assertIn(transfer['to_sku'], ids)

    def test_generator_metadata_runs_through_actual_cleaning(self):
        import forecast_lab
        cleaned = forecast_lab.clean_demand(self.data['rows'], **self.data['cleaning_options'])
        self.assertEqual(len(cleaned['rows']), len(self.data['rows']))
        self.assertTrue(all(isinstance(row['backorder'], bool) for row in self.data['rows']))
        self.assertTrue(all(value == 10 for value in self.data['cleaning_options']['manual_pct'].values()))
        for transfer in self.data['cleaning_options']['transfers']:
            # Correct attribution goes from observed substitute to intended SKU.
            pair = next(p for p in self.data['linked_pairs'] if p['kind'] == 'substitute'
                        and p['to_sku'] == transfer['from_sku'])
            self.assertEqual(pair['from_sku'], transfer['to_sku'])
        by_key = {(r['sku'],r['month']):r['demand'] for r in cleaned['rows']}
        for item in self.data['skus']:
            if item['pattern'] == 'substitute':
                for truth in self.data['latent_demand'][item['sku']]:
                    self.assertEqual(by_key[item['sku'],truth['month']], truth['demand'])

    def test_argument_validation_and_small_dataset(self):
        for bad in (0, -1, 1.5, True):
            with self.assertRaises(ValueError):
                synth.generate(skus=bad)
        data = synth.generate(skus=20)
        self.assertEqual(len(data['skus']), 20)
        self.assertEqual(len(data['linked_pairs']), 2)


class RecordingAPI:
    METHODS = ('baseline', 'seasonal_naive')

    def __init__(self):
        self.calls = []

    def eligible(self, method, values, similar=None):
        return method == 'baseline' or len(values) >= 24

    def forecast(self, values, horizon=1, method='baseline', similar=None, scale=1):
        self.calls.append(('forecast', method, tuple(values), tuple(similar or [])))
        return [values[-1] * scale] * horizon

    def analyze(self, values, horizon=3, similar=None, scale=1, **kwargs):
        self.calls.append(('analyze', tuple(values), tuple(similar or [])))
        value = values[-1] * scale
        return {'method': 'baseline', 'forecast': [value] * horizon,
                'uncertainty': [{'horizon': h + 1, 'lower': 0, 'upper': value * 2,
                                 'samples': len(values)} for h in range(horizon)]}


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(synth, 'synthetic generator is not implemented')
        self.assertIsNotNone(bench, 'benchmark harness is not implemented')
        self.data = synth.generate(seed=1, skus=20)

    def test_fold_does_not_observe_future_rows_or_latent_truth(self):
        sku = self.data['skus'][0]['sku']
        api1, api2 = RecordingAPI(), RecordingAPI()
        first = bench.evaluate_fold(self.data, sku, 42, api1)
        changed = copy.deepcopy(self.data)
        cutoff = self.data['latent_demand'][sku][42]['month']
        for row in changed['rows']:
            if row['month'] >= cutoff:
                row['demand'] = 999999
        for values in changed['latent_demand'].values():
            for row in values:
                row['demand'] = 777777  # training truth must also be inaccessible
        second = bench.evaluate_fold(changed, sku, 42, api2)
        self.assertEqual(api1.calls, api2.calls)
        self.assertEqual(first['selected']['prediction'], second['selected']['prediction'])
        self.assertNotEqual(first['truth'], second['truth'])

    def test_fold_inputs_clean_projects_and_only_past_stockouts(self):
        project = next(s['sku'] for s in self.data['skus'] if s['pattern'] == 'project')
        clean = bench.prepare_history(self.data, project, '2024-01')
        latent = [r['demand'] for r in self.data['latent_demand'][project] if r['month'] < '2024-01']
        self.assertEqual(clean, latent)
        stockout = next(s['sku'] for s in self.data['skus'] if s['pattern'] == 'stockout')
        before = bench.prepare_history(self.data, stockout, '2024-01')
        changed = copy.deepcopy(self.data)
        for row in changed['rows']:
            if row['month'] >= '2024-01':
                row['demand'] = 1000000
        self.assertEqual(before, bench.prepare_history(changed, stockout, '2024-01'))

    def test_benchmark_uses_actual_floor_and_transfer_pipeline(self):
        import forecast_lab
        stockout = next(s['sku'] for s in self.data['skus'] if s['pattern'] == 'stockout')
        rows = [dict(r) for r in self.data['rows'] if r['sku'] == stockout and r['month'] < '2024-01']
        expected = [r['demand'] for r in forecast_lab.clean_demand(rows)['rows']]
        self.assertEqual(bench.prepare_history(self.data, stockout, '2024-01'), expected)
        for pair in self.data['linked_pairs']:
            if pair['kind'] == 'substitute':
                for sku in (pair['from_sku'],pair['to_sku']):
                    truth = [r['demand'] for r in self.data['latent_demand'][sku] if r['month'] < '2024-01']
                    self.assertEqual(bench.prepare_history(self.data, sku, '2024-01'), truth)

    def test_null_p95_is_suppressed_without_changing_point_error_metrics(self):
        class ThinTailAPI(RecordingAPI):
            def analyze(self, *args, **kwargs):
                result = super().analyze(*args, **kwargs)
                for band in result['uncertainty']:
                    if band['horizon'] != 1:
                        band['upper'] = None
                return result
        reference = bench.run_benchmark(self.data, api=RecordingAPI())
        report = bench.run_benchmark(self.data, api=ThinTailAPI())
        for pattern, group in report['by_pattern'].items():
            self.assertEqual(group['selection'], reference['by_pattern'][pattern]['selection'])
            for counter in group['coverage']:
                self.assertEqual(counter['total_points'], group['folds'])
                self.assertEqual(counter['points'] + counter['suppressed_points'], counter['total_points'])
                if counter['horizon'] == 1:
                    self.assertEqual(counter['suppressed_points'], 0)
                    self.assertIsNotNone(counter['coverage'])
                else:
                    self.assertEqual(counter['points'], 0)
                    self.assertEqual(counter['covered'], 0)
                    self.assertIsNone(counter['coverage'])
                    self.assertIsNone(counter['mean_width'])

    def test_nonfinite_bound_still_rejected_even_with_null_other_tail(self):
        class InvalidAPI(RecordingAPI):
            def analyze(self, *args, **kwargs):
                result = super().analyze(*args, **kwargs)
                result['uncertainty'][0].update(lower=float('inf'), upper=None)
                return result
        with self.assertRaisesRegex(ValueError, 'invalid uncertainty interval'):
            bench.run_benchmark(self.data, api=InvalidAPI())

    def test_real_conformal_benchmark_has_no_fabricated_finite_p95(self):
        report = bench.run_benchmark(self.data)
        for group in report['by_pattern'].values():
            for counter in group['coverage']:
                self.assertEqual(counter['points'], 0)
                self.assertEqual(counter['suppressed_points'], group['folds'])
                self.assertIsNone(counter['coverage'])

    def test_report_has_common_folds_ineligibility_and_real_errors(self):
        report = bench.run_benchmark(self.data, api=RecordingAPI())
        self.assertTrue(report['synthetic'])
        self.assertEqual(report['sku_count'], 20)
        for pattern, group in report['by_pattern'].items():
            self.assertGreater(group['selection']['points'], 0)
            for name, metrics in group['methods'].items():
                self.assertEqual(metrics['points'], metrics['baseline']['points'])
                if metrics['points']:
                    self.assertTrue(math.isfinite(metrics['mae']))
                    self.assertEqual(metrics['mae'], metrics['baseline']['mae'])
            for coverage in group['coverage']:
                self.assertGreaterEqual(coverage['coverage'], 0)
                self.assertLessEqual(coverage['coverage'], 1)
        new = report['by_pattern']['new']['methods']['seasonal_naive']
        self.assertEqual(new['points'], 0)
        self.assertGreater(new['ineligible_folds'], 0)
        self.assertIsNone(new['mae'])


if __name__ == '__main__':
    unittest.main()
