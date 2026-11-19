"""Legacy strict regressions: ERP export headers (SAP B1, NetSuite, Zoho, QuickBooks, Dynamics) load like the canonical CSV."""
import csv
import io
from pathlib import Path
import sys
import types

import pytest

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)

from stock_runway.sources import SourceError, erp_month, load_csv, normalize_erp_rows  # noqa: E402

CANON = "sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\nA-1,Widget,pcs,1200,30,100,110,120\n"
EXAMPLES = sorted((ROOT / "docs" / "erp-examples").glob("*.csv"))


def _load(tmp_path, body, name="x.csv"):
    p = tmp_path / name
    p.write_text(body, encoding="utf-8")
    return load_csv(str(p), strict=True)


def test_examples_exist():
    assert {p.stem for p in EXAMPLES} >= {"sap-business-one", "netsuite", "zoho-inventory", "quickbooks", "dynamics-365"}


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_every_erp_example_matches_canonical(tmp_path, path):
    canon = _load(tmp_path, CANON)
    got = load_csv(str(path))
    item = got["items"][0]
    want = canon["items"][0]
    assert got["months"] == canon["months"]
    assert item["sku"] == want["sku"] and item["name"] == want["name"]
    assert item["on_hand"] == want["on_hand"] and item["monthly_sales"] == want["monthly_sales"]
    if path.stem != "quickbooks":
        assert item["unit"] == "pcs"
    if path.stem in {"sap-business-one", "sap-s4hana", "netsuite", "sage"}:
        assert item["supplier_days"] == 30


@pytest.mark.parametrize("sku_header", ["SKU #", "Sku#"])
def test_sku_hash_header_stays_accepted(tmp_path, sku_header):
    d = _load(tmp_path, f"{sku_header},Name,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,Widget,5,1,2,3\n")
    assert d["items"][0]["sku"] == "A"


def test_netsuite_name_and_description_without_display_name(tmp_path):
    d = _load(tmp_path, "Name,Description,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,Widget,5,1,2,3\n")
    assert d["items"][0]["sku"] == "A"
    assert d["items"][0]["name"] == "Widget"


def test_canonical_file_unchanged(tmp_path):
    assert _load(tmp_path, CANON)["items"][0] == {
        "sku": "A-1", "name": "Widget", "unit": "pcs", "on_hand": 1200,
        "supplier_days": 30, "monthly_sales": [100, 110, 120], "receipts": {},
    }


def test_canonical_normalization_returns_original_rows():
    rows = list(csv.reader(io.StringIO(CANON))) + [[""] * 8]
    rows[1][3] = "1,200"
    rows[1][5] = ""
    assert normalize_erp_rows(rows) is rows


@pytest.mark.parametrize("value", ["", " ", "1,200", "12,00"])
def test_canonical_monthly_sales_remain_strict(tmp_path, value):
    rows = list(csv.reader(io.StringIO(CANON)))
    rows[1][5] = value
    body = io.StringIO()
    csv.writer(body).writerows(rows)
    with pytest.raises(SourceError, match="2026-01 must be a number"):
        _load(tmp_path, body.getvalue())


def test_missing_unit_and_lead_time_default(tmp_path):
    d = _load(tmp_path, "Item Code,Item Name,Qty On Hand,Jan 2026,Feb 2026,Mar 2026\nA,W,5,1,2,3\n")
    assert d["items"][0]["unit"] == "units" and d["items"][0]["supplier_days"] is None


def test_unknown_columns_dropped_and_any_order(tmp_path):
    d = _load(tmp_path, 'Price,Mar 2026,Qty On Hand,Item Name,Feb 2026,Item Code,Jan 2026\n9.5,3,"1,500",W,2,A,1\n')
    assert d["months"] == ["2026-01", "2026-02", "2026-03"]
    assert d["items"][0]["on_hand"] == 1500 and d["items"][0]["monthly_sales"] == [1, 2, 3]


def test_missing_required_column_still_clear(tmp_path):
    with pytest.raises(SourceError, match="CSV columns must begin.*ERP names"):
        _load(tmp_path, "Item Name,Qty On Hand,Jan 2026,Feb 2026,Mar 2026\nW,5,1,2,3\n")


@pytest.mark.parametrize("blank", [[], [""], [" ", "\t"], ["\ufeff \ufeff"], [""] * 6, [""] * 9])
def test_fully_blank_erp_rows_are_skipped(tmp_path, blank):
    body = io.StringIO()
    writer = csv.writer(body)
    writer.writerows([
        ["SKU", "Name", "On Hand", "Jan 2026", "Feb 2026", "Mar 2026"],
        blank,
        ["A", "Widget", "5", "1", "2", "3"],
        blank,
    ])
    got = _load(tmp_path, body.getvalue())
    assert [item["sku"] for item in got["items"]] == ["A"]


def test_partially_blank_erp_rows_still_require_identifiers(tmp_path):
    with pytest.raises(SourceError, match="sku, name, and unit are required"):
        _load(tmp_path, "SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026\n,W,5,1,2,3\n")


def test_bad_values_still_rejected(tmp_path):
    with pytest.raises(SourceError, match="non-negative"):
        _load(tmp_path, "SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,W,-5,1,2,3\n")


@pytest.mark.parametrize("label,want", [
    ("2026-01", "2026-01"), ("2026/01", "2026-01"), ("2026-01-31", "2026-01"), ("01/2026", "2026-01"),
    ("Jan 2026", "2026-01"), ("January 2026", "2026-01"), ("Jan-26", "2026-01"), ("Sept 2026", "2026-09"),
    ("Price", None), ("Name", None), ("2026-13", None), ("Janx 2026", None),
])
def test_month_labels(label, want):
    assert erp_month(label) == want


def _erp_numeric_csv(column, value):
    headers = ["SKU", "Name", "On Hand", "Lead Time", "Jan 2026", "Feb 2026", "Mar 2026",
               "rcv:Jan 2026", "rcv:Feb 2026", "rcv:Mar 2026"]
    row = ["A", "Widget", "5", "30", "1", "2", "3", "4", "5", "6"]
    row[headers.index(column)] = value
    body = io.StringIO()
    csv.writer(body).writerows([headers, row])
    return body.getvalue()


@pytest.mark.parametrize("column", ["On Hand", "Lead Time", "Jan 2026", "rcv:Jan 2026"])
@pytest.mark.parametrize("value", ["1,5", "12,34", "1,23,456", "1234,567", "1,,000",
                                  ",100", "1,000,", "1,000.", "1,000e2", "1,000.2,3", "١,٢٣٤"])
def test_malformed_grouped_erp_numbers_are_rejected(tmp_path, column, value):
    with pytest.raises(SourceError, match="must be a number"):
        _load(tmp_path, _erp_numeric_csv(column, value))


@pytest.mark.parametrize("column,key", [("On Hand", "on_hand"), ("Lead Time", "supplier_days"),
                                       ("Jan 2026", "monthly_sales"), ("rcv:Jan 2026", "historical_receipts")])
@pytest.mark.parametrize("value,want", [("1,200", 1200), (" +1,234.50 ", 1234.5),
                                      ("1,000", 1000), ("1e2", 100), (".5", 0.5)])
def test_valid_erp_numbers_are_preserved(tmp_path, column, key, value, want):
    item = _load(tmp_path, _erp_numeric_csv(column, value))["items"][0]
    got = item[key]
    if key == "monthly_sales":
        got = got[0]
    elif key == "historical_receipts":
        got = got["2026-01"]
    assert got == want


@pytest.mark.parametrize("column", ["On Hand", "Lead Time", "Jan 2026", "rcv:Jan 2026"])
def test_negative_grouped_erp_numbers_still_rejected(tmp_path, column):
    with pytest.raises(SourceError, match="must be a non-negative number"):
        _load(tmp_path, _erp_numeric_csv(column, "-1,000"))


@pytest.mark.parametrize("headers", [
    "itemCode,itemName,unitOfMeasure,qtyOnHand,leadTime,itemGroup",
    "itemcode,itemname,invntryuom,qtyonhand,leadtime,itmsgrpnam",
    "ItemCode,ItemName,InvntryUom,OnHand,LeadTime,ItmsGrpNam",
])
def test_camelcase_and_run_together_erp_headers(tmp_path, headers):
    got = _load(tmp_path, headers + ",Jan 2026,Feb 2026,Mar 2026\nA,W,pcs,1200,30,Hardware,1,2,3\n")
    item = got["items"][0]
    assert item["sku"] == "A" and item["name"] == "W"
    assert item["unit"] == "pcs" and item["on_hand"] == 1200
    assert item["supplier_days"] == 30 and item["category"] == "Hardware"


@pytest.mark.parametrize("names,values", [("Description,Name", "Long description,Widget"),
                                         ("Name,Description", "Widget,Long description")])
def test_name_takes_priority_over_description(tmp_path, names, values):
    got = _load(tmp_path, f"SKU,{names},On Hand,Jan 2026,Feb 2026,Mar 2026\nA,{values},5,1,2,3\n")
    assert got["items"][0]["name"] == "Widget"


def test_netsuite_display_name_still_wins(tmp_path):
    got = _load(tmp_path, "Name,Description,Display Name,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,Long description,Widget,5,1,2,3\n")
    assert got["items"][0]["sku"] == "A" and got["items"][0]["name"] == "Widget"


@pytest.mark.parametrize("header", ["Item #", "Item#", "Part #", "#"])
def test_hash_headers_mean_number(tmp_path, header):
    got = _load(tmp_path, f"{header},Name,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,W,5,1,2,3\n")
    assert got["items"][0]["sku"] == "A"


@pytest.mark.parametrize("value", ["", " ", "\t"])
def test_blank_erp_monthly_sales_default_to_zero(tmp_path, value):
    got = _load(tmp_path, _erp_numeric_csv("Jan 2026", value))
    assert got["items"][0]["monthly_sales"] == [0, 2, 3]


@pytest.mark.parametrize("column", ["On Hand", "rcv:Jan 2026"])
def test_blank_other_erp_numbers_still_rejected(tmp_path, column):
    with pytest.raises(SourceError, match="must be a number"):
        _load(tmp_path, _erp_numeric_csv(column, ""))


def test_missing_erp_monthly_cell_still_rejected(tmp_path):
    with pytest.raises(SourceError, match="column count does not match"):
        _load(tmp_path, "SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,W,5,1,2\n")


@pytest.mark.parametrize("label,want", [
    ("1/1/2026", "2026-01"), ("12/01/2026", "2026-12"), (" 01/01/2026 ", "2026-01"),
    ("1.1.2026", "2026-01"), ("01.12.2026", "2026-12"),
    ("1/2/2026", None), ("2.1.2026", None), ("1/0/2026", None), ("0.1.2026", None),
    ("13/1/2026", None), ("1.13.2026", None), ("1/32/2026", None), ("32.1.2026", None),
])
def test_month_start_date_labels(label, want):
    assert erp_month(label) == want


@pytest.mark.parametrize("labels", ["3/1/2026,1/1/2026,2/1/2026", "01.03.2026,01.01.2026,01.02.2026"])
def test_month_start_date_columns_load_in_order(tmp_path, labels):
    got = _load(tmp_path, f"SKU,Name,On Hand,{labels}\nA,W,5,3,1,2\n")
    assert got["months"] == ["2026-01", "2026-02", "2026-03"]
    assert got["items"][0]["monthly_sales"] == [1, 2, 3]
