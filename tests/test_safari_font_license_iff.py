"""Source-only font-license regression: render in memory, never write HTML."""
import importlib.util
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("safari_font_license_builder", ROOT / "standalone/build.py")
assert SPEC is not None and SPEC.loader is not None
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class SafariFontLicenseIffTests(unittest.TestCase):
    def test_safari_font_license_notice_and_full_ofl_iff_font_face(self):
        variants = [(name, BUILDER.build(name)) for name in BUILDER.TEMPLATES]
        variants.append(("default", BUILDER.build()))
        demo = json.loads((ROOT / "data/demo-1000.json").read_text(encoding="utf-8"))
        variants.append(("demo-1000", BUILDER.build(data=demo)))
        for name, html in variants:
            with self.subTest(variant=name):
                styles = "\n".join(re.findall(r"<style\b[^>]*>(.*?)</style>", html, re.I | re.S))
                embeds_fonts = bool(re.search(r"@font-face\b", styles, re.I))
                self.assertEqual(embeds_fonts, name == "option-gm-c")
                notice = html.split("-->", 1)[0]
                self.assertTrue(notice.startswith("<!--\nInventory Manager — MIT License,"))
                self.assertEqual("Embedded fonts Poppins and Tajawal:" in notice, embeds_fonts)
                self.assertEqual("SIL Open Font License 1.1" in notice, embeds_fonts)
                for copyright_line in (
                    "Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)",
                    "(c) 2017 by Boutros International. All rights reserved.",
                ):
                    self.assertEqual(copyright_line in notice, embeds_fonts)
                encoded = re.search(
                    r'<script type="application/json" id="stock-runway-distribution-licenses">(.*?)</SCRIPT>',
                    html,
                )
                assert encoded is not None
                documents = json.loads(encoded.group(1))
                expected = {"LICENSE", "THIRD_PARTY_NOTICES.md"}
                if embeds_fonts:
                    expected.add("LICENSES/OFL-1.1.txt")
                self.assertEqual(set(documents), expected)
                for relative, text in documents.items():
                    self.assertEqual(text, (ROOT / relative).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
