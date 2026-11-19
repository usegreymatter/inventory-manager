#!/usr/bin/env python3
"""Generate a fixed, wholly fictional construction catalogue (stdlib only).

Run from any directory: /usr/bin/python3 scripts/make_demo_catalog.py
The snapshot and decision date are deliberately fixed; no clock, ERP, network,
engine imports, or forecast reimplementation is involved. Stock cover is a
fixture choice, not a promise about the planner's status on future dates.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[1]
SEED = 20261117
AS_OF = "2026-10-31"
DECISION_DATE = "2026-11-17"
PATTERNS = {"steady": 300, "seasonal": 220, "trending-up": 120,
            "trending-down": 100, "erratic": 100, "new": 60,
            "dead": 50, "discontinued": 50}
# category, SKU prefix, unit, product families, sizes, specifications, cost range
TYPES = (
    ("Sealants", "SEA", "units",
     ("Silicone sealant", "PU sealant", "Acrylic sealant", "Joint filler", "Fire-rated sealant"),
     ("250 ml", "300 ml", "400 ml", "500 ml", "600 ml"),
     ("clear", "white", "grey", "black", "brown"), (0.65, 9.5)),
    ("Grout", "GRT", "kg",
     ("Tile grout", "Epoxy grout", "Pool grout", "Flexible grout", "Repair grout"),
     ("1 kg", "2 kg", "5 kg", "10 kg", "20 kg"),
     ("white", "grey", "beige", "charcoal", "ivory"), (0.4, 12.0)),
    ("Adhesives", "ADH", "units",
     ("Tile adhesive", "Stone adhesive", "Flexible adhesive", "Rapid-set adhesive", "Floor adhesive"),
     ("5 kg", "10 kg", "15 kg", "20 kg", "25 kg"),
     ("white", "grey", "standard", "exterior", "high strength"), (1.2, 18.0)),
    ("Tiles", "TIL", "box",
     ("Porcelain tile", "Ceramic wall tile", "Mosaic tile", "Quarry tile", "Floor tile"),
     ("30 × 30 cm", "30 × 60 cm", "45 × 45 cm", "60 × 60 cm", "60 × 120 cm"),
     ("stone", "sand", "slate", "ivory", "concrete"), (1.8, 24.0)),
    ("Trims", "TRM", "m",
     ("Aluminium edge trim", "Stair nosing", "Expansion trim", "Corner trim", "Threshold trim"),
     ("6 mm", "8 mm", "10 mm", "12 mm", "15 mm"),
     ("silver", "brushed", "white", "black", "bronze"), (0.5, 12.0)),
    ("Underlay", "UND", "roll",
     ("Foam underlay", "Acoustic underlay", "Cork underlay", "Vapour barrier", "Rubber underlay"),
     ("2 mm", "3 mm", "4 mm", "5 mm", "6 mm"),
     ("standard", "premium", "dense", "moisture resistant", "heavy duty"), (1.0, 45.0)),
    ("Tools", "TLS", "units",
     ("Notched trowel", "Grout float", "Tile cutter", "Mixing paddle", "Levelling tool"),
     ("small", "medium", "large", "extra large", "compact"),
     ("standard", "professional", "steel", "lightweight", "heavy duty"), (0.8, 85.0)),
    ("Waterproofing", "WPR", "kg",
     ("Waterproof coating", "Tank slurry", "Membrane compound", "Roof sealant", "Waterproof primer"),
     ("1 kg", "5 kg", "10 kg", "15 kg", "20 kg"),
     ("grey", "white", "black", "flexible", "rapid cure"), (0.65, 9.5)),
)
SUPPLIERS = (
    "Demo Dune Materials", "Demo Harbour Building Supply", "Demo Cedar Trading",
    "Demo Atlas Construction Supply", "Demo Kiln & Quarry", "Demo Copperline Supply",
    "Demo Stonebridge Materials", "Demo Summit Hardware", "Demo Oasis Wholesale",
    "Demo North Pier Trading", "Demo Rivet Supply", "Demo Sandstone Depot",
    "Demo Foundation Materials", "Demo Bluebeam Trading", "Demo Canal Building Supply",
)


def sales_history(rng, base, pattern, phase):
    """Fictional observations, not an alternative forecast implementation."""
    result = []
    for month in range(24):
        noise = rng.uniform(0.87, 1.13)
        if pattern == "steady":
            factor = noise
        elif pattern == "seasonal":
            factor = (1 + 0.48 * math.sin(2 * math.pi * (month + phase) / 12)) * noise
        elif pattern == "trending-up":
            factor = (0.4 + 1.2 * month / 23) * noise
        elif pattern == "trending-down":
            factor = (1.65 - 1.2 * month / 23) * noise
        elif pattern == "erratic":
            factor = rng.choice((0, 0, 0.2, 0.6, 1.4, 2.5, 3.8)) * noise
        elif pattern == "new":
            factor = 0 if month < 21 else (0.6 + (month - 21) * 0.35) * noise
        elif pattern == "dead":
            factor = 0
        else:  # Discontinued line: old sales then a full year without movement.
            factor = noise if month < 12 else 0
        result.append(max(0, round(base * factor)))
    return result


def make_catalog():
    rng = random.Random(SEED)
    patterns = [pattern for pattern, count in PATTERNS.items() for _ in range(count)]
    rng.shuffle(patterns)
    unassigned = set(rng.sample(range(1000), 50))
    with_cost = set(rng.sample(range(1000), 850))
    active = [i for i, p in enumerate(patterns) if p not in ("dead", "discontinued")]
    rng.shuffle(active)
    urgent = set(active[:80])
    soon = set(active[80:180])
    excess = set(active[180:280])
    items = []
    for i, pattern in enumerate(patterns):
        category, prefix, unit, families, sizes, specs, costs = TYPES[i % len(TYPES)]
        variant = i // len(TYPES)
        size = sizes[variant % 5]
        name = f"{families[variant // 25]}, {size}, {specs[(variant // 5) % 5]}"
        if category == "Trims":
            name += ", 3 m length"
        if pattern in ("new", "discontinued"):
            name += " (new line)" if pattern == "new" else " (discontinued)"
        base = rng.choice((18, 35, 60, 120, 250, 480, 900, 1800))
        sales = sales_history(rng, base, pattern, i % 12)
        lead = rng.choice((7, 10, 14, 21, 28, 35, 45, 60, 90))
        # Purchase multiples are expressed in the SAME base unit as stock/cost.
        # kg lines buy one named bag/bucket; metres buy a full trim length;
        # cartridges buy cartons. A tile box/roll/tool/bag is already one unit.
        # Retain the legacy eight-way pack draw in the seeded RNG sequence so
        # fixing packaging does not silently replace unrelated sales/cost fixtures.
        rng.randrange(8)
        pack = (int(size.split()[0]) if unit == "kg" else
                3 if category == "Trims" else
                12 if category == "Sealants" else 1)
        # Missing lead times deliberately inherit the supported default (14 d).
        missing_lead = i % 37 == 0
        effective_lead = 14 if missing_lead else lead
        if i in urgent:
            cover = rng.uniform(0.03, 0.22)
        elif i in soon:
            cover = effective_lead / 30 + rng.uniform(1.2, 1.9)
        elif i in excess:
            cover = rng.uniform(12, 18)
        else:
            cover = rng.uniform(4.5, 8)
        # Use observed volume to diversify balances; the actual core decides status.
        recent = sum(sales[-6:]) / 6
        scale = max(recent, base * 0.35)
        stock = max(0, round(scale * cover))
        if pattern in ("dead", "discontinued"):
            stock = rng.choice((0, 0, pack, pack * 4, pack * 15, base * 3))
        item = {
            "sku": f"{prefix}-{specs[(variant // 5) % 5][:3].upper()}-{variant % 5 + 1:02d}-{variant + 1:03d}", "name": name, "category": category,
            "supplier": "" if i in unassigned else SUPPLIERS[(i * 7 + i // 15) % len(SUPPLIERS)],
            "unit": unit, "on_hand": stock, "supplier_days": None if missing_lead else lead,
            "monthly_sales": sales, "receipts": {}, "on_order": 0,
            "minimum_order": pack * rng.choice((1, 2, 4, 5)), "pack_size": pack,
            "historical_receipts": {},
        }
        if i in with_cost:
            item["unit_cost"] = round(rng.uniform(*costs), 3)
        # Do not double-count the same inbound units: monthly confirmed receipts
        # and undated on_order are different fictional purchases.
        if pattern not in ("dead", "discontinued") and i not in urgent:
            if i % 5 == 0:
                item["receipts"] = {rng.choice(("2026-11", "2026-12", "2027-01")): pack * max(1, round(scale * rng.uniform(0.5, 2) / pack))}
            if i % 7 == 0:
                item["on_order"] = pack * max(1, round(scale * rng.uniform(0.4, 1.5) / pack))
        # Historical deliveries are separate from future supply and are never
        # fed into the forecast as sales or asserted to be real receipts.
        for month, quantity in enumerate(sales):
            item["historical_receipts"][month_label(month)] = (
                pack * max(1, round(quantity * rng.uniform(1.8, 3.2) / pack))
                if quantity > 0 and (month + i) % 3 == 0 else 0)
        # Deliberately incomplete inventory balances exercise Needs data honestly.
        if i % 50 == 0:
            item["on_hand"] = None
        items.append(item)
    return {
        "dataset": "Synthetic construction-supplies catalogue — 1,000 products",
        "note": "Wholly fictional, seeded demonstration data; not real products, suppliers, stock, costs or orders. Costs are illustrative KWD per stated stock unit, not per purchase pack. Purchase packs: sealants in cartons of 12 cartridges; grout/waterproofing in the named kg bag/bucket; trims in 3 m lengths; adhesives per bag, tiles per box, underlay per roll and tools individually. Minimum orders and incoming receipts are multiples of these base-unit pack sizes; sales and remaining stock may include broken packs. Receipt dates are month-granular: receipts uses YYYY-MM; on_order has no promised date. New lines have leading zero sales; discontinued lines have no sales in the last 12 months, not an unsupported engine stop-buy flag. Twenty stock balances are deliberately missing to exercise Needs data. Fixture stock cover is chosen for 17 Nov 2026 with default settings; statuses depend on the planner and decision date/settings.",
        "as_of": AS_OF, "decision_date": DECISION_DATE,
        "months": [month_label(m) for m in range(24)], "items": items,
        # Advisory supplier limits only: never change product packs, costs or quantities.
        # Sized near typical supplier orders so some suppliers fall just short and others meet them.
        "suppliers": [{"name": name, "min_order_value": value, "min_order_qty": qty}
                      for name, value, qty in zip(SUPPLIERS[:5], [100000, 60000, 150000, 40000, 90000], [None, 1000, None, 2000, None])],
    }


def month_label(index):
    year, month = divmod(2024 * 12 + 10 + index, 12)
    return f"{year:04d}-{month + 1:02d}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", "--output", type=Path, default=ROOT / "data/demo-1000.json")
    args = parser.parse_args()
    catalog = make_catalog()
    items = catalog["items"]
    assert len(items) == len({i["sku"] for i in items}) == 1000
    assert len({i["category"] for i in items}) == 8
    assert len({i["supplier"] for i in items if i["supplier"]}) == 15
    assert sum(not i["supplier"] for i in items) == 50
    assert sum("unit_cost" in i for i in items) == 850
    assert all(len(i["monthly_sales"]) == 24 for i in items)
    encoded = (json.dumps(catalog, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(encoded)
    print(json.dumps({"output": str(args.out), "bytes": len(encoded), "products": len(items),
                      "types": dict(Counter(i["category"] for i in items)), "suppliers": 15,
                      "unassigned": 50, "with_unit_cost": 850, "patterns": PATTERNS,
                      "dated_incoming": sum(bool(i["receipts"]) for i in items),
                      "undated_incoming": sum(i["on_order"] > 0 for i in items)}, indent=2))


if __name__ == "__main__":
    main()
