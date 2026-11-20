"""Real CLI boundary probes; no mocks, generated data only."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CAP = 2 * 1024 * 1024

class CliCapSubprocessTests(unittest.TestCase):
    def test_oversized_real_file_rejected_at_cli_with_original_error(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch') as directory:
            path = Path(directory) / 'oversized.csv'
            path.write_bytes(b'x' * (CAP + 1))
            for flags in ([], ['--strict']):
                with self.subTest(flags=flags):
                    result = subprocess.run([sys.executable, str(ROOT / 'stock_runway.py'), str(path), *flags],
                                            cwd=ROOT, capture_output=True, timeout=15)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertEqual(result.stdout, b'')
                    self.assertEqual(result.stderr, b'stock_runway.py: error: CSV must be a local file no larger than 2 MiB.\n')

    def test_stdin_is_not_a_supported_cli_source_and_cannot_bypass_file_cap(self):
        # '-' has never meant stdin for this local-file-only CLI. Feed real stdin
        # anyway and prove a large pipe cannot bypass the path rejection.
        results = [subprocess.run([sys.executable, str(ROOT / 'stock_runway.py'), '-'], input=payload,
                                  cwd=ROOT, capture_output=True, timeout=15)
                   for payload in (b'x', b'x' * (CAP + 1))]
        for result in results:
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertEqual(result.stdout, b'')
            self.assertEqual(result.stderr, b'stock_runway.py: error: Could not read the local CSV file.\n')
        self.assertEqual(results[0].stderr, results[1].stderr)

if __name__ == '__main__':
    unittest.main()
