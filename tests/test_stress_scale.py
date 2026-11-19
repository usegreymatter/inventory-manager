"""Synthetic-only scale-generator contracts; never build tracked artifacts."""
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import stress_scale


class ScaleGeneratorTests(unittest.TestCase):
    def test_seed_reproducible_and_effective(self):
        a = stress_scale.catalog(30, 73021)
        self.assertEqual(a, stress_scale.catalog(30, 73021))
        self.assertNotEqual(a, stress_scale.catalog(30, 73022))

    def test_catalog_sizes_metadata_and_calendar(self):
        for size in (5000, 20000, 50000):
            with self.subTest(size=size):
                data = stress_scale.catalog(size, 73021)
                self.assertEqual(len(data['items']), size)
                self.assertEqual(len({i['sku'] for i in data['items']}), size)
                self.assertEqual(len(data['months']), 48)
                self.assertEqual(data['months'][-1] + '-31', data['as_of'])
                self.assertTrue(all(len(i['monthly_sales']) == 48 for i in data['items']))
                self.assertEqual(len({i['category'] for i in data['items']}), 8)
                self.assertEqual(len({i['supplier'] for i in data['items']}), 16)

    def test_outside_scratch_rejected(self):
        import argparse
        with self.assertRaises(argparse.ArgumentTypeError):
            stress_scale.scratch_path(ROOT / 'standalone/design/option-gm-b.html')
        self.assertEqual(stress_scale.scratch_path(ROOT / '.scratch/stress/test'), ROOT / '.scratch/stress/test')


if __name__ == '__main__':
    unittest.main()
