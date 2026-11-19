"""Exact legacy forecast comparisons against the pre-guidance source commit.

Only local Git objects and committed sample/ERP fixtures are read. Source-only
archives can run the remaining suite without having this historical object.
"""
import importlib
from pathlib import Path
import shutil
import subprocess
import sys
import types

import pytest
from baseline import read_baseline
from policy_assertions import assert_forecast_frozen

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "04d15a9"
PACKAGE = "legacy_comparison_package"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE, package)
engine = importlib.import_module(PACKAGE + ".engine")
sources = importlib.import_module(PACKAGE + ".sources")


@pytest.fixture(scope="module")
def legacy_engine():
    source = read_baseline(BASELINE + ":engine.py", text=True)
    module = types.ModuleType("legacy_stock_engine_04d15a9")
    sys.modules[module.__name__] = module
    # Owner-approved seams: fractional monthly demand and the default seven-day
    # reorder timing margin. All other historical source (notably backtest)
    # remains untouched. Policy v2 fields now have explicit separate oracles;
    # every non-policy field (including all projection cells) is still exact.
    anchor = "return max(0, math.ceil(value))"
    assert source.count(anchor) == 1
    approved = source.replace(anchor, "return max(0, value)")
    point = "planning_calendar_demand(model, last_month, lead) + backup"
    assert approved.count(point) == 1
    approved = approved.replace(point, "planning_calendar_demand(model, last_month, lead + min(7, math.ceil(settings['months_of_cover'] * DAYS_PER_MONTH))) + backup")
    # Owner-approved Phase 4 method label accompanies the model substitution.
    approved = approved.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
    exec(compile(approved, BASELINE + ":engine.py", "exec"), module.__dict__)
    # Owner-approved Phase 4 changes only the default model seam.
    module.demand_model = engine.demand_model
    return module


def comparison_cases():
    datasets = [("sample", sources.load_sample())] + [
        (path.stem, sources.load_csv(str(path)))
        for path in sorted((ROOT / "docs" / "erp-examples").glob("*.csv"))]
    for name, data in datasets:
        for raw in data["items"]:
            variants = [{}, {"service_level": .99, "months_of_cover": 3,
                            "include_backup_in_orders": True},
                        {"service_level": .9, "order_cost": 25,
                         "product_overrides": {raw["sku"]: {"unit_cost": 2.5,
                             "minimum_order": 10, "pack_size": .125}}}]
            for horizon in range(1, 13):
                for index, settings in enumerate(variants):
                    yield pytest.param(raw, data, horizon, settings,
                                       id=f"{name}/{raw['sku']}/h{horizon}/s{index}")


CASES = list(comparison_cases())


@pytest.mark.parametrize("raw,data,horizon,settings", CASES)
def test_frozen_forecast_matches_04d15a9_and_policy_dates_match_guidance(legacy_engine, raw, data, horizon, settings):
    args = (raw, data["months"], data["as_of"], horizon, settings, "2026-11-12")
    assert_forecast_frozen(engine.forecast(*args), legacy_engine.forecast(*args),
                           engine, raw, data['as_of'], '2026-11-12', settings)


def test_legacy_comparison_corpus_size():
    assert len(CASES) == 468  # sample + all eight ERP examples × 12 horizons × 3 settings
