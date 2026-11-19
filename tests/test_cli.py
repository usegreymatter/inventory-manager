"""Local CLI tests; synthetic CSVs only, no Hermes runtime or services."""
import csv
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "stock_runway.py"
FIELDS = ["sku", "name", "unit", "status", "order_qty", "order_by",
          "next_confirmed_delivery", "arrives_by", "run_out", "on_hand", "on_order",
          "safety_stock", "reorder_point", "reason"]


@pytest.fixture
def local_files():
    scratch = ROOT / ".scratch"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cli-test-", dir=scratch) as directory:
        directory = Path(directory)
        stock = directory / "stock.csv"
        stock.write_text(
            'sku,name,unit,on_hand,supplier_days,on_order,2026-08,2026-09,2026-10\n'
            'A,"Synthetic, item",ea,0.7,,2,30,30,30\n'
            'B,Synthetic covered,ea,300,14,,30,30,30\n', encoding="utf-8")
        receipts = directory / "receipts.csv"
        receipts.write_text("sku,month,quantity\nA,2026-12,10\n", encoding="utf-8")
        yield directory, stock, receipts


def run_cli(*args):
    return subprocess.run([sys.executable, str(CLI), *map(str, args)],
                          cwd=ROOT, capture_output=True, text=True)


def load_cli():
    assert CLI.is_file(), "Root stock_runway.py CLI is missing"
    spec = importlib.util.spec_from_file_location("stock_runway_cli_entry", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def cli_boundary(monkeypatch):
    """Exercise real CSV loading and forecasting, isolate the parent-owned API."""
    cli = load_cli()
    engine, _ = cli._load_modules()
    calls = []

    def guidance(item, today, settings, as_of=None):
        calls.append((item, today, settings, as_of))
        return {"status": "order", "quantity": 3 if item["sku"] == "A" else 0,
                "order_by": "now" if item["sku"] == "A" else "2027-08-01",
                "delivery_date": "2026-12-01", "runout_date": "2026-11-01",
                "reason": "Synthetic boundary reason", "lead_days": 15, "safety_stock": 3, "reorder_point": 4}

    monkeypatch.setattr(engine, "order_guidance", guidance, raising=False)
    monkeypatch.setattr(engine, "order_bucket",
                        lambda item, today, settings, as_of:
                        "order" if item["sku"] == "A" else "healthy", raising=False)
    return cli, calls


@pytest.mark.parametrize("cover,level", [("1.5", "0.95"), (".5", ".99"), ("1e1", "9e-1"), ("36", "0.90")])
def test_ascii_decimal_settings_accept_valid_forms(cover, level):
    spec = importlib.util.spec_from_file_location("cli_decimal_probe", ROOT / "stock_runway.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    args = cli._parser().parse_args(["unused.csv", "--months-of-cover", cover, "--service-level", level])
    assert args.months_of_cover == float(cover)
    assert args.service_level == float(level)


def test_help_runs_without_hermes():
    result = run_cli("--help")
    assert result.returncode == 0
    for flag in ("--receipts", "--today", "--delivery-days", "--months-of-cover",
                 "--service-level", "--include-safety-stock", "--all"):
        assert flag in result.stdout
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("args", [[], ["missing.csv"], ["--unknown"]])
def test_missing_or_invalid_inputs_fail_friendly(args):
    result = run_cli(*args)
    assert result.returncode == 2
    assert "error:" in result.stderr.lower()
    assert "Traceback" not in result.stderr
    assert not result.stdout


@pytest.mark.parametrize("flag,value", [
    ("--today", "2026-02-30"), ("--today", "20261112"),
    ("--delivery-days", "0"), ("--delivery-days", "3651"),
    ("--delivery-days", "1.5"), ("--months-of-cover", "-1"),
    ("--months-of-cover", "37"), ("--months-of-cover", "nan"),
    ("--months-of-cover", "inf"), ("--service-level", "0.8"),
    ("--months-of-cover", "1_0"), ("--months-of-cover", "١٠"),
    ("--months-of-cover", "１.５"), ("--months-of-cover", "0x10"),
    ("--months-of-cover", " 1.5 "), ("--service-level", "٠.٩٥"),
    ("--service-level", "0.9_5"), ("--service-level", "０.９５"),
    ("--service-level", "nan"), ("--service-level", "inf"),
])
def test_invalid_settings_fail_before_loading(flag, value, local_files):
    result = run_cli(local_files[1], flag, value)
    assert result.returncode == 2
    assert "error:" in result.stderr.lower()
    assert "Traceback" not in result.stderr
    assert not result.stdout


def test_csv_stdout_filters_with_shared_bucket_and_preserves_raw_data(cli_boundary, local_files, capsys):
    cli, calls = cli_boundary
    _, stock, receipts = local_files
    assert cli.main([str(stock), "--receipts", str(receipts), "--today", "2026-11-12",
                     "--delivery-days", "21", "--months-of-cover", "1.5",
                     "--service-level", "0.99"]) == 0
    output = capsys.readouterr()
    reader = csv.DictReader(io.StringIO(output.out))
    assert reader.fieldnames == FIELDS
    rows = list(reader)
    assert len(rows) == 1
    assert rows[0] == dict(zip(FIELDS, ["A", "Synthetic, item", "ea", "order", "3",
                           "now", "2026-12-01", "2026-11-27", "2026-11-01", "0.7", "2", "3", "4",
                           "Synthetic boundary reason"]))
    assert "1" in output.err and "2" in output.err
    merged, today, settings, as_of = next(call for call in calls if call[3] is not None and "monthly_demand" in call[0])
    assert merged["on_hand"] == 0.7
    assert merged["monthly_sales"] == [30, 30, 30]
    assert merged["monthly_demand"] == 30
    assert merged["as_of"] == as_of == "2026-10-31"
    assert merged["receipts"] == {"2026-12": 10}
    assert today == "2026-11-12"
    assert settings["default_delivery_days"] == 21
    assert settings["months_of_cover"] == 1.5
    assert settings["service_level"] == 0.99


def test_all_writes_output_file_and_unknown_incoming_stays_blank(cli_boundary, local_files, capsys):
    cli, _ = cli_boundary
    directory, stock, _ = local_files
    output = directory / "orders.csv"
    assert cli.main([str(stock), "--all", "-o", str(output)]) == 0
    captured = capsys.readouterr()
    assert "2 items exported (of 2)" in captured.out
    assert captured.err.startswith('Import check: ')
    with output.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 2
    assert rows[1]["status"] == "healthy"
    assert rows[1]["on_order"] == ""


def test_invalid_csv_has_no_traceback(local_files):
    _, stock, _ = local_files
    stock.write_text("not,a,stock,file\n", encoding="utf-8")
    result = run_cli(stock)
    assert result.returncode == 2
    assert "error:" in result.stderr.lower()
    assert "Traceback" not in result.stderr


def test_output_io_error_is_friendly(cli_boundary, local_files, capsys):
    cli, _ = cli_boundary
    directory, stock, _ = local_files
    assert cli.main([str(stock), "-o", str(directory / "absent" / "orders.csv")]) == 2
    captured = capsys.readouterr()
    assert "error:" in captured.err.lower()
    assert "Traceback" not in captured.err


@pytest.mark.parametrize("target", ["stock", "receipts"])
def test_output_never_overwrites_input(cli_boundary, local_files, capsys, target):
    cli, _ = cli_boundary
    _, stock, receipts = local_files
    output = stock if target == "stock" else receipts
    before = output.read_bytes()
    assert cli.main([str(stock), "--receipts", str(receipts), "-o", str(output)]) == 2
    assert output.read_bytes() == before
    assert "error:" in capsys.readouterr().err.lower()


@pytest.mark.parametrize("bucket,quantity,expected", [
    ("order", 0, 2), ("running-low", 0, 2),
    ("healthy", 10, 0), ("needs-data", None, 0),
])
def test_default_filter_uses_bucket_not_positive_quantity(cli_boundary, local_files, capsys,
                                                         monkeypatch, bucket, quantity, expected):
    cli, _ = cli_boundary
    engine, _ = cli._load_modules()
    monkeypatch.setattr(engine, "order_bucket", lambda *args: bucket)
    monkeypatch.setattr(engine, "order_guidance", lambda *args: {"quantity": quantity})
    assert cli.main([str(local_files[1])]) == 0
    captured = capsys.readouterr()
    assert len(list(csv.DictReader(io.StringIO(captured.out)))) == expected


def test_all_preserves_unplannable_reason_and_empty_fields(cli_boundary, local_files, capsys, monkeypatch):
    cli, _ = cli_boundary
    engine, _ = cli._load_modules()
    monkeypatch.setattr(engine, "order_bucket", lambda *args: "needs-data")
    monkeypatch.setattr(engine, "order_guidance", lambda *args: {"reason": "Synthetic unusable history"})
    assert cli.main([str(local_files[1]), "--all"]) == 0
    rows = list(csv.DictReader(io.StringIO(capsys.readouterr().out)))
    assert len(rows) == 2
    assert rows[0]["reason"] == "Synthetic unusable history"
    assert all(rows[0][field] == "" for field in ("order_qty", "order_by", "next_confirmed_delivery", "arrives_by", "run_out"))


def test_real_shared_guidance_integration(local_files):
    cli = load_cli()
    engine, _ = cli._load_modules()
    assert all(hasattr(engine, name) for name in ("order_guidance", "order_bucket"))
    _, stock, receipts = local_files
    result = run_cli(stock, "--receipts", receipts, "--today", "2026-11-12", "--all")
    assert result.returncode == 0, result.stderr
    rows = list(csv.DictReader(io.StringIO(result.stdout)))
    assert len(rows) == 2
    assert rows[0]["status"] == "order"
    assert rows[0]["on_hand"] == "0.7"
    assert rows[0]["on_order"] == "2"
    assert rows[0]["order_qty"] != ""


@pytest.mark.parametrize("settings", [None, "bad", True, -1, [], [6]] + [
    {key: value}
    for key in ("big_order_months", "default_delivery_days", "months_of_cover", "service_level")
    for value in ("6", False, -1, float("nan"), None)
    if not (key == "default_delivery_days" and value is None)
])
def test_cli_export_boundary_malformed_settings_fall_back(local_files, settings):
    # CLI flags deliberately reject invalid text at argparse. Its reusable export
    # path must also tolerate malformed saved settings, just like chat/Desktop.
    cli = load_cli()
    engine, sources = cli._load_modules()
    data = sources.load_csv(str(local_files[1]))
    expected = cli._export_rows(data, engine, "2026-11-12", {}, True)
    rows = cli._export_rows(data, engine, "2026-11-12", settings, True)
    assert rows == expected
    assert all(row["status"] != "needs-data" for row in rows)
    output = io.StringIO()
    cli._write_csv(output, rows)
    assert len(list(csv.DictReader(io.StringIO(output.getvalue())))) == 2


@pytest.mark.parametrize("leading", ["=", "+", "-", "@", "\t", "\r"])
@pytest.mark.parametrize("field", ["sku", "name", "unit", "reason"])
def test_csv_formula_injection_is_neutralized(leading, field):
    cli = load_cli()
    row = dict.fromkeys(FIELDS, "")
    row[field] = leading + "Synthetic text"
    row["order_qty"] = -1.5  # numeric minus is not text/formula input
    output = io.StringIO(newline="")
    cli._write_csv(output, [row])
    parsed, = csv.DictReader(io.StringIO(output.getvalue(), newline=""))
    assert parsed[field] == "'" + row[field]
    assert parsed["order_qty"] == "-1.5"


@pytest.mark.parametrize("number,text", [(7860.0,"7860"), (.000001,"0.000001"),
    (.0000001,"0.0000001"), (0,"0"), (.125,"0.125"), (1e12,"1000000000000")])
def test_csv_numbers_are_plain_not_exponents(number, text):
    cli = load_cli()
    row = dict.fromkeys(FIELDS, "")
    for field in ("order_qty", "on_hand", "on_order", "safety_stock", "reorder_point"):
        row[field] = number
    output = io.StringIO()
    cli._write_csv(output, [row])
    parsed, = csv.DictReader(io.StringIO(output.getvalue()))
    assert all(parsed[field] == text for field in ("order_qty", "on_hand", "on_order", "safety_stock", "reorder_point"))


@pytest.mark.parametrize("order_by,lead,expected", [("now",15,"2026-11-27"),
    ("2027-09-16",14,"2027-09-30"), ("2026-12-31",0,"2026-12-31"),
    (None,14,None), ("now",None,None), ("9999-12-31",14,None)])
def test_arrival_uses_guidance_lead_not_fallback(order_by, lead, expected):
    assert load_cli()._arrives_by({"order_by":order_by,"lead_days":lead}, "2026-11-12") == expected


def test_freshness_warning_and_needs_data_summary(local_files):
    _, stock, _ = local_files
    stock.write_text('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\n'
                     'A,Synthetic,ea,0,14,30,30,30\n'
                     'B,Calendar limit,ea,1000000000000,14,1,1,1\n', encoding="utf-8")
    result = run_cli(stock, "--today", "2027-01-01")
    assert result.returncode == 0, result.stderr
    assert "Your sales data ends Oct 2026 (62 days ago). Numbers may be out of date — load a newer file." in result.stderr
    assert "1 items need data (use --all to include them)" in result.stderr
    rows = list(csv.DictReader(io.StringIO(result.stdout)))
    assert [row["sku"] for row in rows] == ["A"]
    result = run_cli(stock, "--today", "2027-01-01", "--all")
    assert result.returncode == 0, result.stderr
    rows = list(csv.DictReader(io.StringIO(result.stdout)))
    assert rows[1]["status"] == "needs-data"
    assert rows[1]["reason"]


def test_include_safety_stock_and_service_level_change_existing_outputs(local_files):
    _, stock, _ = local_files
    stock.write_text('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\n'
                     'A,Synthetic,ea,0,14,10,30,50\n', encoding="utf-8")
    def row(*args):
        result = run_cli(stock, "--today", "2026-11-12", "--all", *args)
        assert result.returncode == 0, result.stderr
        return next(csv.DictReader(io.StringIO(result.stdout)))
    low = row("--service-level", "0.9")
    high = row("--service-level", "0.99")
    backup = row("--service-level", "0.99", "--include-safety-stock")
    assert int(low["safety_stock"]) < int(high["safety_stock"])
    assert int(low["reorder_point"]) < int(high["reorder_point"])
    assert int(low["order_qty"]) < int(high["order_qty"])
    assert backup == high  # Explicit enable is idempotent; SS is on by default.


def test_file_output_has_excel_utf8_bom(local_files):
    directory, stock, _ = local_files
    output = directory / "orders.csv"
    result = run_cli(stock, "--today", "2026-11-12", "-o", output)
    assert result.returncode == 0, result.stderr
    assert output.read_bytes().startswith(b"\xef\xbb\xbfsku,")
