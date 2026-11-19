"""Advisory stockout detection: stdlib-only regression and CLI boundary proof."""
import calendar
import copy
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine

ASOF = '2026-10-31'
TODAY = '2026-11-17'


def item(sales) -> dict[str, Any]:
    return dict(sku='ADVISORY', name='Fictional stockout example', unit='units',
                on_hand=50, supplier_days=14, monthly_sales=list(sales), receipts={})


def calculate(raw, settings=None):
    months = [engine.month_after('2026-10', i-len(raw['monthly_sales'])+1)
              for i in range(len(raw['monthly_sales']))]
    physical = engine.forecast(raw, months, ASOF, settings=settings, today=TODAY)
    return engine.order_guidance({**raw, **physical, 'as_of': ASOF}, TODAY, settings)


class StockoutAdvisoryTests(unittest.TestCase):
    def test_likely_is_interior_isolated_dip_and_input_is_unchanged(self):
        raw = item([90, 100, 110, 0, 100])
        saved = copy.deepcopy(raw)
        result = engine.detect_stockout_months(raw, '2026-10')
        self.assertEqual(result, dict(months=['2026-06','2026-07','2026-08','2026-09','2026-10'],
            flagged=[dict(month='2026-09', index=3, confidence='likely', adjusted_demand=100)],
            adjusted_sales=[90,100,110,100,100]))
        self.assertEqual(raw, saved)

    def test_known_exposure_and_stockout_days_without_baseline_stay_flagged(self):
        raw = item([0, 20, 30, 0, 40])
        raw['planning_facts'] = dict(sales_history=[
            dict(month='2026-06', in_stock_days=0, backorder=False),
            dict(month='2026-07', stockout_days=2),
            dict(month='2026-08', in_stock_days=1, backorder=True)])
        raw['stock_history'] = {'2026-09': {'stockout_days': 4}}
        result = engine.detect_stockout_months(raw, '2026-10')
        self.assertEqual([f['index'] for f in result['flagged']], [0,1,3])
        self.assertEqual([f['confidence'] for f in result['flagged']], ['known']*3)
        self.assertEqual([f['adjusted_demand'] for f in result['flagged']], [None]*3)
        self.assertEqual(result['adjusted_sales'], raw['monthly_sales'])

    def test_explicit_stockout_days_wins_over_backorder_and_high_stock(self):
        raw = item([100,100,100,10,100])
        raw['stock_history'] = [dict(month='2026-09', stockout_days=1, on_hand=90)]
        self.assertEqual(engine.detect_stockout_months(raw,'2026-10')['flagged'][0]['confidence'], 'known')

    def test_historical_stock_above_one_blocks_likely_but_current_stock_does_not(self):
        raw = item([100,100,100,0,100])
        raw['stock_history'] = {'2026-09': {'month_end_stock': 2}}
        self.assertEqual(engine.detect_stockout_months(raw,'2026-10')['flagged'], [])
        raw['stock_history']['2026-09']['month_end_stock'] = 1
        self.assertEqual(len(engine.detect_stockout_months(raw,'2026-10')['flagged']), 1)
        raw['stock_history']['2026-09']['on_hand'] = 2
        self.assertEqual(engine.detect_stockout_months(raw,'2026-10')['flagged'], [])

    def test_likely_threshold_is_strict_and_neighbour_threshold_inclusive(self):
        self.assertEqual(engine.detect_stockout_months(item([100,100,100,20,100]),'2026-10')['flagged'], [])
        result = engine.detect_stockout_months(item([100,100,100,19,50]),'2026-10')
        self.assertEqual(result['flagged'][0]['index'], 3)
        self.assertEqual(engine.detect_stockout_months(item([100,100,100,0,49]),'2026-10')['flagged'], [])

    def test_no_likely_for_edges_consecutive_zeros_or_sparse_positives(self):
        for sales in ([0,100,100,100], [100,100,100,0], [100,100,100,0,0,100],
                      [0,0,100,0,100], [0,0,0,0,0]):
            with self.subTest(sales=sales):
                self.assertEqual(engine.detect_stockout_months(item(sales),'2026-10')['flagged'], [])

    def test_replacement_excludes_all_prior_flags_and_uses_last_six_nonflagged(self):
        raw = item([10,20,30,0,40,50,60,70,80,0,90])
        months = [engine.month_after('2026-10',i-10) for i in range(11)]
        raw['stock_history'] = {months[i]: {'stockout_days': 1} for i in (3,9)}
        result = engine.detect_stockout_months(raw,'2026-10')
        self.assertEqual([f['adjusted_demand'] for f in result['flagged']], [20,55])

    def test_invalid_or_missing_history_returns_empty_safe_contract(self):
        for raw, last in (({},'2026-10'),(item([1,None,3]),'2026-10'),
                          (item([1,2,3]),'bad'),(item([True,2,3]),'2026-10')):
            with self.subTest(raw=raw,last=last):
                self.assertEqual(engine.detect_stockout_months(raw,last),
                                 dict(months=[], flagged=[], adjusted_sales=[]))

    def test_opt_in_recomputes_same_pipeline_and_default_is_unchanged(self):
        raw = item([100,100,100,0,100])
        saved = copy.deepcopy(raw)
        before = calculate(raw)
        self.assertEqual(before, calculate(raw, {'stockout_adjust': False}))
        adjusted = calculate(raw, {'stockout_adjust': True})
        expected = calculate(item([100,100,100,100,100]), {'stockout_adjust': False})
        self.assertEqual(adjusted, expected)
        self.assertNotEqual(before['quantity'], adjusted['quantity'])
        self.assertEqual(raw, saved)

    def test_opt_in_no_flag_is_whole_output_identity(self):
        raw = item([100,100,100,100,100])
        self.assertEqual(calculate(raw), calculate(raw, {'stockout_adjust': True}))

    def test_opt_in_never_repairs_malformed_exposure_or_bypasses_existing_hold(self):
        raw = item([100,100,100,0,100])
        raw['stock_history'] = {'2026-09': {'stockout_days':1}}
        raw['planning_facts'] = dict(version='1.0',sales_history=[dict(month='2026-09',in_stock_days='bad')])
        self.assertEqual(calculate(raw), calculate(raw, {'stockout_adjust':True}))
        raw.pop('planning_facts')
        for held in ([], {}, True):
            direct = {**raw,'as_of':ASOF,'monthly_demand':10,'held':held}
            self.assertEqual(engine.order_guidance(direct,TODAY),
                             engine.order_guidance(direct,TODAY,{'stockout_adjust':True}))

    def test_default_exposure_path_survives_and_opt_in_does_not_double_correct(self):
        raw = item([100,100,100,10,100])
        months = [engine.month_after('2026-10',i-4) for i in range(5)]
        raw['planning_facts'] = dict(version='1.0', sales_history=[
            dict(sku=raw['sku'],month=m,quantity=q,
                 in_stock_days=(3 if i==3 else calendar.monthrange(*map(int,m.split('-')))[1]),backorder=False)
            for i,(m,q) in enumerate(zip(months, raw['monthly_sales']))])
        saved = copy.deepcopy(raw)
        before = calculate(raw)
        self.assertEqual(before['demand_history']['corrected'], [100,100,100,40,100])
        after = calculate(raw, {'stockout_adjust': True})
        self.assertEqual(after['demand_history']['corrected'], [100]*5)
        self.assertFalse(after['purchase_hold'])
        self.assertEqual(raw, saved)

    def test_strict_settings_accept_only_boolean_opt_in(self):
        self.assertIs(engine.validate_order_settings({'stockout_adjust':True})['stockout_adjust'], True)
        self.assertIs(engine.normalize_order_settings({'stockout_adjust':'yes'})['stockout_adjust'], False)
        with self.assertRaises(ValueError):
            engine.validate_order_settings({'stockout_adjust':1})

    def test_known_replacement_equal_to_raw_still_prevents_second_exposure_uplift(self):
        raw = item([100]*5)
        months = [engine.month_after('2026-10',i-4) for i in range(5)]
        raw['planning_facts'] = dict(version='1.0',sales_history=[
            dict(sku=raw['sku'],month=m,quantity=100,
                 in_stock_days=3 if i==3 else calendar.monthrange(*map(int,m.split('-')))[1],backorder=False)
            for i,m in enumerate(months)])
        self.assertEqual(calculate(raw)['demand_history']['corrected'], [100,100,100,400,100])
        self.assertEqual(calculate(raw,{'stockout_adjust':True})['demand_history']['corrected'], [100]*5)

    def test_cli_flag_exercises_actual_export(self):
        scratch = ROOT / '.scratch'
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as folder:
            path = Path(folder) / 'stock.csv'
            path.write_text('sku,name,unit,on_hand,supplier_days,2026-06,2026-07,2026-08,2026-09,2026-10\nADVISORY,Fictional stockout example,units,50,14,100,100,100,0,100\n')
            command = [sys.executable, str(ROOT/'stock_runway.py'), str(path), '--all','--today',TODAY]
            plain = subprocess.run(command,text=True,capture_output=True)
            opted = subprocess.run(command+['--stockout-adjust'],text=True,capture_output=True)
            self.assertEqual(plain.returncode,0,plain.stderr)
            self.assertEqual(opted.returncode,0,opted.stderr)
            a, = list(csv.DictReader(io.StringIO(plain.stdout)))
            b, = list(csv.DictReader(io.StringIO(opted.stdout)))
            self.assertNotEqual(a['order_qty'], b['order_qty'])
            self.assertEqual(float(b['order_qty']), calculate(item([100]*5))['quantity'])

    def test_report_is_reproducible_and_before_after_is_real_guidance(self):
        import stockout_report
        data = dict(as_of=ASOF, months=['2026-06','2026-07','2026-08','2026-09','2026-10'],
                    items=[item([100,100,100,0,100]), {**item([100]*5),'sku':'CONTROL'}])
        saved = copy.deepcopy(data)
        report = stockout_report.build_report(data, TODAY)
        self.assertEqual(report['items_scanned'], 2)
        self.assertEqual(report['items_flagged'], 1)
        self.assertEqual(report['known_months'], 0)
        self.assertEqual(report['likely_months'], 1)
        self.assertEqual(report['items_with_changed_guidance'], 1)
        row, = report['items']
        self.assertEqual(row['before']['quantity'], calculate(data['items'][0])['quantity'])
        self.assertEqual(row['after']['quantity'], calculate(item([100]*5))['quantity'])
        self.assertEqual(report, stockout_report.build_report(data, TODAY))
        self.assertEqual(data, saved)


if __name__ == '__main__':
    unittest.main()
