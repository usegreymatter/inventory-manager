"""Integrated opt-in behavior and the owner-approved additive QuickBooks field."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class IntegrationTests(unittest.TestCase):
    def test_cli_recommended_shortcut(self):
        run = subprocess.run([sys.executable, str(ROOT/'stock_runway.py'), str(ROOT/'samples/synthetic/stock.csv'), '--method', 'recommended', '--all', '--json', '--today', '2026-11-01', '--show-orders-anyway'], text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertTrue(json.loads(run.stdout))

    def test_cost_display_follows_engine_package_for_embedded_callers(self):
        import types
        name = 'v12_embedded_cli'
        package = types.ModuleType(name)
        package.__path__ = [str(ROOT)]
        sys.modules[name] = package
        import importlib
        engine = importlib.import_module(name+'.engine')
        sources = importlib.import_module(name+'.sources')
        spec = importlib.util.spec_from_file_location('v12_cli_entry', ROOT/'stock_runway.py')
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        data = sources.load_csv(str(ROOT/'docs/erp-examples/quickbooks.csv'))
        from unittest.mock import patch
        data['items'][0].update(unit_cost=4, sale_price=9.99)
        with patch('importlib.import_module', wraps=importlib.import_module) as lookup:
            rows = cli._export_rows(data, engine, '2026-04-01', {'show_costs':True}, True, True)
        lookup.assert_any_call(name+'.cost_view')
        self.assertAlmostEqual(rows[0]['margin_unit'], 9.99-4)
        # The same pure exporter also supports callers importing engine top-level.
        top = importlib.import_module('engine')
        rows = cli._export_rows(data, top, '2026-04-01', {'show_costs':True}, True, True)
        self.assertAlmostEqual(rows[0]['margin_unit'], 9.99-4)

    def test_real_expiry_risk_flows_to_cli_costs(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)/'stock.csv'
            p.write_text('sku,name,unit,on_hand,supplier_days,unit_cost,sale_price,2026-08,2026-09,2026-10,Lot,Expiry date\nS,Synthetic,units,500,0,4,9.99,30,30,30,A,2026-11-03\n')
            run = subprocess.run([sys.executable, str(ROOT/'stock_runway.py'), str(p), '--costs', '--all', '--json', '--today', '2026-11-01', '--show-orders-anyway'], text=True, capture_output=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            row = json.loads(run.stdout)[0]
            self.assertGreater(row['expiry_at_risk_qty'], 0)
            self.assertEqual(row['expiry_value_at_risk'], row['expiry_at_risk_qty']*4)

if __name__ == '__main__':
    unittest.main()
