"""Synthetic stdlib regressions for the CLI's per-file import byte budget.

Run: /usr/bin/python3 -m unittest discover -s tests -p test_cli_max_bytes.py -v
"""
import importlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cli_max_bytes", ROOT / "stock_runway.py")
assert SPEC is not None and SPEC.loader is not None
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)
ENGINE, SOURCES = CLI._load_modules()
IMPORT = importlib.import_module("_stock_runway_cli.csv_import")
DEFAULT = 2 * 1024 * 1024
STOCK = ("sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\n"
         "A,Synthetic,ea,0,14,30,30,30\n")


class MaxBytesTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / ".scratch"
        scratch.mkdir(exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix="max-bytes-", dir=scratch)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.stock = self.root / "stock.csv"
        self.stock.write_text(STOCK, encoding="utf-8")

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "stock_runway.py"),
                               *map(str, args)], cwd=ROOT, capture_output=True, text=True)

    def test_help_names_flag_and_default(self):
        result = self.run_cli("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--max-bytes", result.stdout)
        self.assertIn("2097152", result.stdout)

    def test_default_and_valid_integer(self):
        self.assertEqual(CLI._parser().parse_args(["unused.csv"]).max_bytes, DEFAULT)
        self.assertEqual(CLI._parser().parse_args(["unused.csv", "--max-bytes", "17"]).max_bytes, 17)

    def test_invalid_limits_fail_before_loading(self):
        for value in ("0", "-1", "1.5", "1e6", "2MiB", "nan", "inf", "1_000",
                      "١٠", "１００", " 10 ", "+10", str(sys.maxsize), "9" * 5000):
            with self.subTest(value=value[:30]):
                result = self.run_cli("missing.csv", "--max-bytes=" + value)
                self.assertEqual(result.returncode, 2)
                self.assertIn("--max-bytes", result.stderr)
                self.assertIn("positive ASCII integer", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_exact_file_limit_succeeds_and_one_byte_less_fails(self):
        size = self.stock.stat().st_size
        success = self.run_cli(self.stock, "--max-bytes", size, "--today", "2026-11-12", "--all")
        self.assertEqual(success.returncode, 0, success.stderr)
        failure = self.run_cli(self.stock, "--max-bytes", size - 1)
        self.assertEqual(failure.returncode, 2)
        self.assertIn(str(size - 1), failure.stderr)
        self.assertNotIn("Traceback", failure.stderr)
        self.assertEqual(failure.stdout, "")

    def test_explicit_default_preserves_output(self):
        args = [self.stock, "--today", "2026-11-12", "--all"]
        default = self.run_cli(*args)
        explicit = self.run_cli(*args, "--max-bytes", DEFAULT)
        self.assertEqual(default.returncode, 0, default.stderr)
        self.assertEqual((default.returncode, default.stdout, default.stderr),
                         (explicit.returncode, explicit.stdout, explicit.stderr))

    def test_largest_valid_limit_does_not_preallocate_the_budget(self):
        result = self.run_cli(self.stock, "--max-bytes", sys.maxsize - 1,
                              "--today", "2026-11-12", "--all")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_raised_limit_imports_large_stock_in_both_modes(self):
        # Blank lines grow a valid synthetic file without changing rows or math.
        self.stock.write_bytes(STOCK.encode() + b"\n" * DEFAULT)
        before = self.run_cli(self.stock)
        self.assertEqual(before.returncode, 2)
        self.assertIn("2 MiB", before.stderr)
        for mode in ([], ["--strict"]):
            with self.subTest(mode=mode):
                result = self.run_cli(self.stock, *mode, "--max-bytes", self.stock.stat().st_size,
                                      "--today", "2026-11-12", "--all")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Synthetic", result.stdout)
        self.assertEqual(SOURCES.MAX_CSV_BYTES, DEFAULT)
        with self.assertRaises(SOURCES.SourceError):
            SOURCES.load_csv(str(self.stock))

    def test_receipts_share_per_file_limit_not_combined_budget(self):
        receipts = self.root / "receipts.csv"
        receipts.write_bytes(b"sku,month,quantity\nA,2026-12,10\n" + b"\n" * DEFAULT)
        size = receipts.stat().st_size
        result = self.run_cli(self.stock, "--receipts", receipts, "--max-bytes", size,
                              "--today", "2026-11-12", "--all")
        self.assertEqual(result.returncode, 0, result.stderr)
        rejected = self.run_cli(self.stock, "--receipts", receipts, "--max-bytes", size - 1)
        self.assertEqual(rejected.returncode, 2)
        self.assertIn(str(size - 1), rejected.stderr)
        self.assertEqual(rejected.stdout, "")
        with self.assertRaises(SOURCES.SourceError):
            SOURCES.load_csv(str(self.stock), str(receipts))

    def test_utf8_byte_budget_is_not_character_budget(self):
        self.stock.write_text(STOCK.replace("Synthetic", "مخزون"), encoding="utf-8")
        raw = self.stock.read_bytes()
        self.assertGreater(len(raw), len(raw.decode("utf-8")))
        result = self.run_cli(self.stock, "--max-bytes", len(raw) - 1)
        self.assertEqual(result.returncode, 2)
        result = self.run_cli(self.stock, "--max-bytes", len(raw), "--today", "2026-11-12")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_nondefault_bundle_limit_is_explicitly_rejected(self):
        result = self.run_cli(self.root, "--bundle", "--max-bytes", DEFAULT + 1)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--max-bytes", result.stderr)
        self.assertIn("--bundle", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_library_limit_validation(self):
        for value in (True, False, None, 0, -1, 1.5, "100", sys.maxsize):
            for function, args in ((SOURCES.load_csv, (str(self.stock),)),
                                   (IMPORT.import_csv, (str(self.stock),)),
                                   (IMPORT.preflight_csv, (STOCK,)),
                                   (SOURCES.load_receipts, ("missing.csv", [], []))):
                with self.subTest(value=value, function=function.__name__):
                    with self.assertRaisesRegex(SOURCES.SourceError, "max_bytes"):
                        function(*args, max_bytes=value)

    def test_file_growth_after_stat_is_bounded(self):
        # Stat sees the small file; open returns a longer stream.
        import io
        limit = self.stock.stat().st_size
        class TrackingStream(io.BytesIO):
            def read(inner, size=-1):
                self.assertEqual(size, limit + 1)
                return super(TrackingStream, inner).read(size)
        for target in ("stock", "receipts"):
            with self.subTest(target=target):
                with patch.object(Path, "open", return_value=TrackingStream(b"x" * (limit + 2))):
                    with self.assertRaises(SOURCES.SourceError):
                        if target == "stock":
                            SOURCES.load_csv(str(self.stock), max_bytes=limit)
                        else:
                            SOURCES.load_receipts(str(self.stock), [], [], max_bytes=limit)

    def test_row_count_guard_remains(self):
        self.stock.write_text(STOCK.splitlines()[0] + "\n" +
                              "\n".join(f"A{i},Synthetic,ea,0,14,30,30,30" for i in range(10001)) + "\n",
                              encoding="utf-8")
        result = self.run_cli(self.stock, "--max-bytes", DEFAULT * 2)
        self.assertEqual(result.returncode, 2)
        self.assertIn("10000 rows", result.stderr)

    def test_python_golden_exports_unchanged(self):
        inputs = json.loads((ROOT / "tests/golden/inputs.json").read_text())
        golden = json.loads((ROOT / "tests/golden/numbers.json").read_text())
        self.assertEqual(len(inputs["cases"]), len(golden))
        for case, expected in zip(inputs["cases"], golden):
            with self.subTest(sku=case["item"]["sku"]):
                data = {"items": [case["item"]], "months": case["months"], "as_of": inputs["as_of"]}
                row, = CLI._export_rows(data, ENGINE, inputs["today"], case.get("settings", {}), True)
                self.assertEqual({key: row[key] for key in expected["cli"]}, expected["cli"])


if __name__ == "__main__":
    unittest.main()
