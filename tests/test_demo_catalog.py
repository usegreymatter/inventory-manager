"""Local-only contracts for the deterministic synthetic standalone demo."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(relative):
    spec = importlib.util.spec_from_file_location(Path(relative).stem, ROOT / relative)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


generator = load("scripts/make_demo_catalog.py")
builder = load("standalone/build.py")


class DemoCatalogTests(unittest.TestCase):
    def test_committed_catalog_is_deterministic(self):
        first = generator.make_catalog()
        self.assertEqual(first, generator.make_catalog())
        self.assertEqual(first, json.loads((ROOT / "data/demo-1000.json").read_text()))

    def test_catalog_shape_and_missing_data_are_intentional(self):
        data = generator.make_catalog()
        items = data["items"]
        self.assertEqual(len(items), 1000)
        self.assertEqual(len({i["sku"] for i in items}), 1000)
        self.assertEqual(len({i["category"] for i in items}), 8)
        self.assertEqual(len({i["supplier"] for i in items if i["supplier"]}), 15)
        self.assertEqual(sum(not i["supplier"] for i in items), 50)
        self.assertEqual(sum("unit_cost" in i for i in items), 850)
        self.assertEqual(sum(i["on_hand"] is None for i in items), 20)
        self.assertEqual(len(data["months"]), 24)
        self.assertTrue(all(len(i["monthly_sales"]) == 24 for i in items))
        self.assertTrue(all(i["minimum_order"] >= i["pack_size"] > 0 and i["minimum_order"] % i["pack_size"] == 0 for i in items))
        self.assertTrue(any(i["receipts"] for i in items))
        self.assertTrue(any(i["on_order"] > 0 for i in items))
        self.assertEqual({i["unit"] for i in items}, {"units", "m", "kg", "box", "roll"})

    def test_purchase_packs_match_the_named_base_unit(self):
        for item in generator.make_catalog()["items"]:
            category = item["category"]
            if category in ("Grout", "Waterproofing"):
                expected = int(item["name"].split(", ")[1].split()[0])
            elif category == "Sealants":
                expected = 12  # A carton of individually stocked cartridges.
            elif category == "Trims":
                expected = 3  # Stocked in metres, bought in 3 m lengths.
                self.assertIn("3 m length", item["name"])
            else:
                expected = 1  # A named bag, tile box, underlay roll or tool.
            self.assertEqual(item["pack_size"], expected, item["sku"])
            self.assertEqual(item["minimum_order"] % expected, 0)
            self.assertEqual(item["on_order"] % expected, 0)
            self.assertTrue(all(q % expected == 0 for q in item["receipts"].values()))
            self.assertTrue(all(q % expected == 0 for q in item["historical_receipts"].values()))

    def test_safety_band_remains_visible_without_a_suggested_order(self):
        import shutil
        import subprocess
        source = (ROOT / "standalone/design/chart-focus-gm-b.js").read_text()
        self.assertIn("function drawSafetyStock", source)
        draw = source[source.index("function drawSafetyStock"):source.index("function drawSuggestedOrder")]
        probe = r"""
const marks=[];
function svgNode(tag,attrs,text){return {tag,attrs,text}}
const svg={append(el){marks.push(el)},prepend(el){marks.unshift(el)}};
const c={svg,left:40,right:640,top:96,bottom:400,y:v=>400-v*3};
for(const safety_stock of [0,50,100,null,-1]){
 marks.length=0;drawSafetyStock(c,{guidance:{quantity:0,safety_stock}});
 const band=marks.find(m=>m.attrs['data-safety-band']);
 if(safety_stock===null||safety_stock<0){if(band)throw Error('invalid threshold shown');continue}
 if(!band||!(band.attrs.height>0)||band.attrs.y<c.top||band.attrs.y+band.attrs.height>c.bottom)throw Error('missing or unclipped band');
 if(!marks.some(m=>m.attrs['data-safety-label']&&m.text==='Safety stock'))throw Error('missing label');
}
"""
        result = subprocess.run([shutil.which("node") or "node", "-"], input=draw + probe,
                                text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        wrapper = source[source.index("const largeSvgBase"):source.index("const largeChartBase")]
        self.assertIn("drawSafetyStock(c,row)", wrapper)

    def test_demo_is_additive_and_core_is_exact(self):
        sample = builder.build()
        demo = builder.build(data=generator.make_catalog())
        core = builder.extract_core((ROOT / "desktop/plugin.js").read_text())
        self.assertEqual(demo.count(core), 1)
        self.assertEqual(sample.count(core), 1)
        self.assertNotIn("const STANDALONE_DEMO_DATA=", sample)
        self.assertIn("Synthetic demo data (1,000 products)", demo)
        self.assertIn("let data=STANDALONE_DEMO_DATA,sourceName='demo'", demo)
        self.assertIn("data = SAMPLE", demo)  # Built-in sample-reset route is retained.
        self.assertEqual(builder.build(), sample)

    def test_build_escapes_script_terminators(self):
        data = generator.make_catalog()
        data["items"][0]["name"] = "</script><script>alert('fixture')</script>"
        demo = builder.build(data=data)
        self.assertNotIn("</script><script>alert", demo)
        self.assertEqual(demo.count("</script>"), 1)

    def test_malformed_data_fails_closed(self):
        for data in ({}, {"items": []}, {"items": [{}], "months": ["2026-01"]}):
            with self.assertRaises(ValueError):
                builder.build(data=data)


if __name__ == "__main__":
    unittest.main()
