"""Setup-guide recipes never add an industry-specific service target."""
import json
from pathlib import Path
import unittest
import engine


class PresetSetupGuideTests(unittest.TestCase):
    def test_weekly_monthly_guides_are_general_quantity_noops(self):
        presets = json.loads((Path(__file__).resolve().parents[1] / 'docs/presets.json').read_text())['presets']
        item = dict(sku='SYNTH', name='Synthetic', unit='ea', monthly_sales=[15, 100, 30],
                    monthly_demand=50, seasonal=False, on_hand=0, supplier_days=14,
                    receipts={}, as_of='2026-10-31')
        for review_days in (7, 30):
            current = engine.normalize_order_settings({'review_days': review_days})
            before = engine.order_guidance(item, item['as_of'], current)['quantity']
            for slug, preset in presets.items():
                with self.subTest(review_days=review_days, slug=slug):
                    proposed = dict(current, **preset['settings'])
                    proposed['months_of_cover'] = max(current['months_of_cover'],
                        preset['settings']['months_of_cover'])
                    self.assertEqual(proposed['service_level'], current['service_level'])
                    self.assertEqual(engine.order_guidance(item, item['as_of'], proposed)['quantity'], before)
        self.assertNotIn('service_level', presets['pharmacy']['settings'])
