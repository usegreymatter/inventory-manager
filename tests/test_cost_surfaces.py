"""Cost presentation integration: normal output and protected maths are unchanged."""
import csv
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]

class CostSurfaceTests(unittest.TestCase):
    def test_cli_json_explain_fields_and_plain_csv_unchanged(self):
        source = ROOT / '.scratch/cost-cli.csv'
        source.parent.mkdir(exist_ok=True)
        source.write_text('sku,name,unit,on_hand,supplier_days,on_order,unit_cost,sale_price,2026-08,2026-09,2026-10\nA,Synthetic,ea,5,10,0,4,10,30,30,30\n')
        def run(*extra):
            return subprocess.check_output([sys.executable, 'stock_runway.py',str(source),'--today','2026-11-01','--all',*extra], cwd=ROOT, stderr=subprocess.PIPE, text=True)
        row = json.loads(run('--json','--costs'))[0]
        self.assertEqual(row['money_tied_up'],20)
        self.assertEqual(row['margin_unit'],6)
        self.assertEqual(row['margin_pct'],60)
        self.assertGreater(row['lost_profit_est'],0)
        self.assertNotIn('expiry_value_at_risk',row)
        explain = next(csv.DictReader(io.StringIO(run('--explain','--costs'))))
        self.assertEqual(explain['money_tied_up'],'20')
        self.assertIn('Lost profit estimate', explain['cost_explanation'])
        plain = next(csv.DictReader(io.StringIO(run())))
        self.assertNotIn('money_tied_up',plain)
        self.assertEqual(float(plain['order_qty']),row['order_qty'])

    def test_explanation_money_keeps_plain_decimal_precision(self):
        spec=importlib.util.spec_from_file_location('cost_cli_precision', ROOT/'stock_runway.py')
        cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
        engine,_=cli._load_modules()
        result=cli._cost_display(dict(on_hand=1234567,unit_cost=1),{},engine,{},'2026-11-01',{})
        self.assertIn('Money tied up: 1234567',result['cost_explanation'])
        self.assertNotIn('e+0',result['cost_explanation'])

    def test_ui_module_wired_outside_protected_core_and_money_columns(self):
        source=(ROOT/'desktop/plugin.js').read_text()
        self.assertNotIn("import './cost-view.js'",source)
        self.assertNotIn("import '../standalone/design/risk.js'",source)
        self.assertIn('// COST_DISPLAY_START', source)
        self.assertIn('data-cost-detail',source)
        self.assertIn('data-cost-totals',source)
        spec=importlib.util.spec_from_file_location('cost_build',ROOT/'standalone/build.py')
        build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
        html=build.build('option-gm-b')
        self.assertIn('function costMetrics(',html)
        self.assertIn('costRenderTotals',html)
        self.assertIn("['money_tied_up','Money tied up'",html)
        self.assertIn("['lost_profit_est','Lost profit estimate'",html)
        self.assertIn('costProductPanel',html)

if __name__=='__main__':unittest.main()
