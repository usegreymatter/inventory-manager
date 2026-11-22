"""Synthetic product opt-outs, parser parity and separate profit-estimate inputs."""
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('preset_shelf_package')
pkg.__path__ = [str(ROOT)]
sys.modules.setdefault('preset_shelf_package', pkg)
from preset_shelf_package import engine, csv_import, profit_order


def item(**extra):
    return dict(sku='CAN', name='Synthetic cans', unit='units', on_hand=0,
                supplier_days=14, monthly_sales=[300] * 3, monthly_demand=300,
                seasonal=False, receipts={}, as_of='2026-10-31', **extra)


class ProductNoShelfTests(unittest.TestCase):
    def test_explicit_values_round_trip_and_never_inherit_global(self):
        base = engine.order_guidance(item(), '2026-10-31', {})
        for value in (None, 0, 'none'):
            raw = dict(shelf_life_days=14, product_overrides={'CAN': {'shelf_life_days': value}})
            s = engine.validate_order_settings(raw)
            self.assertEqual(s['product_overrides']['CAN']['shelf_life_days'], value)
            g = engine.order_guidance(item(), '2026-10-31', s)
            self.assertEqual(g['quantity'], base['quantity'])
            self.assertNotIn('shelf_cap_qty', g)
            self.assertEqual(engine.validate_order_settings(json.loads(json.dumps(s))), s)

    def test_global_and_malformed_product_values_remain_strict(self):
        for value in (0, 'none', None, True):
            with self.assertRaises(ValueError):
                engine.validate_order_settings(dict(shelf_life_days=value))
        for value in (False, True, 'null', '0', -1, 1.5, [], {}):
            with self.assertRaises(ValueError):
                engine.validate_order_settings(dict(product_overrides={'CAN': {'shelf_life_days': value}}))

    def test_csv_optout_import_parity_and_blank_inheritance(self):
        for value in ('none', 'null', '0', ''):
            text = 'sku,name,unit,on_hand,supplier_days,shelf_life_days,2026-08,2026-09,2026-10\nCAN,Cans,units,0,14,' + value + ',300,300,300\n'
            data = csv_import.preflight_csv(text)
            raw = data['items'][0]
            self.assertEqual('shelf_life_days' in raw, value != '')
            if value:
                self.assertIsNone(raw['shelf_life_days'])
                self.assertEqual(engine.resolve_order_settings(raw, {'shelf_life_days': 14})['sources']['shelf_life_days'], 'from file')
            code = "const fs=require('fs'),vm=require('vm');const s=fs.readFileSync('desktop/plugin.js','utf8');const c=vm.createContext({console,TextEncoder,TextDecoder,Date,Intl});vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replaceAll(/export /g,'')+';this.parse=parseCsv',c);console.log(JSON.stringify(c.parse(" + json.dumps(text) + ")))"
            run = subprocess.run(['node', '-e', code], cwd=ROOT, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(run.stdout), data)

    def test_cli_settings_accept_explicit_product_optouts(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            stock = path / 'synthetic.csv'
            stock.write_text('sku,name,unit,on_hand,supplier_days,on_order,2026-08,2026-09,2026-10\nCAN,Cans,units,0,14,0,300,300,300\nMILK,Milk,units,0,14,0,300,300,300\n')
            for value in (None, 0, 'none'):
                settings = path / 'settings.json'
                settings.write_text(json.dumps(dict(shelf_life_days=14,
                    product_overrides={'CAN': dict(shelf_life_days=value)})))
                run = subprocess.run([sys.executable, str(ROOT / 'stock_runway.py'), str(stock),
                    '--settings', str(settings), '--today', '2026-11-01', '--all', '--json'],
                    cwd=ROOT, capture_output=True, text=True)
                self.assertEqual(run.returncode, 0, run.stderr)
                rows = {row['sku']: row for row in json.loads(run.stdout)}
                self.assertGreater(rows['CAN']['order_qty'], rows['MILK']['order_qty'])
                self.assertNotIn('shelf_cap_qty', rows['CAN'])
                self.assertTrue(rows['MILK']['capped'])

    def test_profit_wrapper_does_not_reintroduce_disabled_global_life(self):
        for value in (None, 0, 'none'):
            for raw in (item(shelf_life_days=value), item()):
                settings = engine.normalize_order_settings(dict(profit_suggestion=True, shelf_life_days=14,
                    product_overrides={'CAN': dict(shelf_life_days=value, unit_cost=10, sale_price=20)}))
                resolved = engine.resolve_order_settings(raw, settings)
                specs = []
                profit_order.for_guidance(raw, dict(quantity=100, status='order', lead_days=14), settings, resolved,
                    evaluate=lambda spec: specs.append(spec))
                self.assertEqual(len(specs), 1)
                self.assertNotIn('shelf_life_days', specs[0])
