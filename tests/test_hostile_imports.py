"""Hostile import regressions, stdlib unittest only; all fixtures synthetic/local."""
import csv
import importlib
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType('stock_runway')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', package)
core = importlib.import_module('stock_runway.csv_import')


class HostileCsvRegressions(unittest.TestCase):
    def test_preflight_restores_process_field_limit_after_success_and_failure(self):
        previous = csv.field_size_limit()
        try:
            csv.field_size_limit(12345)
            for text in ('"unfinished', 'sku,name,unit,on_hand,supplier_days,2026-01\nA,W,pcs,1,2,3\n'):
                try:
                    core.preflight_csv(text)
                except ValueError:
                    pass
                self.assertEqual(csv.field_size_limit(), 12345)
        finally:
            csv.field_size_limit(previous)

    def test_malformed_markup_fails_without_quadratic_rescanning(self):
        import signal
        smart = importlib.import_module('stock_runway.smart_import')
        def timeout(signum, frame):
            raise TimeoutError('Malformed XML exceeded 2-second watchdog')
        previous = signal.signal(signal.SIGALRM, timeout)
        try:
            signal.setitimer(signal.ITIMER_REAL, 2)
            with self.assertRaises(ValueError):
                smart._xml(b'<' * 100000)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)

    def test_zero_format_cannot_amplify_cell_text_without_a_budget(self):
        smart = importlib.import_module('stock_runway.smart_import')
        with mock.patch.object(sys, 'path', [str(ROOT / 'scripts'), *sys.path]):
            helper = importlib.import_module('stress_hostile_imports')
        workbook = helper.workbook
        fmt = '0' * 1000
        styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="' + fmt + '"/></numFmts><cellXfs><xf numFmtId="164"/></cellXfs></styleSheet>'
        sheet = '<worksheet><row>' + '<c s="0"><v>1</v></c>' * 4 + '</row></worksheet>'
        raw = workbook(sheet=sheet, extras=[('xl/styles.xml', styles)], method=8)
        # Scale only the resource budget down; all production parsing/formatting runs.
        with mock.patch.object(smart, 'MAX_EXPANDED', 2048):
            with self.assertRaisesRegex(ValueError, 'formatting expands'):
                smart._read_xlsx(raw)

    def test_direct_preflight_caps_input_like_javascript(self):
        with self.assertRaisesRegex(ValueError, '2 MiB'):
            core.preflight_csv('sku,name,on_hand\n' + 'a' * (2 * 1024 * 1024))

    def test_file_read_stops_at_limit_plus_one(self):
        # Simulate a regular file growing after stat, without allocating huge data.
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch') as directory:
            path = Path(directory) / 'growing.csv'; path.write_text('x')
            cap = 2 * 1024 * 1024
            for size in (cap - 1, cap, cap + 1):
                with self.subTest(size=size):
                    payload = b'x' * size
                    backing = io.BytesIO(payload)
                    requests = []
                    def bounded_read(n=-1):
                        self.assertGreater(n, 0, 'unbounded read is forbidden')
                        self.assertLessEqual(n, 65536, 'read must remain chunked')
                        requests.append(n)
                        return backing.read(n)
                    stream = mock.MagicMock()
                    stream.__enter__.return_value = stream
                    stream.read.side_effect = bounded_read
                    with mock.patch.object(Path, 'open', return_value=stream), \
                         mock.patch.object(core, 'preflight_csv', return_value={'accepted': True}) as parse:
                        if size > cap:
                            with self.assertRaisesRegex(ValueError, '2 MiB'):
                                core.import_csv(str(path))
                            parse.assert_not_called()
                        else:
                            self.assertEqual(core.import_csv(str(path)), {'accepted': True})
                            parse.assert_called_once_with(payload.decode(), strict=False, max_bytes=cap)
                    self.assertGreater(len(requests), 1)
                    self.assertEqual(backing.tell(), size)
                    self.assertEqual(requests[-1], 1 if size >= cap else 2)


if __name__ == '__main__':
    unittest.main()
