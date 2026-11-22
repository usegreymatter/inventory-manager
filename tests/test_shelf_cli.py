import json
import subprocess
import sys
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class ShelfCliTests(unittest.TestCase):
    def test_flags_and_json_fields(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'stock.csv'
            source.write_text('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nS,Synthetic,units,0,0,300,300,300\n')
            run=subprocess.run([sys.executable,str(ROOT/'stock_runway.py'),str(source),
                '--shelf-life-days','10','--arrival-age-days','2','--min-remaining-life-days','1',
                '--today','2026-10-31','--show-orders-anyway','--json','--all'],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr)
        rows=json.loads(run.stdout)
        self.assertTrue(rows)
        self.assertTrue(any('shelf_cap_qty' in r for r in rows))
        self.assertTrue(all(r.get('order_qty') is None or r['order_qty']<=r.get('shelf_cap_qty',float('inf')) for r in rows))
    def test_ambiguous_expiry_requires_and_honors_review_ack(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'stock.csv'
            source.write_text('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10,Lot,Expiry date\nS,Synthetic,units,10,0,300,300,300,A,03/04/2027\n')
            cmd=[sys.executable,str(ROOT/'stock_runway.py'),str(source),'--today','2026-11-01','--json','--all']
            run=subprocess.run(cmd,capture_output=True,text=True)
            self.assertEqual(run.returncode,2,run.stderr)
            self.assertIn('ambiguous expiry',run.stderr)
            run=subprocess.run(cmd+['--show-orders-anyway'],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            rows=json.loads(run.stdout)
            self.assertEqual(rows[0]['expiring'][0]['expiry'],'2027-03-04')
            self.assertIsNotNone(rows[0]['order_qty'])

    def test_invalid_life(self):
        for value in ['0','-1','1.5','true']:
            run=subprocess.run([sys.executable,str(ROOT/'stock_runway.py'),str(ROOT/'data/sample.csv'),
               '--shelf-life-days',value],capture_output=True,text=True)
            self.assertEqual(run.returncode,2)
