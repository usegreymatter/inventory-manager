"""Display-only warning contracts: no changes to forecast or suggested amounts."""
import csv
import importlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WEEKLY = 'Profit suggestion is less reliable with weekly ordering or deliveries already on the way — in tests it filled less demand. Use the standard amount if running out is costly.'


class ProfitWarningTests(unittest.TestCase):
    def cli(self, settings, incoming=0, extra=(), as_json=True):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'synthetic.csv'; config=Path(directory)/'settings.json'
            path.write_text('sku,name,unit,on_hand,unit_cost,sale_price,supplier_days,supplier,on_order,2026-10,2026-11,2026-12\nA,Synthetic,u,0,10,20,3,Vendor,'+str(incoming)+',100,100,100\n')
            config.write_text(json.dumps(settings))
            result=subprocess.run([sys.executable,'stock_runway.py',str(path),'--settings',str(config),'--today','2027-01-01','--all','--show-orders-anyway',*(['--json'] if as_json else []),*extra],cwd=ROOT,text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            return json.loads(result.stdout)[0] if as_json else list(csv.DictReader(io.StringIO(result.stdout)))[0]

    def test_weekly_and_incoming_warn_without_replacing_suggestion(self):
        for settings,incoming in [({'profit_suggestion':True,'review_days':7},0),({'profit_suggestion':True},50),({'profit_suggestion':True,'review_days':29},0)]:
            with self.subTest(settings=settings,incoming=incoming):
                row=self.cli(settings,incoming)
                self.assertIn('profit_suggestion',row)
                self.assertEqual(row.get('profit_suggestion_warning'),WEEKLY)
                ordinary=self.cli({**settings,'profit_suggestion':False},incoming)
                self.assertEqual(row['order_qty'],ordinary['order_qty'])

    def test_off_and_monthly_without_incoming_do_not_warn(self):
        self.assertNotIn('profit_suggestion_warning',self.cli({'profit_suggestion':False,'review_days':7},50))
        self.assertNotIn('profit_suggestion_warning',self.cli({'profit_suggestion':True,'review_days':30}))

    def test_product_review_override_controls_warning(self):
        self.assertEqual(self.cli({'profit_suggestion':True,'review_days':30,'product_overrides':{'A':{'review_days':7}}}).get('profit_suggestion_warning'),WEEKLY)
        self.assertNotIn('profit_suggestion_warning',self.cli({'profit_suggestion':True,'review_days':7,'product_overrides':{'A':{'review_days':30}}}))

    def test_warning_is_exposed_in_csv(self):
        self.assertEqual(self.cli({'profit_suggestion':True,'review_days':7},as_json=False).get('profit_suggestion_warning'),WEEKLY)
        self.assertEqual(self.cli({'profit_suggestion':True},incoming=50,as_json=False).get('profit_suggestion_warning'),WEEKLY)
        self.assertNotIn('profit_suggestion_warning',self.cli({'profit_suggestion':True},as_json=False))
        self.assertNotIn('profit_suggestion_warning',self.cli({'profit_suggestion':False,'review_days':7},incoming=50,as_json=False))

    def test_effective_supplier_rhythm_controls_warning(self):
        for rhythm,expected in [(7,WEEKLY),(30,None)]:
            with self.subTest(rhythm=rhythm):
                settings={'profit_suggestion':True,'review_days':30,'supplier_overrides':{'Vendor':{'review_days':rhythm}}}
                self.assertEqual(self.cli(settings).get('profit_suggestion_warning'),expected)

    def test_helper_never_mutates_the_order_or_suggestion(self):
        helper=importlib.import_module('profit_warnings')
        guidance={'profit_suggestion':{'qty':101,'expected_profit':123.45},'quantity':80}
        before=json.dumps(guidance,sort_keys=True)
        self.assertEqual(helper.profit_suggestion_warning({'on_order':1},guidance,7),WEEKLY)
        self.assertEqual(json.dumps(guidance,sort_keys=True),before)
        self.assertEqual(helper.profit_suggestion_warning({},guidance,30),'')
        self.assertEqual(helper.profit_suggestion_warning({'on_order':50},{},7),'')


if __name__=='__main__': unittest.main()
