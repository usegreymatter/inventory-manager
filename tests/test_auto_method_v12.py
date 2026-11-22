"""Independent synthetic-only recommendation contracts (not November scoring)."""
import copy
import math
import unittest

import engine
import forecast_methods as fm


class RecommendedMethodTests(unittest.TestCase):
    def test_small_pool_and_frozen_registry(self):
        self.assertEqual(fm.RECOMMEND_CANDIDATES,
                         ('current', 'ses', 'seasonal_naive', 'sba', 'combination'))
        self.assertEqual(len(fm.METHODS), 16)  # fixed November candidates unchanged
        self.assertEqual(fm.recommend([20]*36)['method'], 'current')

    def test_thin_and_empty_keep_current(self):
        for xs in ([], [0]*36, [4, 8, 3], [5]*19):
            result = fm.recommend(xs)
            self.assertEqual(result['method'], 'current')
            self.assertEqual(len(result['forecast']), 12)
            self.assertTrue(result['reason'])
            self.assertTrue(all(math.isfinite(x) and x >= 0 for x in result['forecast']))

    def test_seasonal_backtest_uses_prefixes_and_clear_margin(self):
        xs = [20, 30, 250, 40, 10, 100, 20, 20, 10, 50, 10, 20]*3
        result = fm.recommend(xs, previous='current')
        self.assertEqual(result['method'], 'seasonal_naive')
        self.assertGreaterEqual(result['improvement'], .1)
        self.assertLessEqual(result['folds'], 8)
        self.assertEqual(result['forecast'], fm.forecast(xs, 12, 'seasonal_naive'))
        self.assertTrue(all(f['origin'] + len(f['actual']) <= len(xs) for f in result['backtest']))
        for fold in result['backtest']:
            for method, curve in fold['predictions'].items():
                self.assertEqual(curve, fm.recommend_forecast(xs[:fold['origin']], len(curve), method))

    def test_previous_choice_hysteresis_on_ties(self):
        result = fm.recommend([12]*36, previous='ses')
        self.assertEqual(result['method'], 'ses')
        self.assertIn('previous', result['reason'])
        self.assertEqual(fm.recommend([12]*36)['method'], 'current')

    def test_validation_and_no_mutation(self):
        xs = [0, 10, 4]*12
        saved = copy.deepcopy(xs)
        for adjust in (False, True):
            r = fm.recommend(xs, stockout_adjust=adjust)
            self.assertEqual(r['stockout_adjust'], adjust)
            self.assertIn('stockout', r['reason'].lower())
        self.assertEqual(xs, saved)
        for xs in ([True], [-1], [float('nan')], [0]*1201):
            with self.assertRaises(ValueError):
                fm.recommend(xs)
        for previous in ('auto', '__proto__', {}, []):
            with self.assertRaises(ValueError):
                fm.recommend([1]*36, previous=previous)
        with self.assertRaises(ValueError):
            fm.recommend([1]*36, stockout_adjust=1)

    def test_cap_fits_to_48_months(self):
        xs = list(range(1, 1201))
        a = fm.recommend(xs)
        b = fm.recommend(xs[-48:])
        for key in ('forecast', 'method', 'scores', 'folds'):
            self.assertEqual(a[key], b[key])

    def test_default_reconstructs_previous_month_choice_without_hidden_state(self):
        xs = [200,20,200,20,0,10,50,20,20,200,200,10,20,10,50,5,50,5,10,5,200]
        expected = fm.recommend(xs[:-1])['method']
        self.assertEqual(expected, 'combination')
        self.assertEqual(fm.recommend(xs[:-1], previous='current')['method'], 'current')
        got = fm.recommend(xs)
        self.assertEqual(got['previous_method'], expected)
        self.assertTrue(got['hysteresis'])

    def test_forecast_misses_is_withheld_not_a_hold(self):
        months = [engine.month_after('2030-01', i) for i in range(36)]
        item = dict(sku='S', name='Synthetic', unit='u', on_hand=10,
                    supplier_days=14, monthly_sales=[10, 40, 15]*12)
        settings = dict(forecast_method='recommended', safety_stock_basis='forecast_misses')
        result = engine.forecast(item, months, '2032-12-31', 12, settings)
        self.assertFalse(result['held'])
        self.assertEqual(result['safety_stock_provenance']['basis'], 'sales_variation')
        self.assertIn('recommend', result['safety_stock_provenance']['fallback'].lower())

    def test_current_candidate_matches_raw_engine_hybrid(self):
        for xs in ([10]*36, [0, 30, 5]*11, list(range(1, 27))):
            model = engine.demand_model(xs, '2032-07', summation=engine.planning_sum)
            expected = [engine.month_demand(model, engine.month_after('2032-07', h)) for h in range(1, 13)]
            for got, wanted in zip(fm.recommend_forecast(xs), expected):
                self.assertAlmostEqual(got, wanted, places=8)

    def test_reused_calculated_item_keeps_recommendation_evidence(self):
        xs = [20, 30, 250, 40, 10, 100, 20, 20, 10, 50, 10, 20]*3
        item = dict(sku='S', name='Synthetic', unit='u', on_hand=10,
                    supplier_days=14, monthly_sales=xs)
        settings = {'forecast_method': 'recommended'}
        a = engine.method_item(item, '2032-12', settings)
        b = engine.method_item(a, '2032-12', settings)
        self.assertEqual(a['forecast_method'], b['forecast_method'])

    def test_same_month_edits_do_not_import_raw_previous_choice(self):
        xs = [20, 30, 250, 40, 10, 100, 20, 20, 10, 50, 10, 20]*3
        item = dict(sku='S',name='Synthetic',unit='u',on_hand=10,supplier_days=14,monthly_sales=xs)
        settings = {'forecast_method':'recommended'}
        first = engine.method_item(item,'2032-12',settings)
        changed = dict(first,monthly_sales=[30]*36)
        expected = engine.method_item(dict(item,monthly_sales=[30]*36),'2032-12',settings)
        self.assertEqual(engine.method_item(changed,'2032-12',settings)['forecast_method'],expected['forecast_method'])

    def test_stockout_mode_reason_tracks_adjusted_guidance(self):
        xs = [50.0]*36
        xs[30] = 1.0
        months = [engine.month_after('2030-01', i) for i in range(36)]
        item = dict(sku='S',name='Synthetic',unit='u',on_hand=10,supplier_days=14,monthly_sales=xs)
        settings = dict(forecast_method='recommended',stockout_adjust=True)
        got = engine.forecast(item,months,'2032-12-31',12,settings)
        guidance = engine.order_guidance(dict(item,**got,as_of='2032-12-31'),'2032-12-31',settings)
        self.assertFalse(got['held'])
        self.assertIn('Stockout adjustment on', guidance['forecast_method']['reason'])

    def test_extreme_dynamic_range_stays_finite(self):
        for xs in ([5e-324]*24+[1e12]*3, [1e12]*24+[5e-324]*3):
            result = fm.recommend(xs)
            self.assertTrue(all(math.isfinite(v) for v in result['scores'].values()))
            self.assertTrue(all(math.isfinite(v) for v in result['forecast']))

    def test_opt_in_adapter_and_reason(self):
        xs = [20, 30, 250, 40, 10, 100, 20, 20, 10, 50, 10, 20]*3
        months = [engine.month_after('2030-01', i) for i in range(36)]
        item = dict(sku='SYNTH', name='Synthetic', unit='u', on_hand=10,
                    supplier_days=14, monthly_sales=xs)
        settings = {'forecast_method': 'recommended'}
        self.assertEqual(engine.validate_order_settings(settings)['forecast_method'], 'recommended')
        got = engine.forecast(item, months, '2032-12-31', 12, settings)
        self.assertFalse(got['held'])
        self.assertEqual([r['demand'] for r in got['projection']], fm.recommend(xs)['forecast'])
        self.assertIn('because', got['forecast_method']['label'])
        self.assertTrue(got['forecast_method']['reason'])
        self.assertNotIn('forecast_method', engine.forecast(item, months, '2032-12-31', 12))
        chosen = dict(item, **got, as_of='2032-12-31')
        guidance = engine.order_guidance(chosen, '2032-12-31', settings)
        details = engine.forecast_details(chosen, guidance, settings)
        self.assertIsNone(details['scenarios'])
        self.assertIn('calibration', details['note'])


if __name__ == '__main__':
    unittest.main()
