import pytest
from pathlib import Path
import sys
import importlib.util
import types

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)

from stock_runway.sources import SourceError, load_csv


def test_strict_csv_and_optional_receipts(tmp_path):
    sales = tmp_path / "sales.csv"
    sales.write_text("sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\nA,Item,ea,20,5,1,2,3\n", encoding="utf-8")
    receipts = tmp_path / "receipts.csv"
    receipts.write_text("sku,month,quantity\nA,2026-04,4\n", encoding="utf-8")
    data = load_csv(str(sales), str(receipts))
    assert data["items"][0]["receipts"] == {"2026-04": 4}
    assert data["as_of"] == "2026-03-31"


@pytest.mark.parametrize("body,reason", [
    ("sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\nA,Item,ea,-1,2,1,2,3\n", "non-negative"),
    ("sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\nA,Item,ea,20,2,1,wat,3\n", "number"),
    ("sku,name,unit,on_hand,supplier_days,2026-01,2026-03,2026-02\nA,Item,ea,20,2,1,2,3\n", "chronological"),
])
def test_bad_csv_is_clear(tmp_path, body, reason):
    path = tmp_path / "bad.csv"
    path.write_text(body, encoding="utf-8")
    with pytest.raises(SourceError, match=reason):
        load_csv(str(path), strict=True)


@pytest.mark.parametrize("month", ["2026-02", "2026-03"])
def test_receipts_must_be_after_sales_month(tmp_path, month):
    sales = tmp_path / "sales.csv"
    sales.write_text("sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\nA,Item,ea,20,5,1,2,3\n")
    receipts = tmp_path / "receipts.csv"
    receipts.write_text(f"sku,month,quantity\nA,{month},4\n")
    with pytest.raises(SourceError, match="Receipts row 2: month must be after the last sales month\\."):
        load_csv(str(sales), str(receipts))


@pytest.mark.parametrize("month,valid", [("2027-03", True), ("2027-04", False), ("2026-13", False)])
def test_receipts_future_bound(tmp_path, month, valid):
    sales = tmp_path / "sales.csv"
    sales.write_text("sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\nA,Item,ea,20,5,1,2,3\n")
    receipts = tmp_path / "receipts.csv"
    receipts.write_text(f"sku,month,quantity\nA,{month},4\n")
    if valid:
        assert load_csv(str(sales), str(receipts))["items"][0]["receipts"] == {month: 4}
    else:
        with pytest.raises(SourceError, match="month is invalid or beyond"):
            load_csv(str(sales), str(receipts))


def test_csv_path_is_explicit():
    with pytest.raises(SourceError, match="explicit"):
        load_csv("")
