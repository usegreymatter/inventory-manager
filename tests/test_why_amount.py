"""Additive explanation contract; standard-library runner, synthetic inputs only."""
import copy
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine


class WhyAmountTests(unittest.TestCase):
    def item(self, **patch):
        return dict(sku='A', name='Synthetic', unit='ea', on_hand=0, supplier_days=14,
                    monthly_sales=[3,3,3], monthly_demand=3, seasonal=False, receipts={},
                    as_of='2026-10-31', **patch)

    def test_minimum_and_pack_are_explicit_and_pure(self):
        item = self.item()
        settings = {'product_overrides':{'A':{'minimum_order':100, 'pack_size':12}}}
        saved = copy.deepcopy((item, settings))
        text = engine.why_this_amount(item, '2026-11-01', settings)
        self.assertIn('[MOQ uplift]', text)
        self.assertIn('[pack rounding]', text)
        self.assertTrue(text.startswith('Suggested order: 108 ea = '), text)
        self.assertEqual((item, settings), saved)
        self.assertEqual(text, engine.why_this_amount(item, '2026-11-01', settings, '2026-10-31'))

    def test_hold_not_zero_and_zero_not_hold(self):
        item = self.item()
        item['held'] = True
        self.assertTrue(engine.why_this_amount(item, '2026-11-01').startswith('Purchase advice held:'))
        item = self.item()
        item.update(monthly_demand=0, monthly_sales=[0,0,0])
        text = engine.why_this_amount(item, '2026-11-01')
        self.assertIn('Suggested order: 0 ea = ', text)
        self.assertIn('No forecast demand', text)
        self.assertNotIn('held', text)

    def test_cli_json_and_explain_only_add_field_default_bytes_unchanged(self):
        scratch = ROOT / '.scratch'
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            stock = Path(directory) / 'synthetic.csv'
            stock.write_text('sku,name,unit,on_hand,supplier_days,on_order,2026-08,2026-09,2026-10\nA,Synthetic,ea,0,14,0,3,3,3\n')
            def run(*flags):
                result = subprocess.run([sys.executable, str(ROOT/'stock_runway.py'), str(stock),
                                         '--today','2026-11-01','--all',*flags], capture_output=True, text=True, cwd=ROOT)
                self.assertEqual(result.returncode,0,result.stderr)
                return result
            default = run()
            base = list(csv.DictReader(io.StringIO(default.stdout)))
            explained = run('--explain')
            rows = list(csv.DictReader(io.StringIO(explained.stdout)))
            self.assertIn('why_this_amount',rows[0])
            self.assertTrue(rows[0]['why_this_amount'].startswith('Suggested order:'))
            self.assertEqual([{k:v for k,v in row.items() if k != 'why_this_amount'} for row in rows],base)
            # Byte comparison catches CSV formatting/header/summary changes, not just semantic changes.
            stripped = io.StringIO(newline='')
            writer = csv.DictWriter(stripped,fieldnames=list(base[0]),lineterminator='\r\n')
            writer.writeheader();writer.writerows(base)
            self.assertEqual(default.stdout.replace('\r\n','\n'),stripped.getvalue().replace('\r\n','\n'))
            self.assertEqual(default.stderr,explained.stderr)
            self.assertEqual(run().stdout,default.stdout)
            js = run('--json')
            data = json.loads(js.stdout)
            self.assertEqual(data[0]['why_this_amount'],rows[0]['why_this_amount'])
            self.assertEqual(set(data[0]),set(base[0])|{'why_this_amount','input_warnings','why_breakdown'})
            output = Path(directory)/'orders.json'
            saved = run('--json','-o',str(output))
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')),data)
            self.assertIn('1 items exported', saved.stdout)
            self.assertEqual(json.loads(run('--json','--explain').stdout),data)


if __name__ == '__main__':
    unittest.main()
