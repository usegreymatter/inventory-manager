"""Synthetic economic checks; no forecast fitting or live data."""
import importlib.util
import math
from pathlib import Path
import statistics
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ProfitOrderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('profit_order', ROOT/'profit_order.py')
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def spec(self, **kw):
        return dict(demand_paths=[80,100,120], on_hand=0, incoming=0, lead_days=0,
                    review_days=30, unit_cost=10, sale_price=20, **kw)

    def test_missing_prices_hidden(self):
        self.assertIsNone(self.module.suggest(dict(demand_paths=[10],unit_cost=10)))
        self.assertIsNone(self.module.suggest(dict(demand_paths=[10],sale_price=20)))

    def test_hand_worked_perishable_and_alternatives(self):
        r=self.module.suggest(self.spec(usable_window_days=30,annual_holding_pct=0))
        self.assertEqual(r['qty'],100)
        self.assertEqual(r['expected_profit'],round((600+1000+1000)/3,6))
        self.assertEqual(r['critical_ratio'],.5)
        self.assertEqual(r['method'],'simulated')
        self.assertTrue(all(a['qty']!=r['qty'] for a in r['alt']))

    def test_ties_choose_smaller_and_fixed_cost_can_skip(self):
        s=self.spec(usable_window_days=30,annual_holding_pct=0)
        s['demand_paths']=[80,120]
        self.assertEqual(self.module.suggest(s)['qty'],80)
        self.assertEqual(self.module.suggest({**s,'ordering_cost':10000})['qty'],0)

    def test_moq_pack_stock_and_shelf_cap(self):
        s=self.spec(MOQ=95,pack=12,annual_holding_pct=0,usable_window_days=30)
        r=self.module.suggest(s)
        self.assertEqual(r['qty']%12,0)
        self.assertGreaterEqual(r['qty'],95)
        self.assertEqual(self.module.suggest({**s,'shelf_cap_qty':90})['qty'],0)
        self.assertEqual(self.module.suggest({**s,'on_hand':1000})['qty'],0)
        self.assertEqual(self.module.suggest({**s,'usable_window_days':0})['qty'],0)

    def test_normal_closed_form(self):
        # Deterministic stratified normal cloud avoids probabilistic test flakiness.
        normal=statistics.NormalDist(100,20)
        paths=[max(0,normal.inv_cdf((i+.5)/200)) for i in range(200)]
        for price in (12,20,40):
            s=self.spec(usable_window_days=30,annual_holding_pct=20)
            s.update(demand_paths=paths,sale_price=price)
            r=self.module.suggest(s)
            h=10*.2*30/365
            cr=(price-10)/(price-10+10+h)
            self.assertAlmostEqual(r['critical_ratio'],cr,places=6)
            self.assertLessEqual(abs(r['qty']-normal.inv_cdf(cr)),2)

    def test_monotonic_margin_holding_and_life(self):
        for i in range(25):
            s=self.spec(sku=str(i),history=[0,20,80,100,50,150],forecast=[100,110,80],
                        usable_window_days=30,pack=3,MOQ=9)
            del s['demand_paths']
            quantities=[self.module.suggest({**s,'sale_price':p})['qty'] for p in (11,15,20,40)]
            self.assertEqual(quantities,sorted(quantities))
            quantities=[self.module.suggest({**s,'annual_holding_pct':h})['qty'] for h in (0,20,100)]
            self.assertEqual(quantities,sorted(quantities,reverse=True))
            quantities=[self.module.suggest({**s,'usable_window_days':w})['qty'] for w in (0,3,7,15,30,60)]
            self.assertEqual(quantities,sorted(quantities))

    def test_seeded_nonmutating_and_lead_losses_not_debt(self):
        s=self.spec(sku='SKU-😀',history=[0,20,80],forecast=[100,120],as_of='2026-10')
        del s['demand_paths']
        before=repr(s)
        self.assertEqual(self.module.suggest(s),self.module.suggest(s))
        self.assertEqual(repr(s),before)
        s=self.spec(annual_holding_pct=0,usable_window_days=30)
        s['demand_paths']=[{'lead':1000,'demand':20}]
        s.update(on_hand=10,incoming=5)
        self.assertEqual(self.module.suggest(s)['qty'],15)

    def test_long_lived_inventory_is_asset_not_immediate_writeoff(self):
        s=self.spec(usable_window_days=365,annual_holding_pct=0)
        self.assertEqual(self.module.suggest(s)['qty'],120)
        self.assertEqual(self.module.suggest(s)['expected_profit'],1000)

    def test_dated_receipts_keep_pre_receipt_shortages_and_ignore_late_supply(self):
        s=self.spec(annual_holding_pct=0);s['demand_paths']=[30]
        self.assertEqual(self.module.suggest({**s,'receipts':[{'day':15,'quantity':100}]})['qty'],15)
        self.assertEqual(self.module.suggest({**s,'receipts':[{'day':60,'quantity':100}]})['qty'],30)
        s.update(lead_days=10,demand_paths=[{'lead':10,'demand':30}])
        self.assertEqual(self.module.suggest({**s,'receipts':[{'day':5,'quantity':20}]})['qty'],15)

    def test_bruteforce_grid_matches_candidate_search(self):
        import random
        rng=random.Random(821)
        for _ in range(200):
            demand=[rng.randrange(0,50) for _ in range(20)]
            moq,pack=rng.randrange(0,80),rng.choice([1,2,5])
            cost,price=10,rng.choice([11,15,20,40])
            fixed=rng.randrange(0,100)
            s=self.spec(MOQ=moq,pack=pack,usable_window_days=30,ordering_cost=fixed)
            s.update(demand_paths=demand,sale_price=price)
            result=self.module.suggest(s)
            choices=[0]+[q for q in range(pack,101,pack) if q>=moq]
            def profit(q):
                sold=sum(min(q,d) for d in demand)/len(demand)
                return (price-cost)*sold-(cost+cost*.2*30/365)*(q-sold)-(fixed if q else 0)
            expected=sorted(choices,key=lambda q:(-round(profit(q),6),q))[0]
            self.assertEqual(result['qty'],expected,(s,result))

    def test_review_regressions_moq_decimal_grid_and_ties(self):
        s=self.spec();s['demand_paths']=[50]
        self.assertEqual(self.module.suggest({**s,'MOQ':100})['qty'],100)
        s.update(demand_paths=[8.3,8.3],pack=.1,MOQ=8.3,usable_window_days=30,annual_holding_pct=0)
        self.assertEqual(self.module.suggest(s)['qty'],8.3)
        self.assertEqual(self.module.suggest({**s,'MOQ':0,'shelf_cap_qty':4.1})['qty'],4.1)
        s.update(demand_paths=[10]*40+[100]*160,sale_price=10.25,salvage_pct=90,pack=1,MOQ=0)
        self.assertEqual(self.module.suggest(s)['qty'],10)

    def test_review_regression_shelf_paths_stay_paired_at_block_boundary(self):
        s=dict(sku='1',as_of='2026-10',history=[10,200,30,150,5,90],forecast=[100],
               lead_days=60,review_days=60,unit_cost=10,sale_price=20,pack=.1)
        quantities=[self.module.suggest({**s,'usable_window_days':w})['qty'] for w in (1,7,29,30,31,59,60,61)]
        self.assertEqual(quantities,sorted(quantities))

    def test_invalid_inputs_reject_not_coerce(self):
        for key,value in [('pack',0),('pack',1e12),('MOQ',-.1)]:
            with self.assertRaises(ValueError):self.module.suggest(self.spec(**{key:value}))
        for key,value in [('on_hand',True),('lead_days',-1),('review_days',float('nan')),
                          ('sale_price','20'),('demand_paths',[]),('salvage_pct',101),
                          ('demand_paths',[{'lead':0,'demand':-1}])]:
            s=self.spec();s[key]=value
            with self.assertRaises(ValueError):self.module.suggest(s)

class ProfitIntegrationTests(unittest.TestCase):
    def test_evaluation_pass_reuses_simulation_and_invalidates_price(self):
        import engine,json,profit_order
        from unittest.mock import patch
        data=json.loads((ROOT/'data/sample.json').read_text())
        raw={**data['items'][0],'on_order':0,'unit_cost':10,'sale_price':20}
        settings={'profit_suggestion':True}
        @engine.evaluation_pass
        def evaluate():
            p=engine.forecast(raw,data['months'],data['as_of'],settings=settings,today='2026-11-01')
            item={**raw,**p,'on_hand':raw['on_hand'],'monthly_sales':raw['monthly_sales'],'as_of':data['as_of']}
            engine.order_guidance(item,'2026-11-01',settings)
            self.assertEqual(spy.call_count,1)
            engine.order_guidance({**item,'sale_price':30},'2026-11-01',settings)
            self.assertEqual(spy.call_count,2)
        with patch.object(profit_order,'suggest',wraps=profit_order.suggest) as spy:
            evaluate()

    def test_opt_in_setting_and_engine_only_add_suggestion(self):
        import engine
        import json
        data=json.loads((ROOT/'data/sample.json').read_text())
        raw={**data['items'][0],'sale_price':20,'unit_cost':10,'on_hand':0}
        physical=engine.forecast(raw,data['months'],data['as_of'])
        item={**raw,**physical,'on_hand':0,'monthly_sales':raw['monthly_sales'],'as_of':data['as_of']}
        old=engine.order_guidance(item,'2026-11-01',engine.validate_order_settings({}))
        settings=engine.validate_order_settings({'profit_suggestion':True})
        new=engine.order_guidance(item,'2026-11-01',settings)
        self.assertIn('profit_suggestion',new)
        self.assertEqual({k:v for k,v in new.items() if k!='profit_suggestion'},old)
        self.assertNotIn('profit_suggestion',engine.order_guidance(item,'2026-11-01',{'profit_suggestion':False}))
        held=engine.order_guidance({**item,'held':['check']},'2026-11-01',settings)
        self.assertNotIn('profit_suggestion',held)

if __name__=='__main__':unittest.main()
