"""Regression: risk uses FEFO-usable stock; money still values physical stock."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('v12_cost_cli',ROOT/'stock_runway.py')
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
engine,_=cli._load_modules()

class ExpiredCostTests(unittest.TestCase):
    def test_expired_stock_has_same_lost_margin_as_zero_stock(self):
        data={'as_of':'2026-10-31','months':['2026-08','2026-09','2026-10']}
        base={'sku':'EXPIRED','name':'Synthetic','unit':'ea','monthly_sales':[30,30,30], 'supplier_days':14,'on_order':0,'unit_cost':4,'sale_price':10}
        def metrics(stock,lots=None):
            item={**base,'on_hand':stock}
            if lots is not None:item['lots']=lots
            calculated={**item,**engine.forecast(item,data['months'],data['as_of'],6,{},'2026-11-01'), 'monthly_sales':item['monthly_sales'],'on_hand':stock,'as_of':data['as_of']}
            guidance=engine.order_guidance(calculated,'2026-11-01',{},data['as_of'])
            return cli._cost_display(calculated,guidance,engine,data,'2026-11-01',{})
        expired=metrics(200,[{'lot':'past','expiry':'2026-10-30','qty':200}])
        empty=metrics(0)
        self.assertGreater(empty['lost_profit_est'],0)
        self.assertEqual(expired['lost_profit_est'],empty['lost_profit_est'])
        self.assertEqual(expired['money_tied_up'],800)

if __name__=='__main__':unittest.main()
