"""Stdlib-only tests: /usr/bin/python3 -m unittest discover -s tests -p test_methods_benchmark.py."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import engine
from forecast_lab import benchmark_methods as bench


class RecordingAPI:
    METHODS = ('auto', 'combination')

    def __init__(self):
        self.calls = []

    def forecast(self, values, horizon=12, method='ses'):
        self.calls.append((tuple(values), horizon, method))
        return [values[-1]] * horizon


class MethodsBenchmarkTests(unittest.TestCase):
    def test_generator_has_3000_reproducible_balanced_processes(self):
        rows = bench.generate()
        self.assertEqual(rows, bench.generate())
        self.assertEqual(len(rows), 3000)
        self.assertEqual(len({r['sku'] for r in rows}), 3000)
        self.assertEqual(bench.Counter(r['process'] for r in rows), {k: 300 for k in bench.CLASSES})
        self.assertNotEqual(rows[:10], bench.generate(10, seed=1))

    def test_intermittency_is_bernoulli_and_censoring_preserves_latent_truth(self):
        rows = bench.generate(100)
        for row in rows:
            if row['process'] in ('intermittent', 'lumpy'):
                self.assertTrue(any(v == 0 for v in row['observed']))
                self.assertTrue(any(v > 0 for v in row['observed']))
            if row['process'] == 'censored':
                self.assertTrue(any(a < b for a, b in zip(row['observed'], row['latent'])))
                self.assertTrue(all(a <= b for a, b in zip(row['observed'], row['latent'])))
            self.assertEqual(len(row['months']), len(row['latent']))
            self.assertEqual(len(row['observed']), 12 if row['process'] == 'new' else 60)

    def test_origin_windows_disjoint_and_prefix_only_for_each_method(self):
        row = bench.generate(10)[0]
        api = RecordingAPI()
        report = bench.run([row], api, inventory_per_class=0)
        self.assertEqual(report['origin_count'], 3)
        self.assertEqual(len(api.calls), 6)
        for i, origin in enumerate(bench.origins(row)):
            for values, horizon, _ in api.calls[2*i:2*i+2]:
                self.assertEqual(list(values), row['observed'][:origin])
                self.assertEqual(horizon, 12)
        windows = [set(range(o, o+3)) for o in bench.origins(row)]
        self.assertFalse(windows[0] & windows[1] or windows[1] & windows[2])

    def test_future_changes_do_not_change_earliest_fitted_input(self):
        row = bench.generate(10)[0]
        mutated = copy.deepcopy(row)
        first = bench.origins(row)[0]
        mutated['observed'][first:] = [9999] * (len(row['observed'])-first)
        a, b = RecordingAPI(), RecordingAPI()
        bench.run([row], a, inventory_per_class=0)
        bench.run([mutated], b, inventory_per_class=0)
        self.assertEqual(a.calls[:2], b.calls[:2])

    def test_actual_default_comparator_is_not_lab_flat_baseline(self):
        values = [0, 100, 0, 50, 0, 20, 0, 30, 0, 80, 0, 120]
        months = [engine.month_after('2024-01', i) for i in range(12)]
        actual = bench.current_forecast(values, months, 3)
        model = engine.demand_model(values, months[-1])
        expected = [engine.month_demand(model, engine.month_after(months[-1], h)) for h in range(1, 4)]
        self.assertEqual(actual, expected)
        self.assertNotEqual(actual, [sum(values[-3:])/3]*3)

    def test_unavailable_scales_are_excluded_even_when_error_zero(self):
        row = dict(sku='constant', process='constant', observed=[10.0]*12,
                   latent=[10.0]*12, months=[engine.month_after('2024-01', i) for i in range(12)])
        report = bench.run([row], RecordingAPI(), inventory_per_class=0)
        for value in report['groups']['overall'].values():
            self.assertIsNone(value['mase'])
            self.assertIsNone(value['rmsse'])
            self.assertEqual(value['scaled_points'], 0)
            self.assertEqual(value['unavailable_scale_points'], 9)
            self.assertEqual(value['bias_pct'], 0)

    def test_sample_excludes_july_and_all_later_months(self):
        data = dict(months=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06',
                            '2026-07','2026-08','2026-09','2026-10'],
                    items=[dict(sku='X', monthly_sales=[1,2,3,4,5,6,999,999,999,999])])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'fixture.json'
            path.write_text(json.dumps(data))
            row = bench.sample_rows(path)[0]
        self.assertEqual(row['observed'], [1,2,3,4,5,6])
        self.assertTrue(all(m < '2026-07' for m in row['months']))
        for origin in bench.origins(row):
            self.assertLess(row['months'][origin+2], '2026-07')

    def test_inventory_calls_actual_guidance_and_restores_callback(self):
        original = engine._guidance_demand
        values = [10.0, 12.0, 11.0]
        months = ['2024-01', '2024-02', '2024-03']
        calls = []
        def planner(item, today, settings, as_of):
            calls.append((item.copy(), settings.copy(), engine._guidance_demand(item)('2024-05')))
            return dict(status='healthy', quantity=0)
        with patch.object(engine, 'order_guidance', planner):
            result = bench.inventory_case(values, months, list(range(1, 13)), [20,20,20], 'auto')
        self.assertIs(engine._guidance_demand, original)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][2], 2)
        self.assertEqual(calls[0][1]['default_delivery_days'], 14)
        self.assertEqual(result['days'], 91)
        self.assertGreater(result['lost'], 0)
        self.assertAlmostEqual(result['sold'] + result['lost'], 60)

    def test_inventory_real_policy_is_deterministic(self):
        values = [10,12,11,8,10,9,13,10,11,12,10,11]
        months = [engine.month_after('2024-01', i) for i in range(12)]
        for method in ('current', 'auto'):
            result = bench.inventory_case(values, months, [11.0]*12, [10,12,11], method)
            self.assertEqual(result, bench.inventory_case(values, months, [11.0]*12, [10,12,11], method))
            self.assertEqual(result['cases'], 1)
            self.assertAlmostEqual(result['sold'] + result['lost'], 33)
            self.assertLessEqual(result['stockout_days'], result['days'])

    def test_bias_sign_is_prediction_minus_actual_and_zero_demand_null(self):
        row = dict(sku='x', process='x', observed=[20.0]*12, latent=[0.0]*12,
                   months=[engine.month_after('2024-01', i) for i in range(12)])
        m = bench.run([row], RecordingAPI(), inventory_per_class=0)['groups']['overall']['auto']
        self.assertEqual(m['bias_units'], 20)
        self.assertIsNone(m['bias_pct'])
        self.assertEqual(m['bias_actual_denominator'], 0)

    def test_bad_forecasts_fail_instead_of_changing_denominators(self):
        class BadAPI(RecordingAPI):
            def forecast(self, *args, **kwargs):
                return [float('nan')]*12
        with self.assertRaises(ValueError):
            bench.run(bench.generate(10)[:1], BadAPI(), inventory_per_class=0)

    def test_inventory_hold_is_explicit_no_execution_not_dropped_case(self):
        values = [10,12,11]
        with patch.object(engine, 'order_guidance', return_value=dict(status='needs-data', quantity=None)):
            result = bench.inventory_case(values, ['2024-01','2024-02','2024-03'], [0.001]+[0.0]*11, [10,10,10], 'auto')
        self.assertEqual(result['planner_holds'], 1)
        self.assertEqual(result['cases'], 1)
        self.assertAlmostEqual(result['sold'], 11)
        self.assertAlmostEqual(result['lost'], 19)

    def test_parameters_reject_bad_values(self):
        for value in (0, True, 11, -10, 3.5):
            with self.assertRaises(ValueError):
                bench.generate(value)
        for horizon in (0, 13, True):
            with self.assertRaises(ValueError):
                bench.run([], RecordingAPI(), horizon=horizon)
        with self.assertRaises(ValueError):
            bench.run([], RecordingAPI(), inventory_per_class=-1)


if __name__ == '__main__':
    unittest.main()
