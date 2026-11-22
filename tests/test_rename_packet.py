"""Brand and version contract for the Inventory Manager beta."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_primary_outputs_redirect_old_names_and_show_current_brand():
    for name, old in (("inventory-manager.html", "stock-runway.html"),
                      ("inventory-manager-demo-1000.html", "stock-runway-demo-1000.html")):
        page = (ROOT / "standalone" / name).read_text()
        redirect = (ROOT / "standalone" / old).read_text()
        assert "Inventory Manager" in page
        assert "by GreyMatter" in page
        assert "inventory-manager-order.xlsx" in page
        assert "inventory-manager-order.csv" in page
        assert "inventory-manager-views.json" in page
        assert "inventory-manager-weekly-" in page
        assert "inventory-manager-settings.json" in page
        assert f"url={name}" in redirect


def test_beta_version_and_mcp_client_name():
    manifest = (ROOT / "plugin.yaml").read_text()
    server = (ROOT / "mcp_server.py").read_text()
    assert re.search(r"(?m)^version: 1\.2\.0-beta$", manifest)
    assert "'name': 'inventory-manager', 'version': '1.2.0-beta'" in server
    assert "model_version='1.2.0-beta'" in server


def test_new_download_names_and_legacy_protocol_keys_remain_compatible():
    source = (ROOT / "standalone/design").joinpath("xlsx-gm-b.js").read_text()
    weekly = (ROOT / "standalone/design").joinpath("weekly-summary-gm-b.js").read_text()
    settings = (ROOT / "standalone/design").joinpath("settings-gm-b.js").read_text()
    assert "inventory-manager-order.xlsx" in source
    assert "inventory-manager-order.csv" in (ROOT / "standalone/design/worklist-gm-b.js").read_text()
    assert "inventory-manager-views.json" in (ROOT / "standalone/design/worklist-gm-b.js").read_text()
    assert "inventory-manager-weekly-" in weekly
    assert "inventory-manager-settings.json" in settings
    assert "stock-runway.standalone.order-settings.v2" in settings
    assert "stock_runway" in (ROOT / "stock_runway.py").name
