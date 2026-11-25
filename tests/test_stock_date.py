"""Optional stock count date: stock counted after the last sales month is not
reduced again by the sales between the month end and the count. Synthetic only."""
from datetime import date
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("stock_date_engine", ROOT / "engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
SALES = [930, 900, 930, 930, 900, 930]  # 30 units a day


def dataset(**extra):
    item = {"sku": "SYN-30", "name": "Synthetic 30 a day", "unit": "box", "on_hand": 3000,
            "supplier_days": 14, "monthly_sales": list(SALES), **extra}
    return {"as_of": "2026-10-31", "months": list(MONTHS), "items": [item]}


def plan(data, today):
    raw = data["items"][0]
    physical = engine.forecast(raw, data["months"], data["as_of"], today=today)
    item = {**raw, **physical, "on_hand": raw["on_hand"], "monthly_sales": raw["monthly_sales"], "as_of": data["as_of"]}
    return item, engine.order_guidance(item, today, None, data["as_of"])


def days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


class StockDateTest(unittest.TestCase):
    def test_count_on_today_starts_runway_at_count(self):
        _, before = plan(dataset(), "2026-11-24")
        moved = engine.apply_stock_date(dataset(), "2026-11-24", "2026-11-24")
        item, after = plan(moved, "2026-11-24")
        # 3000 units at 30 a day last about 100 days from the count, not from 31 Oct.
        self.assertTrue(95 <= days("2026-11-24", after["runout_date"]) <= 105, after["runout_date"])
        self.assertTrue(95 <= days("2026-10-31", before["runout_date"]) <= 105, before["runout_date"])
        self.assertGreater(after["runout_date"], before["runout_date"])
        self.assertGreater(after["runout_date"], "2026-11-24")
        self.assertLess(after["quantity"], before["quantity"])
        self.assertGreater(after["order_by"], before["order_by"])
        self.assertEqual(item["counted_on_hand"], 3000)
        self.assertEqual(item["stock_counted_on"], "2026-11-24")
        self.assertEqual(item["on_hand"], 3000 + item["stock_date_adjustment"])
        self.assertTrue(700 <= item["stock_date_adjustment"] <= 740)

    def test_count_on_as_of_is_identical_to_no_date(self):
        moved = engine.apply_stock_date(dataset(), "2026-10-31", "2026-11-24")
        self.assertEqual(plan(moved, "2026-11-24")[1], plan(dataset(), "2026-11-24")[1])
        self.assertEqual(moved["items"][0]["stock_date_adjustment"], 0)

    def test_count_inside_last_month_removes_later_sales(self):
        moved = engine.apply_stock_date(dataset(), "2026-10-15", "2026-11-24")
        # 16 of 31 October days follow the count: ceil(930 * 16 / 31) = 480.
        self.assertEqual(moved["items"][0]["stock_date_adjustment"], -480)
        self.assertEqual(moved["items"][0]["on_hand"], 2520)

    def test_refuses_dates_outside_range(self):
        with self.assertRaisesRegex(ValueError, "before the last sales month"):
            engine.apply_stock_date(dataset(), "2026-09-30", "2026-11-24")
        with self.assertRaisesRegex(ValueError, "after today"):
            engine.apply_stock_date(dataset(), "2026-11-25", "2026-11-24")
        with self.assertRaisesRegex(ValueError, "real YYYY-MM-DD"):
            engine.apply_stock_date(dataset(), "2026-11-31", "2026-11-24")

    def test_notice_only_when_stale_and_no_date(self):
        self.assertIn("assumed counted on 2026-10-31", engine.stock_date_notice("2026-10-31", "2026-11-24"))
        self.assertIsNone(engine.stock_date_notice("2026-10-31", "2026-11-07"))
        self.assertIsNotNone(engine.stock_date_notice("2026-10-31", "2026-11-08"))
        self.assertIsNone(engine.stock_date_notice("2026-10-31", "2026-11-24", "2026-11-24"))

    def test_lots_and_held_items_are_not_moved(self):
        held = dataset(monthly_sales=[None] * 6)
        self.assertEqual(engine.apply_stock_date(held, "2026-11-24", "2026-11-24")["items"][0], held["items"][0])
        lots = dataset(lots=[{"qty": 3000, "expiry": "2027-12-31"}])
        moved = engine.apply_stock_date(lots, "2026-11-24", "2026-11-24")["items"][0]
        self.assertEqual(moved["on_hand"], 3000)
        self.assertNotIn("stock_counted_on", moved)
        self.assertTrue(any("lot quantities" in w for w in moved["input_warnings"]))

    def test_incoming_before_count_warns(self):
        moved = engine.apply_stock_date(dataset(receipts={"2026-11": 100}), "2026-11-24", "2026-11-24")
        self.assertTrue(any("Incoming stock due on or before" in w for w in moved["items"][0]["input_warnings"]))

    def test_zero_last_month_inside_count_warns(self):
        # Blank sales cells import as 0: stock is not reduced, and the item says so.
        moved = engine.apply_stock_date(dataset(monthly_sales=[930, 900, 930, 930, 900, 0]), "2026-10-15", "2026-11-24")["items"][0]
        self.assertEqual(moved["stock_date_adjustment"], 0)
        self.assertEqual(moved["on_hand"], 3000)
        self.assertIn(engine.STOCK_DATE_ZERO_SALES_WARNING, moved["input_warnings"])
        self.assertIn("sales after the count", engine.STOCK_DATE_ZERO_SALES_WARNING)
        # Not on the month end itself, not after it, and not when the month has sales.
        for zero_sales, count in (([930, 900, 930, 930, 900, 0], "2026-10-31"), ([930, 900, 930, 930, 900, 0], "2026-11-10"),
                                  (SALES, "2026-10-15")):
            item = engine.apply_stock_date(dataset(monthly_sales=list(zero_sales)), count, "2026-11-24")["items"][0]
            self.assertNotIn(engine.STOCK_DATE_ZERO_SALES_WARNING, item.get("input_warnings", []), count)

    def test_settings_key_is_not_persisted(self):
        # The count date is per run (--stock-date) or per file (browser field), never a saved setting.
        with self.assertRaisesRegex(ValueError, "Invalid setting: stock_counted_on"):
            engine.validate_order_settings({"stock_counted_on": "2026-11-24"})
        self.assertNotIn("stock_counted_on", engine.normalize_order_settings({"stock_counted_on": "2026-11-24"}))
        self.assertNotIn("stock_counted_on", engine.normalize_order_settings({}))


class StockDateCliTest(unittest.TestCase):
    def run_cli(self, tmp, *extra, settings=None):
        csv = tmp / "stock.csv"
        csv.write_text("sku,name,unit,on_hand,supplier_days," + ",".join(MONTHS) + "\n"
                       "SYN-30,Synthetic,box,3000,14," + ",".join(map(str, SALES)) + "\n", encoding="utf-8")
        args = [sys.executable, str(ROOT / "stock_runway.py"), str(csv), "--today", "2026-11-24", "--all", *extra]
        if settings is not None:
            path = tmp / "settings.json"
            path.write_text(json.dumps(settings), encoding="utf-8")
            args += ["--settings", str(path)]
        return subprocess.run(args, capture_output=True, text=True, cwd=ROOT)

    def setUp(self):
        import tempfile
        self.dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self.dir.name)

    def tearDown(self):
        self.dir.cleanup()

    def row(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        header, row = result.stdout.strip().splitlines()[:2]
        return dict(zip(header.split(","), row.split(",")))

    def test_default_warns_and_flag_moves_runway(self):
        plain = self.run_cli(self.tmp)
        self.assertIn("Stock is assumed counted on 2026-10-31", plain.stderr)
        self.assertIn("--stock-date", plain.stderr)
        dated = self.run_cli(self.tmp, "--stock-date", "2026-11-24")
        self.assertNotIn("assumed counted", dated.stderr)
        before, after = self.row(plain), self.row(dated)
        self.assertEqual(after["on_hand"], "3000")
        self.assertLess(int(after["order_qty"]), int(before["order_qty"]))
        self.assertTrue(95 <= days("2026-11-24", after["run_out"]) <= 105)

    def test_settings_key_refused_and_date_refusal(self):
        stale = self.run_cli(self.tmp, settings={"stock_counted_on": "2026-11-24"})
        self.assertEqual(stale.returncode, 2)
        self.assertIn("stock_counted_on", stale.stderr)
        self.assertNotIn("settings: stock_counted_on", self.run_cli(self.tmp).stderr)
        refused = self.run_cli(self.tmp, "--stock-date", "2026-09-30")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("before the last sales month", refused.stderr)
        future = self.run_cli(self.tmp, "--stock-date", "2026-11-25")
        self.assertEqual(future.returncode, 2)
        self.assertIn("after today", future.stderr)


if __name__ == "__main__":
    unittest.main()
