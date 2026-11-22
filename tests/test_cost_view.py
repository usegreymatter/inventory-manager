"""Display-only cost/profit contract; no quantity or engine mutations."""
import copy
import importlib.util
import json
from pathlib import Path
import random
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class CostViewTests(unittest.TestCase):
    def metrics(self, *args):
        return load('cost_view').cost_metrics(*args)

    def test_hand_worked_cost_margin_shortfall_expiry_and_cover(self):
        item = dict(on_hand=60, on_order=10, unit_cost=4, sale_price=10)
        guidance = dict(quantity=20, monthly_demand=30, expiry_at_risk_qty=3)
        before = copy.deepcopy((item, guidance))
        actual = self.metrics(item, guidance, dict(expected_shortfall_before=5))
        self.assertEqual(actual, dict(money_tied_up=240, incoming_value=40, order_value=80,
            margin_unit=6, margin_pct=60, lost_profit_est=30, expiry_value_at_risk=12,
            weekly_cost=28, money_cover_weeks=240/28, stock_margin=360, stock_sale_value=600))
        self.assertEqual((item, guidance), before)

    def test_incoming_value_accepts_existing_supply_ledger_quantity(self):
        self.assertEqual(self.metrics(dict(unit_cost=4,on_order=10),dict(incoming_qty=15)),dict(incoming_value=60))

    def test_absent_inputs_are_omitted_not_zero_or_guessed(self):
        self.assertEqual(self.metrics(dict(on_hand=8)), {})
        actual = self.metrics(dict(on_hand=8, unit_cost=2), dict(quantity=0, monthly_demand=0), dict(before=.5))
        self.assertEqual(actual, dict(money_tied_up=16, order_value=0, weekly_cost=0))
        for bad in [None, True, '4', -1, float('nan'), float('inf')]:
            self.assertEqual(self.metrics(dict(on_hand=8, unit_cost=bad)), {})

    def test_zero_prices_negative_margins_and_no_negative_lost_profit(self):
        actual = self.metrics(dict(on_hand=0, on_order=0, unit_cost=4, sale_price=0), {}, dict(expected_shortfall_before=5))
        self.assertEqual(actual, dict(money_tied_up=0, incoming_value=0, margin_unit=-4, lost_profit_est=0, stock_margin=0, stock_sale_value=0))
        self.assertEqual(self.metrics(dict(on_hand=5, unit_cost=0, sale_price=10))['margin_pct'], 100)

    def test_totals_are_weighted_and_missing_coverage_explicit(self):
        c = load('cost_view')
        rows = [self.metrics(dict(on_hand=60, unit_cost=4, sale_price=10), dict(monthly_demand=30)),
                self.metrics(dict(on_hand=10, unit_cost=2)), {}]
        actual = c.cost_totals(rows)
        self.assertEqual(actual['money_tied_up'], 260)
        self.assertEqual(actual['coverage']['money_tied_up'], 2)
        self.assertEqual(actual['coverage']['margin_unit'], 1)
        self.assertEqual(actual['count'], 3)
        self.assertNotIn('margin_unit', actual)
        self.assertNotIn('lost_profit_est', actual)
        self.assertEqual(actual['money_cover_weeks'], 240/28)
        self.assertEqual(c.cost_totals([]), dict(count=0, coverage={}))

    def test_python_js_parity_on_1200_seeded_random_items(self):
        rng = random.Random(239)
        fixtures = []
        for _ in range(1200):
            item = dict(on_hand=rng.random()*10000, on_order=rng.random()*1000, unit_cost=rng.random()*100,
                        sale_price=rng.random()*200)
            guidance = dict(quantity=rng.randint(0, 10000), monthly_demand=rng.random()*500,
                            expiry_at_risk_qty=rng.random()*10)
            risk = dict(expected_shortfall_before=rng.random()*100)
            for key in list(item):
                if rng.random() < .15: del item[key]
            fixtures.append([item, guidance, risk])
        expected = [self.metrics(*args) for args in fixtures]
        script = "const fs=require('fs'),vm=require('vm');vm.runInThisContext(fs.readFileSync('desktop/cost-view.js','utf8'));const f=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify([f.map(x=>StockRunwayCosts.costMetrics(...x)),StockRunwayCosts.costTotals(f.map(x=>StockRunwayCosts.costMetrics(...x)))]))"
        actual, total = json.loads(subprocess.check_output(['node', '-e', script], input=json.dumps(fixtures).encode(), cwd=ROOT))
        for a, b in zip(actual, expected):
            self.assertEqual(a.keys(), b.keys())
            for k in a: self.assertAlmostEqual(a[k], b[k], delta=max(1, abs(b[k]))*1e-12)
        expected_total = load('cost_view').cost_totals(expected)
        self.assertEqual(total.keys(), expected_total.keys())
        self.assertEqual(total['coverage'], expected_total['coverage'])
        for k in total.keys()-{'coverage'}: self.assertAlmostEqual(total[k], expected_total[k], delta=max(1,abs(expected_total[k]))*1e-12)

    def test_existing_risk_sampler_opt_in_shortfall_preserves_default(self):
        risk = load('risk')
        spec = dict(sku='EXAMPLE', as_of='2026-10', today='2026-11-01', history=[30]*12,
                    forecast=[30]*6, on_hand=5, lead_days=10, lead_multipliers=[1],
                    cover_months=1, quantity=20, order_by='2026-11-01')
        base = risk.simulate_risk(spec)
        opt = risk.simulate_risk(dict(spec, include_shortfall=True))
        self.assertNotIn('expected_shortfall_before', base)
        self.assertEqual(opt.pop('expected_shortfall_before'), 5)
        self.assertEqual(opt, base)

if __name__ == '__main__': unittest.main()
