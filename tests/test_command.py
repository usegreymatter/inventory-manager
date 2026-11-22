import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    if "sr_cmd" not in sys.modules:
        spec = importlib.util.spec_from_file_location("sr_cmd", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
        module = importlib.util.module_from_spec(spec)
        sys.modules["sr_cmd"] = module
        spec.loader.exec_module(module)
    import sr_cmd.commands as commands
    import sr_cmd.tools as tools
    return commands, tools


def test_build_args():
    commands, _ = _load()
    assert commands.build_args("") == {"source": "sample"}
    assert commands.build_args("A B") == {"source": "sample", "skus": ["A", "B"]}
    assert commands.build_args("~/x/stock.CSV") == {"source": "csv", "csv_path": "~/x/stock.CSV"}
    assert commands.build_args("help") == {"help": True}


def test_stock_command_sample_sorted_by_runout():
    commands, tools = _load()
    out = commands.make_command(tools.make_handler())("")
    lines = out.splitlines()
    assert lines[0].startswith("Inventory Manager (stock as of 2026-10-31")
    assert lines[1] == "• UL-FOAM-GRN: runs out Dec 2026; Too far off to plan on; Sales pattern: Very uneven, Safety stock — extra kept for delays or surprise demand: 28, Reorder point — order when stock drops to 30"
    assert lines[2] == "• GRT-GRY-5: runs out Dec 2026; Too far off to plan on; Sales pattern: Very uneven, Safety stock — extra kept for delays or surprise demand: 83, Reorder point — order when stock drops to 145"
    assert "• SEAL-CLR-300: runs out Mar 2027; Usable for planning; Sales pattern: Steady, Safety stock — extra kept for delays or surprise demand: 16, Reorder point — order when stock drops to 67" in lines
    assert lines[-1] == "Includes recorded receipts; assumes nothing else is on order."


def test_stock_command_errors_are_plain():
    commands, tools = _load()
    out = commands.make_command(tools.make_handler())("NOPE-1")
    assert out.startswith("Inventory Manager: ") and "Usage: /stock" in out
    broken = commands.make_command(lambda args: "not json")("")
    assert broken.startswith("Inventory Manager could not run.")


def test_register_adds_command():
    module = sys.modules.get("sr_cmd") or _load() and sys.modules["sr_cmd"]
    seen = {}

    class Ctx:
        def register_tool(self, **kw): seen["tool"] = kw["name"]
        def register_skill(self, *a, **kw): pass
        def register_command(self, name, handler, **kw): seen["command"] = (name, kw.get("args_hint"))

    module.register(Ctx())
    assert seen["tool"] == "stock_runway"
    assert seen["command"] == ("stock", "[SKU ... | file.csv]")
