"""Contract for M's own synthetic evaluator, separate from Stress lane."""
import unittest


class AutoSyntheticTests(unittest.TestCase):
    def test_deterministic_nonnegative_and_separate_exposure(self):
        from forecast_lab.auto_synthetic import generate, FAMILIES
        for family in FAMILIES:
            a = generate(family, 1)
            self.assertEqual(a, generate(family, 1))
            self.assertEqual(len(a['latent']), 39)
            self.assertEqual(len(a['observed']), 39)
            self.assertTrue(all(x >= 0 for x in a['latent']))
            for truth, observed, exposure in zip(a['latent'], a['observed'], a['exposure']):
                self.assertAlmostEqual(truth * exposure, observed)

    def test_report_all_baselines_modes_and_paired_intervals(self):
        from forecast_lab.auto_synthetic import evaluate
        result = evaluate(seeds=2, bootstrap=20)
        self.assertTrue(result['synthetic_only'])
        self.assertEqual(result['series'], 10)
        for adjust in ('off', 'on'):
            row = result['modes'][adjust]
            self.assertEqual(set(row['metrics']), {'recommended', 'current', 'auto', 'combination', 'ses'})
            self.assertEqual(set(row['paired_deltas']), {'current', 'auto', 'combination', 'ses'})
            self.assertEqual(len(row['families']), 5)
            for pair in row['paired_deltas'].values():
                for metric in ('scaled_error', 'order_proxy'):
                    self.assertEqual(len(pair[metric]['ci90']), 2)
                    self.assertLessEqual(pair[metric]['ci90'][0], pair[metric]['ci90'][1])


if __name__ == '__main__':
    unittest.main()
