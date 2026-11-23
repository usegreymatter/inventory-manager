"""Offline CLI review regressions; real subprocess bytes and frozen v1.1 archive."""
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PYTHON = '/usr/bin/python3'
TODAY = '2026-11-01'


class V12CliReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scratch = ROOT / '.scratch'
        scratch.mkdir(exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix='v12-cli-review-', dir=scratch)
        cls.folder = Path(cls.temporary.name)
        cls.frozen = cls.folder / 'v1.1-freeze'
        cls.frozen.mkdir()
        # Exact CLI dependency bytes from v1.1-freeze @ c3109d5. Keep the
        # comparisons active in source archives with no Git ancestry or tags.
        archive = ROOT / 'tests/fixtures/baselines/v1.1-freeze-cli.tar.gz'
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != '4802d55bb7b854a3e80db2292f8963276afbd76c75db5766e65efc189d01b7bf':
            raise AssertionError('Immutable v1.1 CLI fixture changed')
        with tarfile.open(archive) as handle:
            handle.extractall(cls.frozen)  # SHA-pinned local source, never user input.
        cls.stock = cls.folder / 'unit-cost-only.csv'
        months = [f'2025-{n:02}' for n in range(11, 13)] + [f'2026-{n:02}' for n in range(1, 11)]
        with cls.stock.open('w', newline='') as handle:
            writer = csv.writer(handle)
            writer.writerow(['sku', 'name', 'unit', 'on_hand', 'on_order', 'supplier_days', 'unit_cost', *months])
            writer.writerow(['A', 'Synthetic A', 'ea', 5, 0, 10, 4, *([30] * 12)])
            writer.writerow(['B', 'Synthetic B', 'ea', 500, 10, 14, 2, *([10] * 12)])
        cls.priced = cls.folder / 'priced.csv'
        cls.priced.write_text(cls.stock.read_text().replace('unit_cost,', 'unit_cost,sale_price,')
                              .replace(',10,4,', ',10,4,10,').replace(',14,2,', ',14,2,5,'))

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def run_cli(self, *args, stock=None, frozen=False):
        result = subprocess.run([PYTHON, str((self.frozen if frozen else ROOT) / 'stock_runway.py'),
                                 str(stock or self.stock), '--today', TODAY, '--all', *map(str, args)],
                                cwd=ROOT, capture_output=True, timeout=60)
        self.assertNotIn(b'Traceback', result.stderr)
        return result

    def successful(self, *args, **kwargs):
        result = self.run_cli(*args, **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return result

    def settings(self, value, name='settings.json'):
        path = self.folder / name
        path.write_text(json.dumps(value))
        return path

    def test_default_outputs_match_freeze_bytes_including_unit_cost_and_existing_examples(self):
        examples = sorted((ROOT / 'docs/erp-examples').glob('*.csv'))
        self.assertEqual(len(examples), 8)
        for source in [self.stock, *examples]:
            for flags in [(), ('--json',), ('--explain',)]:
                with self.subTest(source=source.name, flags=flags):
                    before = self.successful(*flags, stock=source, frozen=True)
                    after = self.successful(*flags, stock=source)
                    # Exact v1.2.2 note only; all remaining bytes stay frozen.
                    note = 'Orders already on the way were not included — subtract them before ordering.'
                    if '--json' in flags:
                        rows = json.loads(after.stdout)
                        for row in rows:
                            if 'order_notes' in row:
                                self.assertIsNone(row['on_order'])
                                self.assertEqual(row.pop('order_notes'), note)
                        reviewed = (json.dumps(rows, ensure_ascii=False, allow_nan=False, indent=2)+'\n').encode()
                    else:
                        for row in csv.DictReader(io.StringIO(after.stdout.decode())):
                            if note in row['reason']:
                                self.assertEqual(row['on_order'], '')
                                self.assertEqual(row['reason'].count(note), 1)
                        reviewed = after.stdout.replace((' '+note).encode(), b'').replace(note.encode(), b'')
                    self.assertEqual(reviewed, before.stdout)
                    self.assertEqual(after.stderr, before.stderr)

    def test_default_output_files_and_summary_match_freeze_bytes(self):
        target = self.folder / 'orders.out'
        for flags in [(), ('--json',), ('--explain',)]:
            with self.subTest(flags=flags):
                before = self.successful(*flags, '-o', target, frozen=True)
                old_bytes = target.read_bytes()
                after = self.successful(*flags, '-o', target)
                self.assertEqual(target.read_bytes(), old_bytes)
                self.assertEqual(after.stdout, before.stdout)
                self.assertEqual(after.stderr, before.stderr)

    def test_costs_flag_enables_fields_in_all_output_modes_without_quantity_changes(self):
        baseline = json.loads(self.successful('--json', stock=self.priced).stdout)
        for flags in [(), ('--json',), ('--explain',)]:
            with self.subTest(flags=flags):
                result = self.successful('--costs', *flags, stock=self.priced)
                if '--json' in flags:
                    rows = json.loads(result.stdout)
                else:
                    rows = list(csv.DictReader(io.StringIO(result.stdout.decode())))
                self.assertEqual(float(rows[0]['money_tied_up']), 20)
                self.assertEqual(float(rows[0]['margin_unit']), 6)
                self.assertIn('Money tied up: 20', rows[0]['cost_explanation'])
                self.assertEqual([float(r['order_qty']) for r in rows], [r['order_qty'] for r in baseline])
                self.assertIn(b'Cost totals (exported products; known inputs only):', result.stderr)

    def test_cost_setting_is_explicit_boolean_and_flag_overrides_false(self):
        for enabled in (False, True):
            settings = self.settings({'show_costs': enabled})
            result = self.successful('--json', '--settings', settings, stock=self.priced)
            self.assertEqual('money_tied_up' in json.loads(result.stdout)[0], enabled)
            self.assertEqual(b'Cost totals' in result.stderr, enabled)
        result = self.successful('--json', '--settings', self.settings({'show_costs': False}), '--costs')
        self.assertIn('money_tied_up', json.loads(result.stdout)[0])
        for invalid in (None, 'true', 1, [], {}):
            with self.subTest(invalid=invalid):
                result = self.run_cli('--settings', self.settings({'show_costs': invalid}))
                self.assertEqual(result.returncode, 2)
                self.assertIn(b'show_costs', result.stderr)
                self.assertFalse(result.stdout)

    def test_cost_only_missing_inputs_and_output_file_totals(self):
        row = json.loads(self.successful('--json', '--costs').stdout)[0]
        self.assertEqual(row['money_tied_up'], 20)
        self.assertNotIn('margin_unit', row)
        source = self.folder / 'no-cost.csv'
        source.write_text(self.stock.read_text().replace('unit_cost,', '').replace(',10,4,', ',10,').replace(',14,2,', ',14,'))
        result = self.successful('--costs', '--json', stock=source)
        self.assertNotIn('money_tied_up', json.loads(result.stdout)[0])
        self.assertNotIn(b'Cost totals', result.stderr)
        target = self.folder / 'cost-orders.csv'
        result = self.successful('--costs', '-o', target)
        self.assertIn(b'Cost totals', result.stderr)
        self.assertNotIn(b'Cost totals', result.stdout)
        self.assertIn('money_tied_up', target.read_text(encoding='utf-8-sig'))

    def test_recommended_json_and_explain_show_selected_method_and_reason(self):
        result = self.successful('--method', 'recommended', '--json')
        for row in json.loads(result.stdout):
            info = row['forecast_method']
            self.assertEqual(info['requested'], 'recommended')
            self.assertTrue(info['method'])
            self.assertTrue(info['reason'])
            self.assertIn(info['reason'], row['why_this_amount'])
            self.assertIn('Method picked:', row['why_this_amount'])
        csv_result = self.successful('--method', 'recommended', '--explain')
        for row in csv.DictReader(io.StringIO(csv_result.stdout.decode())):
            info = json.loads(row['forecast_method'])
            self.assertIn(info['reason'], row['why_this_amount'])
        # Settings JSON has the same adapter, not just the explicit CLI flag.
        saved = self.settings({'forecast_method': 'recommended'})
        self.assertEqual(result.stdout, self.successful('--settings', saved, '--json').stdout)

    def test_previous_methods_reach_selector_per_sku_in_both_adjustment_modes(self):
        previous = self.settings({'A': 'ses', 'B': 'sba'}, 'previous.json')
        original = previous.read_bytes()
        for flags in [(), ('--stockout-adjust',)]:
            result = self.successful('--method', 'recommended', '--json', '--previous-methods', previous, *flags)
            rows = json.loads(result.stdout)
            self.assertEqual([r['forecast_method']['method'] for r in rows], ['ses', 'sba'])
            for row in rows:
                self.assertIn('keeping previous choice', row['forecast_method']['reason'])
            self.assertEqual(previous.read_bytes(), original)
        # No hidden persistence between invocations; absent-file picks remain Current.
        rows = json.loads(self.successful('--method', 'recommended', '--json').stdout)
        self.assertEqual([r['forecast_method']['method'] for r in rows], ['current', 'current'])

    def test_previous_methods_partial_mapping_leaves_missing_sku_stateless(self):
        previous = self.settings({'A': 'ses', 'not-in-this-file': 'sba'}, 'partial.json')
        result = self.successful('--method', 'recommended', '--json', '--previous-methods', previous)
        rows = json.loads(result.stdout)
        self.assertEqual([r['forecast_method']['method'] for r in rows], ['ses', 'current'])
        # Does not activate Recommended mode implicitly.
        self.assertEqual(self.successful('--json').stdout,
                         self.successful('--json', '--previous-methods', previous).stdout)

    def test_bad_previous_methods_fail_before_output_is_touched(self):
        target = self.folder / 'unchanged.csv'
        for bad in ([], {'A': 'auto'}, {'A': 'recommended'}, {'A': None}, {'A': True},
                    {'': 'ses'}, {'A': {'method': 'ses'}}, '{broken'):
            with self.subTest(bad=bad):
                prior = self.folder / 'bad-previous.json'
                prior.write_text(bad if isinstance(bad, str) else json.dumps(bad))
                target.write_text('sentinel')
                result = self.run_cli('--method', 'recommended', '--previous-methods', prior, '-o', target)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(result.stdout)
                self.assertIn(b'error:', result.stderr)
                self.assertEqual(target.read_text(), 'sentinel')
        prior.write_bytes(b' ' * (2 * 1024 * 1024 + 1))
        result = self.run_cli('--previous-methods', prior)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'2 MiB', result.stderr)

    def test_previous_methods_cannot_be_overwritten_by_output(self):
        previous = self.settings({'A': 'ses'}, 'protected.json')
        original = previous.read_bytes()
        alias = self.folder / 'previous-alias.json'
        alias.symlink_to(previous)
        for target in (previous, alias):
            result = self.run_cli('--previous-methods', previous, '-o', target)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(previous.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
