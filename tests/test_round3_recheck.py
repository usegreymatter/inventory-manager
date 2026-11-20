"""Review rechecks: synthetic warnings/gating only; quantities stay frozen."""
import csv
import importlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('round3_recheck_pkg')
pkg.__path__ = [str(ROOT)]
sys.modules.setdefault('round3_recheck_pkg', pkg)
smart = importlib.import_module('round3_recheck_pkg.smart_import')
meaning = importlib.import_module('round3_recheck_pkg.input_meaning')
csv_import = importlib.import_module('round3_recheck_pkg.csv_import')
HEADER = ['sku', 'name', 'unit', 'on_hand', 'supplier_days', 'Warehouse', 'on_order', '2026-07', '2026-08', '2026-09']
TODAY = '2026-11-20'


def text(rows):
    out = io.StringIO()
    csv.writer(out, lineterminator='\n').writerows(rows)
    return out.getvalue()


def review(sheets, choices=None):
    report = smart.understand_workbook(sheets)
    return report, meaning.review_input_meaning(sheets, report, choices or {}, TODAY)


def notes(result, sku='A'):
    return next((r['warnings'] for r in result['affected'] if r['sku'] == sku), [])


class RoundThreeRecheckTests(unittest.TestCase):
    def interpret(self, rows, choices=None):
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch') as directory:
            path = Path(directory) / 'synthetic.csv'
            path.write_text(text(rows))
            return meaning.interpret_csv(path, csv_import.preflight_csv(text(rows)), choices or {}, TODAY)

    def test_a1_ledger_snapshot_joined_incoming_is_known(self):
        sheets = [dict(name='Stock', rows=[HEADER, ['A', 'Alpha', 'pcs', '100', '14', '', '', '30', '30', '30']]),
                  dict(name='Ledger', rows=[['sku', 'date', 'quantity', 'on_hand', 'on_order'], ['A', '2026-07-01', '30', '100', '50']])]
        report, result = review(sheets)
        self.assertEqual(dict(zip(report['canonical_rows'][0], report['canonical_rows'][1]))['on_order'], '50')
        self.assertNotIn('A', result['incoming_unknown'])
        self.assertNotIn(meaning.INCOMING_UNKNOWN, notes(result))
        self.assertEqual(report['review_report']['incoming_evidence']['A'], [True])

    def test_a2_csv_contributor_conflict_gates_and_is_per_product(self):
        rows = [HEADER, ['A', 'Alpha', 'pcs', '10', '14', '', '0', '3', '3', '3'], ['A', 'Alpha', 'pcs', '20', '180', '', '0', '3', '3', '3']]
        data = self.interpret(rows)
        result = data['input_meaning']
        self.assertTrue(result['requires_ack'])
        expected = 'CSV: conflicting supplier_days for A; first value kept; acknowledge before ordering.'
        self.assertIn(expected, result['reasons'])
        self.assertIn(expected, data['items'][0]['input_warnings'])
        self.assertEqual(data['items'][0]['on_hand'], 30)
        self.assertEqual(data['items'][0]['supplier_days'], 14)
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch') as directory:
            path = Path(directory) / 'conflict.csv'
            path.write_text(text(rows))
            cmd = [sys.executable, str(ROOT / 'stock_runway.py'), str(path), '--all', '--today', TODAY]
            blocked = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(blocked.returncode, 2, blocked.stderr)
            self.assertEqual(blocked.stdout, '')
            accepted = subprocess.run(cmd + ['--show-orders-anyway'], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)

    def test_o1_compatible_stock_sheets_require_ack_with_names_per_product(self):
        sheets = [dict(name='East', rows=[HEADER, ['A', 'Alpha', 'pcs', '10', '14', '', '0', '3', '3', '3']]),
                  dict(name='West', rows=[HEADER, ['A', 'Alpha', 'pcs', '20', '14', '', '0', '3', '3', '3']])]
        report, result = review(sheets)
        message = 'Stock from sheets East, West was added together. Confirm these are separate warehouses — not totals, copies or older snapshots.'
        self.assertTrue(result['requires_ack'])
        self.assertIn(message, result['reasons'])
        self.assertIn(message, notes(result))
        self.assertIn(message, report['input_warnings']['A'])
        self.assertEqual(report['input_warnings'], report['review_report']['input_warnings'])
        self.assertEqual(dict(zip(report['canonical_rows'][0], report['canonical_rows'][1]))['on_hand'], '30')

    def test_o2_exact_blank_location_duplicates_csv_require_ack(self):
        row = ['A', 'Alpha', 'pcs', '10', '14', '', '0', '3', '3', '3']
        data = self.interpret([HEADER, row, row])
        message = 'Identical rows found for SKU A — possible duplicate export'
        self.assertTrue(data['input_meaning']['requires_ack'])
        self.assertIn(message, data['input_meaning']['reasons'])
        self.assertIn(message, data['items'][0]['input_warnings'])
        self.assertEqual(data['items'][0]['on_hand'], 20)

    def test_o2_exact_blank_location_duplicates_workbook_require_ack(self):
        row = ['A', 'Alpha', 'pcs', '10', '14', '', '0', '3', '3', '3']
        report, result = review([dict(name='Stock', rows=[HEADER, row, row])])
        message = 'Identical rows found for SKU A — possible duplicate export'
        self.assertTrue(result['requires_ack'])
        self.assertIn(message, result['reasons'])
        self.assertIn(message, notes(result))
        self.assertEqual(report['review_report']['input_warnings']['A'], [message])
        self.assertEqual(dict(zip(report['canonical_rows'][0], report['canonical_rows'][1]))['on_hand'], '20')

    def test_o3_reserved_source_absence_survives_artificial_canonical_column(self):
        sheets = [dict(name='East', rows=[HEADER + ['reserved'], ['A', 'Alpha', 'pcs', '10', '14', '', '0', '3', '3', '3', '2']]),
                  dict(name='West', rows=[HEADER, ['A', 'Alpha', 'pcs', '20', '14', '', '0', '3', '3', '3']])]
        report, result = review(sheets, dict(stock_includes_reserved=True))
        message = 'Reserved stock missing in sheets West — available stock may be overstated; check allocations before ordering.'
        self.assertIn(message, notes(result))
        self.assertIn(message, result['warnings'])
        self.assertEqual(report['reserved_missing'], {'A': ['West']})
        self.assertEqual(report['reserved_missing'], report['review_report']['reserved_missing'])
        adjusted = smart.understand_workbook(result['sheets'])
        self.assertEqual(dict(zip(adjusted['canonical_rows'][0], adjusted['canonical_rows'][1]))['on_hand'], '28')

    def test_o3_blank_source_reserved_cells_name_sheet_in_csv(self):
        row = ['A', 'Alpha', 'pcs', '10', '14', '', '0', '3', '3', '3', '']
        data = self.interpret([HEADER + ['reserved'], row], dict(stock_includes_reserved=True))
        message = 'Reserved stock missing in sheets CSV — available stock may be overstated; check allocations before ordering.'
        self.assertIn(message, data['items'][0]['input_warnings'])
        self.assertFalse(data['input_meaning']['requires_ack'])
        self.assertEqual(data['items'][0]['on_hand'], 10)

    def test_empty_auxiliary_sheet_does_not_break_metadata_review(self):
        sheets = [dict(name='Stock', rows=[HEADER, ['A', 'Alpha', 'pcs', '10', '14', '', '0', '3', '3', '3']]),
                  dict(name='Empty', rows=[])]
        report, result = review(sheets)
        self.assertFalse(result['requires_ack'])
        self.assertEqual(report['input_warnings'], {})
        self.assertEqual(report['sheets'][1]['reserved_missing'], {})

    def test_partially_unknown_incoming_still_retains_known_quantity(self):
        sheets = [dict(name='East', rows=[HEADER, ['A', 'Alpha', 'pcs', '10', '14', '', '50', '3', '3', '3']]),
                  dict(name='West', rows=[HEADER, ['A', 'Alpha', 'pcs', '20', '14', '', '', '3', '3', '3']])]
        report, result = review(sheets)
        data = csv_import.preflight_csv(text(report['canonical_rows']))
        meaning.attach_input_meaning(data, result)
        self.assertEqual(data['items'][0]['on_order'], 50)
        self.assertTrue(data['items'][0]['incoming_unknown'])
        self.assertIn(meaning.INCOMING_PARTLY_UNKNOWN, data['items'][0]['input_warnings'])


if __name__ == '__main__':
    unittest.main()
