"""Synthetic-only round-two regression contract."""
import unittest
import engine
import forecast_methods as methods
from forecast_lab.benchmark_methods import generate, origins


class DyingDemand(unittest.TestCase):
    def test_frozen_dying_origins_do_not_resurrect_old_season_or_size(self):
        for row in generate(100):
            if row['process'] != 'dying':
                continue
            for origin in origins(row):
                ys = row['observed'][:origin]
                self.assertEqual(methods.classify(ys)['class'], 'dying')
                self.assertEqual(methods.classify(ys)['method'], 'naive')
                self.assertEqual(methods.forecast(ys, 12, 'auto'), [0] * 12)

    def test_normal_sparse_zero_runs_do_not_become_naive_zero(self):
        counts = {k: [0,0] for k in ('dying','intermittent','lumpy')}
        for row in generate(1000):
            if row['process'] not in counts:
                continue
            for origin in origins(row):
                kind = row['process']
                counts[kind][0] += 1
                counts[kind][1] += methods.classify(row['observed'][:origin])['class']=='dying'
        self.assertGreaterEqual(counts['dying'][1]/counts['dying'][0], .99)
        for kind in ('intermittent','lumpy'):
            self.assertLess(counts[kind][1]/counts[kind][0], .10)
        ys=[100,0,0,0]*10+[0]*6
        self.assertNotEqual(methods.classify(ys)['class'],'dying')

    def test_decline_and_zero_run_take_precedence_over_seasonality(self):
        for ys in ([100]*36 + [40, 30, 20, 10, 5, 2], [100]*36 + [0]*12):
            info = methods.classify(ys)
            self.assertEqual(info['class'], 'dying')
            self.assertEqual(methods.forecast(ys, 3, 'auto'), [ys[-1]]*3)
        self.assertEqual(methods.classify([0]*24)['class'], 'inactive')
        self.assertEqual(methods.classify([100, 0, 0])['class'], 'new')


class RoundTwoBuffersAndBudgets(unittest.TestCase):
    def test_empirical_signed_misses_and_short_history_fallback(self):
        item = dict(sku='SYN', monthly_sales=[10,20]*18, supplier_days=0, on_hand=0)
        settings = engine.normalize_order_settings(dict(forecast_method='naive', safety_stock_basis='forecast_misses', review_days=30))
        got = engine.forecast_miss_buffer(item, '2024-12', settings, 1)
        self.assertEqual(got['buffer'], 10)
        self.assertEqual(got['samples'], 24)
        self.assertEqual(got['window_months'], 1)
        item['monthly_sales'] = [10,20]*5
        self.assertIsNone(engine.forecast_miss_buffer(item, '2024-12', settings, 1))
        opt = engine.inventory_planning(item, '2024-12', settings)
        normal = engine.inventory_planning(item, '2024-12', {})
        self.assertEqual(opt['safety_stock'], normal['safety_stock'])
        self.assertIn('fallback', opt['safety_stock_provenance'])

    def test_large_protection_uses_one_step_fallback_without_horizon_error(self):
        item = dict(sku='SYN', monthly_sales=[10,20]*300)
        settings = engine.normalize_order_settings(dict(forecast_method='auto'))
        got = engine.forecast_miss_buffer(item, '2050-12', settings, 244)
        self.assertEqual(got['window_months'], 1)

    def test_budget_bisection_matches_and_discloses_floors(self):
        from forecast_lab.equal_budget import match_budget
        evaluate = lambda x: dict(average_inventory_value=10+5*x,safety_multiplier=x)
        got = match_budget(evaluate, 20)
        self.assertTrue(got['matched'])
        self.assertAlmostEqual(got['average_inventory_value'],20)
        got = match_budget(evaluate, 5)
        self.assertFalse(got['matched'])
        self.assertEqual(got['match_note'],'below zero-buffer floor')
        self.assertEqual(got['safety_multiplier'],0)

    def test_cached_scaled_safety_seam_equals_original_at_one(self):
        from forecast_lab.equal_budget import prepare, replay
        from forecast_lab.benchmark_methods import inventory_case
        cases=prepare(generate(10),1,['current','auto'])
        for case in cases:
            for method in ('current','auto'):
                for basis in ('sales_variation','forecast_misses'):
                    original=inventory_case(case['values'],case['months'],case['curves'][method],case['truth'],method,safety_stock_basis=basis)
                    optimized=inventory_case(case['values'],case['months'],case['curves'][method],case['truth'],method,safety_stock_basis=basis,base_buffer=case['buffers'][method,basis])
                    self.assertEqual(original,optimized)


if __name__ == '__main__':
    unittest.main()
