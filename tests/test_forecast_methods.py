"""Synthetic-only method contracts; no holdout or real-data access."""
import math
import unittest

import forecast_methods as fm


class ForecastMethodsTests(unittest.TestCase):
    def test_registry_and_advisory_presets(self):
        self.assertEqual(len(fm.METHODS), 16)
        self.assertNotIn('current', fm.METHODS)
        self.assertEqual(set(fm.METHODS), set(fm.METHOD_LABELS))
        self.assertEqual(set(fm.PRESETS), {'distributor', 'retail', 'spare-parts', 'restaurant', 'pharmacy', 'seasonal', 'ecommerce'})
        for row in fm.PRESETS.values():
            self.assertIn(row['method'], fm.METHODS)
            self.assertTrue(row['note'])

    def test_empty_and_zero_all_methods(self):
        for ys in ([], [0], [0] * 36):
            for method in fm.METHODS:
                self.assertEqual(fm.forecast(ys, 120, method), [0] * 120)
        self.assertEqual(fm.classify([])['class'], 'new')
        self.assertEqual(fm.classify([0] * 12)['class'], 'inactive')
        self.assertIsNone(fm.classify([])['adi'])
        self.assertIsNone(fm.classify([])['cv2'])

    def test_constant_all_methods(self):
        for method in fm.METHODS:
            result = fm.forecast([10] * 36, method=method)
            self.assertEqual(result, [9.5 if method == 'sba' else 10] * 12)

    def test_input_validation(self):
        invalid = [None, {}, (), '123', [True], [False], [None], ['2'], [-1],
                   [float('nan')], [float('inf')], [1e12 + 1], [10**500], [0] * 1201]
        for ys in invalid:
            for function in (fm.classify, fm.forecast):
                with self.subTest(values=str(ys)[:30], function=function.__name__):
                    with self.assertRaises(ValueError):
                        function(ys)

    def test_horizon_and_method_validation_even_when_empty(self):
        for horizon in (0, -1, 121, True, 1.5, '12', None, float('nan')):
            with self.assertRaises(ValueError):
                fm.forecast([], horizon)
        for method in ('current', 'SES', '__proto__', '', None, []):
            with self.assertRaises(ValueError):
                fm.forecast([], method=method)

    def test_naive_moving_averages_and_default(self):
        ys = list(range(1, 17))
        self.assertEqual(fm.forecast(ys, 2, 'naive'), [16] * 2)
        for width in (3, 6, 12):
            self.assertEqual(fm.forecast(ys, 2, 'ma' + str(width)), [sum(ys[-width:]) / width] * 2)
        self.assertEqual(fm.forecast(ys), fm.forecast(ys, 12, 'ses'))
        self.assertEqual(fm.forecast([10], 3, 'ma12'), [10] * 3)

    def test_seasonal_naive_phase_and_fallback(self):
        ys = list(range(1, 26))
        self.assertEqual(fm.forecast(ys, 25, 'seasonal_naive'), (ys[-12:] * 3)[:25])
        self.assertEqual(fm.forecast([1, 2, 3], 3, 'seasonal_naive'), [3] * 3)

    def test_ses_grid_one_step_sse_not_future_fit(self):
        ys = [5, 9, 3, 7, 20, 6, 2]
        candidates = []
        for step in range(1, 10):
            level, sse = ys[0], 0
            for y in ys[1:]:
                sse += (y - level) ** 2
                level += step / 10 * (y - level)
            candidates.append((sse, step, level))
        self.assertAlmostEqual(fm.forecast(ys, 1)[0], min(candidates)[2], places=8)
        self.assertEqual(fm.forecast(ys, 1), fm.forecast(ys, 120)[:1])

    def test_hw_thin_and_zero_fallbacks(self):
        for n in (1, 11, 12, 23):
            ys = list(range(1, n + 1))
            for method in ('hw_additive', 'hw_multiplicative'):
                self.assertEqual(fm.forecast(ys, 12, method), fm.forecast(ys))
        ys = [10, 0, 20, 5, 8, 7, 9, 10, 15, 20, 5, 8] * 3
        self.assertEqual(fm.forecast(ys, method='hw_multiplicative'), fm.forecast(ys))
        self.assertNotEqual(fm.forecast(ys, method='hw_additive'), fm.forecast(ys))

    def test_ses_exact_sse_ties_choose_lowest_alpha(self):
        # A two-point history has the same one-step error for every alpha.
        self.assertEqual(fm.forecast([0, 10], 3, 'ses'), [1] * 3)

    def test_holt_damped_recurrence_and_single_value_fallback(self):
        ys = [5, 10, 6, 20, 3]
        level, trend = ys[0], ys[1] - ys[0]
        for y in ys[1:]:
            old = level
            level = .4 * y + .6 * (level + .9 * trend)
            trend = .2 * (level - old) + .8 * .9 * trend
        damping, power = 0, 1
        for value in fm.forecast(ys, 12, 'holt_damped'):
            power *= .9
            damping += power
            self.assertAlmostEqual(value, max(0, level + damping * trend), places=8)
        self.assertEqual(fm.forecast([5], 3, 'holt_damped'), [5] * 3)

    def test_multiplicative_tiny_level_guard_is_disclosed_ses(self):
        ys = [1e-300] * 12 + [1e12] * 12
        self.assertEqual(fm.forecast(ys, method='hw_multiplicative'), fm.forecast(ys))

    def test_subnormal_positive_events_remain_observed(self):
        row = fm.classify([5e-324, 1e12])
        self.assertEqual(row['adi'], 1)
        self.assertEqual(row['cv2'], 1)

    def test_hw_uses_season_and_alignment(self):
        ys = [10, 20, 5, 10, 50, 10, 30, 5, 20, 10, 60, 5] * 3
        for method in ('hw_additive', 'hw_multiplicative'):
            result = fm.forecast(ys, 12, method)
            self.assertGreater(result[4], result[3])
            self.assertGreater(result[10], result[11])
            self.assertEqual(result[:3], fm.forecast(ys, 3, method))
            self.assertEqual(fm.forecast(ys + ys[:1], 11, method), result[1:])

    def test_theta_level_plus_half_drift(self):
        ys = list(range(1, 21))
        level = fm.forecast(ys, 1, 'ses')[0]
        theta = fm.forecast(ys, 3, 'theta')
        for i, value in enumerate(theta):
            self.assertAlmostEqual(value, level + .5 * (i + 1), places=8)

    def test_croston_sba_initial_interval_and_decay(self):
        ys = [0, 10, 0, 0, 20, 0]
        rate = (10 + .1 * (20 - 10)) / (2 + .1 * (3 - 2))
        self.assertAlmostEqual(fm.forecast(ys, 1, 'croston')[0], rate, places=8)
        self.assertAlmostEqual(fm.forecast(ys, 1, 'sba')[0], .95 * rate, places=8)
        self.assertEqual(fm.forecast(ys + [0] * 30, 1, 'croston'), fm.forecast(ys, 1, 'croston'))
        self.assertLess(fm.forecast(ys + [0] * 30, 1, 'tsb')[0], fm.forecast(ys, 1, 'tsb')[0])

    def test_tsb_explicit_probability_update(self):
        ys = [0, 10, 0, 0, 20, 0]
        size, probability = 10, 1 / 2
        for y in ys[2:]:
            probability += .1 * (bool(y) - probability)
            if y:
                size += .1 * (y - size)
        self.assertAlmostEqual(fm.forecast(ys, 1, 'tsb')[0], size * probability, places=8)

    def test_adida_block_sum_disaggregation_and_prefix(self):
        self.assertEqual(fm.forecast([0, 10] * 12, 2, 'adida'), [5] * 2)
        self.assertEqual(fm.forecast([99] + [0, 10] * 12, 2, 'adida'), [5] * 2)
        expected = fm.forecast([0, 12], 1, 'ses')[0] / 12
        for value in fm.forecast([0] * 23 + [12], 2, 'adida'):
            self.assertAlmostEqual(value, expected, places=9)

    def test_combination_is_per_horizon_median(self):
        ys = [1, 4, 6, 2, 10, 12, 4, 20, 25, 18, 20, 27]
        members = [fm.forecast(ys, 24, m) for m in ('ses', 'theta', 'holt_damped')]
        expected = [sorted(row)[1] for row in zip(*members)]
        self.assertEqual(fm.forecast(ys, 24, 'combination'), expected)

    def test_classification_classes_and_fixed_auto(self):
        cases = [([10] * 11, 'new'), ([10] * 12, 'smooth'),
                 ([10, 0] * 6, 'intermittent'), ([1, 30] * 6, 'erratic'),
                 ([1, 0, 30, 0] * 3, 'lumpy'), ([10] * 18 + [2, 2, 2, 1, 1, 0], 'dying'),
                 ([10, 20, 5, 10, 50, 10, 30, 5, 20, 10, 60, 5] * 3, 'seasonal')]
        for ys, name in cases:
            with self.subTest(name=name):
                row = fm.classify(ys)
                self.assertEqual(row['class'], name)
                self.assertEqual(set(row), {'class', 'adi', 'cv2', 'history_months', 'seasonality_strength', 'trend', 'method'})
                self.assertEqual(fm.forecast(ys, 6, 'auto'), fm.forecast(ys, 6, row['method']))

    def test_adi_cv2_thresholds_and_population_variance(self):
        self.assertEqual(fm.classify([3, 17] * 6)['class'], 'erratic')
        ys = [10] * 33
        for i in (0, 2, 5, 9, 15, 20, 24, 28):
            ys[i] = 0
        self.assertEqual(fm.classify(ys)['adi'], 1.32)
        self.assertEqual(fm.classify(ys)['class'], 'intermittent')
        self.assertEqual(fm.classify([4, 16] * 6)['class'], 'smooth')

    def test_dying_requires_sustained_recent_decline(self):
        self.assertNotEqual(fm.classify([10] * 9 + [1, 4, 2])['class'], 'dying')
        # Three-month dips no longer send sparse/noisy histories to naive zero.
        self.assertNotEqual(fm.classify([10] * 9 + [0, 0, 0])['class'], 'dying')
        self.assertNotEqual(fm.classify([10] * 9 + [5, 5, 5])['class'], 'dying')
        self.assertEqual(fm.classify([10] * 18 + [0] * 6)['class'], 'dying')
        self.assertEqual(fm.classify([10] * 18 + [2] * 6)['class'], 'dying')

    def test_no_spurious_seasonality_on_trend_or_constant(self):
        for ys in ([10] * 36, list(range(1, 37))):
            self.assertEqual(fm.classify(ys)['seasonality_strength'], 0)
            self.assertNotEqual(fm.classify(ys)['class'], 'seasonal')
        self.assertGreater(fm.classify(list(range(1, 37)))['trend'], 0)

    def test_bounds_extremes_determinism_and_no_mutation(self):
        for ys in ([1e12] * 1200, [0, 1e12] * 40, [5e-324, 1e-300] * 12,
                   [1e-300] * 12 + [1e12] * 12, list(range(100))):
            original = ys[:]
            for method in fm.METHODS:
                result = fm.forecast(ys, 120, method)
                self.assertEqual(len(result), 120)
                self.assertTrue(all(math.isfinite(v) and 0 <= v <= 1e12 for v in result))
                self.assertEqual(result, fm.forecast(ys, 120, method))
            self.assertEqual(ys, original)


if __name__ == '__main__':
    unittest.main()
