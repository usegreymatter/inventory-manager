"""Synthetic, hand-worked shelf-life acceptance and calendar boundaries."""
import sys
import types
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
p = types.ModuleType('shelf_test_package'); p.__path__ = [str(ROOT)]
sys.modules.setdefault('shelf_test_package', p)
from shelf_test_package import engine as e


def item(**extra):
    return dict(sku='S', name='Synthetic', unit='units', monthly_sales=[300]*3,
                monthly_demand=300, seasonal=False, on_hand=0, supplier_days=0,
                receipts={}, as_of='2026-10-31', **extra)


class ShelfLifeTests(unittest.TestCase):
    def guidance(self, raw=None, **settings):
        return e.order_guidance(raw or item(), '2026-10-31', settings)

    def test_short_life_and_short_dated_arrival(self):
        g=self.guidance(shelf_life_days=10)
        self.assertEqual(g['quantity'],100)
        self.assertEqual(g['shelf_cap_qty'],100)
        self.assertEqual(g['order_every_days'],10)
        self.assertTrue(g['coarse_warning'])
        self.assertTrue(g['capped'])
        self.assertEqual(self.guidance(shelf_life_days=30,arrival_age_days=18,min_remaining_life_days=5)['quantity'],70)

    def test_cap_after_pack_and_moq_conflict(self):
        raw=item(pack_size=24)
        self.assertEqual(self.guidance(raw,shelf_life_days=10)['quantity'],96)
        raw['minimum_order']=120
        g=self.guidance(raw,shelf_life_days=10)
        self.assertEqual(g['quantity'],0)
        self.assertEqual(g['status'],'shelf-conflict')
        self.assertIn('120',g['cap_reason']); self.assertIn('96',g['cap_reason'])
        self.assertGreater(g['uncapped_qty'],0)

    def test_no_usable_life_and_stock_subtraction(self):
        g=self.guidance(shelf_life_days=20,arrival_age_days=18,min_remaining_life_days=5)
        self.assertEqual(g['quantity'],0)
        self.assertEqual(g['status'],'shelf-conflict')
        raw=item();raw['on_hand']=40;raw['monthly_sales']=[0,300,600]
        g=self.guidance(raw,shelf_life_days=10)
        self.assertEqual(g['shelf_cap_qty'],60)

    def test_fefo_and_expired_lots(self):
        raw=item(lots=[dict(lot='A',expiry='2026-10-30',qty=100),dict(lot='B',expiry='2026-11-05',qty=100)])
        raw['on_hand']=200;raw['supplier_days']=2
        g=self.guidance(raw)
        self.assertEqual(g['expiry_at_risk_qty'],150)
        self.assertEqual(g['expiry_excluded_qty'],150)
        self.assertEqual(g['expiring'][1]['sell_through_qty'],50)
        self.assertEqual(g['expiring'][1]['clear_by'],'2026-11-03')
        self.assertGreater(g['quantity'],self.guidance({k:v for k,v in raw.items() if k!='lots'})['quantity'])
        raw['lots']=[dict(lot='A',expiry='2026-11-05',qty=80),dict(lot='B',expiry='2026-11-10',qty=80)]
        raw['on_hand']=160
        g=self.guidance(raw)
        self.assertEqual([r['at_risk_qty'] for r in g['expiring']],[30,30])

    def test_off_shape_and_settings(self):
        self.assertNotIn('capped',self.guidance())
        settings=e.validate_order_settings(dict(shelf_life_days=30, arrival_age_days=0, min_remaining_life_days=0,
             product_overrides={'S':dict(shelf_life_days=10)}))
        self.assertEqual(self.guidance(**settings)['quantity'],100)
        for invalid in [0,-1,True,1.5]:
            with self.assertRaises(ValueError):e.validate_order_settings(dict(shelf_life_days=invalid))

    def test_ambiguous_lot_dates_hold_until_explicit_acknowledgement(self):
        raw=item(lots=[dict(lot='A',expiry='2026-11-05',qty=10,expiry_acknowledged=False)])
        raw['on_hand']=10
        g=self.guidance(raw)
        self.assertEqual(g['status'],'needs-data')
        self.assertIn('acknowledge',g['reason'])
        raw['lots'][0]['expiry_acknowledged']=True
        self.assertNotEqual(self.guidance(raw)['status'],'needs-data')

    def test_bad_lot_data_names_the_actual_problem(self):
        raw=item(lots=[dict(lot='A',expiry='not-a-date',qty=10)])
        g=self.guidance(raw)
        self.assertEqual(g['status'],'needs-data')
        self.assertEqual(g['reason'],'Lot expiry data needs checking.')

    def test_shelf_and_expiry_have_explicit_ledger_terms(self):
        s=dict(shelf_life_days=10)
        rows=e.why_breakdown(item(),'2026-10-31',s)
        self.assertIn('shelf_life_cap',[r['key'] for r in rows])
        self.assertNotIn('policy_cap',[r['key'] for r in rows])
        self.assertEqual(sum(r['qty'] for r in rows),100)
        raw=item(lots=[dict(lot='A',expiry='2026-10-30',qty=20)])
        raw['on_hand']=20
        rows=e.why_breakdown(raw,'2026-10-31',s)
        self.assertIn('expiry_exclusion',[r['key'] for r in rows])
        self.assertEqual(sum(r['qty'] for r in rows),100)

    def test_raw_invalid_shelf_setting_fails_closed(self):
        for invalid in [0,-1,True,1.5,'10']:
            self.assertEqual(self.guidance(shelf_life_days=invalid)['status'],'needs-data')

    def test_explanation_contains_explicit_shelf_cap(self):
        s=dict(shelf_life_days=10)
        self.assertIn('shelf-life cap',e.why_this_amount(item(),'2026-10-31',s).lower())

if __name__=='__main__':unittest.main()
