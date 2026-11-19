"""Opt-in method adapters; frozen Current and no observation-gap compaction."""
import copy
import json
from pathlib import Path
import unittest
import engine
import forecast_methods as methods

ROOT = Path(__file__).resolve().parents[1]


class MethodAdapters(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / 'data/sample.json').read_text())
        self.item = self.data['items'][0]
        self.months = self.data['months']
        self.asof = self.data['as_of']

    def test_current_and_presets_alone_are_identical(self):
        before = engine.forecast(self.item, self.months, self.asof)
        self.assertFalse(before['held'])
        for preset in ['none'] + list(methods.PRESETS):
            self.assertEqual(before, engine.forecast(self.item, self.months, self.asof,
                            settings={'forecast_method':'current', 'industry_preset':preset}))

    def test_all_method_curves_drive_projection_and_guidance(self):
        saved = copy.deepcopy(self.item)
        for method in methods.METHODS:
            settings = {'forecast_method':method}
            got = engine.forecast(self.item, self.months, self.asof, 12, settings)
            self.assertFalse(got['held'], (method, got))
            self.assertEqual([r['demand'] for r in got['projection']], methods.forecast(self.item['monthly_sales'],12,method))
            calculated = dict(self.item, **got, as_of=self.asof)
            guidance = engine.order_guidance(calculated,self.asof,settings)
            self.assertNotEqual(guidance['status'],'needs-data', (method,guidance))
            self.assertEqual(guidance['monthly_demand'],got['monthly_demand'])
            self.assertEqual(guidance['forecast_method'], got['forecast_method'])
            detail = engine.forecast_details(calculated,guidance,settings)
            self.assertIsNone(detail['scenarios'])
            self.assertEqual(detail['method'],got['forecast_method']['method'])
        self.assertEqual(saved,self.item)

    def test_validation_rejects_unknown_or_nonstrings(self):
        for field in ['forecast_method','industry_preset']:
            for value in ['__proto__','bad',{},[],True,None,123]:
                with self.assertRaises(ValueError):
                    engine.validate_order_settings({field:value})
        for method in ['current'] + methods.METHODS:
            self.assertEqual(engine.validate_order_settings({'forecast_method':method})['forecast_method'],method)

    def test_fallback_reports_actual_method(self):
        got=engine.forecast(self.item,self.months,self.asof,settings={'forecast_method':'hw_additive'})
        self.assertEqual(got['forecast_method']['method'],'ses')
        self.assertTrue(got['forecast_method']['fallback'])

    def test_memo_invalidation_same_product_different_methods(self):
        def run():
            a=engine.forecast(self.item,self.months,self.asof,settings={'forecast_method':'naive'})
            b=engine.forecast(self.item,self.months,self.asof,settings={'forecast_method':'ma12'})
            current=engine.forecast(self.item,self.months,self.asof)
            self.assertNotEqual(a['monthly_demand'],b['monthly_demand'])
            self.assertNotIn('forecast_method',current)
        engine.evaluation_pass(run)()


class MethodMetadata(unittest.TestCase):
    def test_internal_fallback_and_all_curves(self):
        cases = [[], [0]*24, [5]*36, [0,10,2]*12,
                 [1e-15]+[1.0]*23, [1.0]*12+[1e-15]*12]
        for values in cases:
            for method in methods.METHODS:
                for h in (1,12,120):
                    fitted = methods.forecast_with_metadata(values,h,method)
                    self.assertEqual(fitted['forecast'],methods.forecast(values,h,method))
        for values in cases[-2:]:
            got = methods.forecast_with_metadata(values,12,'hw_multiplicative')
            self.assertEqual(got['method'],'ses')
            self.assertTrue(got['fallback'])
            self.assertEqual(got['forecast'],methods.forecast(values,12,'ses'))
            item=dict(sku='EDGE',name='Edge',unit='units',on_hand=1,supplier_days=14,monthly_sales=values)
            months=[engine.month_after('2022-01',i) for i in range(24)]
            adapted=engine.forecast(item,months,'2023-12-31',12,{'forecast_method':'hw_multiplicative'})
            self.assertFalse(adapted['held'])
            self.assertEqual(adapted['forecast_method']['method'],'ses')
            self.assertTrue(adapted['forecast_method']['fallback'])
            self.assertEqual([r['demand'] for r in adapted['projection']],got['forecast'])

    def test_fit_cache_shares_values_and_invalidates_edits(self):
        from unittest.mock import patch
        data=json.loads((ROOT/'data/sample.json').read_text())
        item=data['items'][0]
        original=methods.forecast_with_metadata
        with patch.object(methods,'forecast_with_metadata',wraps=original) as fit:
            def run():
                a=engine.method_item(item,data['months'][-1],{'forecast_method':'auto'})
                b=engine.method_item(dict(item,sku='CLONE'),data['months'][-1],{'forecast_method':'auto'})
                self.assertEqual(a['_method_model'],b['_method_model'])
                self.assertEqual(fit.call_count,1)
                changed=dict(item,monthly_sales=item['monthly_sales'][:-1]+[item['monthly_sales'][-1]+100])
                engine.method_item(changed,data['months'][-1],{'forecast_method':'auto'})
                self.assertEqual(fit.call_count,2)
            engine.evaluation_pass(run)()
        self.assertEqual(methods.forecast_with_metadata([0]*24,12,'hw_additive')['method'],'hw_additive')

    def test_current_fallback_has_note_and_identical_numbers(self):
        data=json.loads((ROOT/'data/sample.json').read_text())
        for locked in (False,True):
            item=copy.deepcopy(data['items'][0])
            rows=[dict(sku=item['sku'],month=m,quantity=q,project=i==0)
                  for i,(m,q) in enumerate(zip(data['months'],item['monthly_sales']))]
            if locked:
                del rows[0]['project']
            item['planning_facts']=dict(version='1.0',sales_history=rows,errors={})
            current=engine.forecast(item,data['months'],data['as_of'])
            got=engine.forecast(item,data['months'],data['as_of'],settings={'forecast_method':'auto'})
            info=got.pop('forecast_method')
            self.assertEqual(info['method'],'current')
            self.assertTrue(info['fallback'])
            self.assertIn('Using Current:',info['note'])
            self.assertEqual(got,current)


if __name__ == '__main__':
    unittest.main()
