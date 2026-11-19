#!/usr/bin/env python3
"""Generate synthetic, deterministic Smart Excel import regression inputs.

Stdlib only: /usr/bin/python3 scripts/generate_smart_import_fixtures.py
Read-only verification: append --check. No application code is imported.
Expected files assert fixture intent, not a claim that an importer supports it.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import zipfile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures" / "smart-import"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"m": MAIN, "r": REL}
STAMP = (2026, 1, 1, 0, 0, 0)
MONTHS = ["2026-01", "2026-02", "2026-03"]
HEADERS = ["Item Code", "Item Name", "UoM", "Qty On Hand", "Lead Time",
           "Supplier", "Jan 2026", "2026-02", "March"]
ROWS = [
    ["A-001", "Synthetic Widget A", "units", 12, 14, "Synthetic Supply A", 3, 6, 9],
    ["B-002", "Synthetic Widget B", "units", 8, 21, "Synthetic Supply B", 2, 4, 6],
]


def element(tag, attrs=None, text=None):
    node = ET.Element(tag, attrs or {})
    node.text = text
    return node


def xml(node):
    return ET.tostring(node, encoding="utf-8", xml_declaration=True)


def column(index):
    result = ""
    while index:
        index, rem = divmod(index - 1, 26)
        result = chr(65 + rem) + result
    return result


def excel_serial(iso, date1904=False):
    date = dt.date.fromisoformat(iso)
    if date1904:
        return (date - dt.date(1904, 1, 1)).days
    # Excel's fictitious 1900-02-29 shifts modern dates by one day.
    days = (date - dt.date(1899, 12, 31)).days
    return days + (date >= dt.date(1900, 3, 1))


def date_cell(iso, style=1, date1904=False):
    return {"value": excel_serial(iso, date1904), "style": style}


def sheet(name, rows, merges=()):
    return {"name": name, "rows": rows, "merges": list(merges)}


def canonical_items(arabic=False, supplier=True):
    names = ["صنف تجريبي أ", "صنف تجريبي ب"] if arabic else [r[1] for r in ROWS]
    result = []
    for row, name in zip(ROWS, names):
        item = {"sku": row[0], "name": name, "unit": row[2],
                "on_hand": row[3], "supplier_days": row[4],
                "monthly_sales": row[6:]}
        if supplier:
            item["supplier"] = row[5]
        result.append(item)
    return result


def mappings(name, header_row, headers, field_columns, sales_columns=None):
    result = {"sheet": name, "header_row": header_row,
              "headers": headers, "fields": {
                  field: {"column": column(index), "header": headers[index - 1]}
                  for field, index in field_columns.items()}}
    if sales_columns:
        result["monthly_sales"] = [
            {"column": column(index), "header": headers[index - 1], "month": month}
            for index, month in sales_columns]
    return result


def wide_mapping(name="Inventory", header_row=1, headers=None):
    return mappings(name, header_row, headers or HEADERS,
                    {"sku": 1, "name": 2, "unit": 3, "on_hand": 4,
                     "supplier_days": 5, "supplier": 6},
                    [(7, MONTHS[0]), (8, MONTHS[1]), (9, MONTHS[2])])


def scenario(identifier, sheets, expected_mappings, layout="wide_months",
             notes=(), compression="DEFLATE", date1904=False, items=None,
             ignored_rows=(), unmatched=None, missing=None):
    expected = {"schema_version": 1, "fixture": identifier + ".xlsx",
                "expected_layout": layout,
                "expected_product_count": 0 if missing else len(canonical_items() if items is None else items),
                "mappings": expected_mappings, "notes": list(notes),
                "ignored_rows": list(ignored_rows),
                "expected_scenario": None if missing else {
                    "months": MONTHS, "items": canonical_items() if items is None else items}}
    if missing:
        expected["missing"] = missing
    if unmatched:
        expected["unmatched_skus"] = unmatched
    return {"id": identifier, "sheets": sheets, "expected": expected,
            "compression": compression, "date1904": date1904}


def scenarios():
    cases = []
    cases.append(scenario(
        "stored_mixed_cells", [sheet("Inventory", [HEADERS + ["Active"],
            ROWS[0] + [True], ROWS[1] + [False]])], [wide_mapping(headers=HEADERS + ["Active"])],
        compression="STORE", items=canonical_items()[:1], ignored_rows=[{"sheet":"Inventory","row":3,"reason":"inactive in ERP"}], notes=["Active is a boolean; FALSE marks B-002 inactive and excludes it from planning.",
            "Includes shared strings, inline strings, numeric and boolean cells."]))
    cases.append(scenario(
        "title_rows", [sheet("Inventory", [["SYNTHETIC inventory export"],
            ["Fictional example only; reporting year 2026"], [], HEADERS] + ROWS)],
        [wide_mapping(header_row=4)],
        notes=["Rows 1-3 are preamble; physical header row is 4."]))
    cases.append(scenario(
        "wide_months", [sheet("Inventory", [HEADERS] + ROWS)], [wide_mapping()],
        notes=["March inherits 2026 from Jan 2026 and 2026-02, not the clock."]))

    long_headers = HEADERS[:6] + ["Date", "Quantity Sold", "Transaction ID"]
    long_rows = []
    for row in ROWS:
        for month_index, total in enumerate(row[6:]):
            # Two January transactions must aggregate rather than overwrite.
            chunks = [1, total - 1] if month_index == 0 else [total]
            for part, qty in enumerate(chunks):
                date = "2026-{:02d}-{:02d}".format(month_index + 1, 5 + part)
                long_rows.append(row[:6] + [date, qty,
                    "{}-{}-{}".format(row[0], month_index + 1, part + 1)])
    long_map = mappings("Transactions", 1, long_headers,
        {"sku": 1, "name": 2, "unit": 3, "on_hand": 4, "supplier_days": 5,
         "supplier": 6, "date": 7, "quantity": 8, "transaction_id": 9})
    cases.append(scenario(
        "long_transactions", [sheet("Transactions", [long_headers] + long_rows)],
        [long_map], layout="long_transactions", notes=[
            "Group sales by SKU and calendar month; sum separate January transactions.",
            "Repeated stock is a snapshot attribute, not additive transaction stock."]))

    stock_headers = HEADERS[:5]
    sales_headers = ["Item Code", "Jan 2026", "2026-02", "March"]
    supplier_headers = ["Item Code", "Supplier", "Lead Time"]
    cases.append(scenario(
        "three_sheet_join", [sheet("Stock", [stock_headers] + [r[:5] for r in ROWS]),
            sheet("Sales", [sales_headers] + [[r[0]] + r[6:] for r in ROWS]
                  + [["UNMATCHED-999", 99, 99, 99]]),
            sheet("Suppliers", [supplier_headers] + [[r[0], r[5], r[4]] for r in ROWS]
                  + [["UNMATCHED-999", "Synthetic Orphan Supplier", 99]])],
        [mappings("Stock", 1, stock_headers,
                  {"sku": 1, "name": 2, "unit": 3, "on_hand": 4, "supplier_days": 5}),
         mappings("Sales", 1, sales_headers, {"sku": 1},
                  [(2, MONTHS[0]), (3, MONTHS[1]), (4, MONTHS[2])]),
         mappings("Suppliers", 1, supplier_headers,
                  {"sku": 1, "supplier": 2, "supplier_days": 3})],
        layout="multi_sheet_join", unmatched={"Sales": ["UNMATCHED-999"],
            "Suppliers": ["UNMATCHED-999"]}, notes=[
            "Stock is the product universe; join on exact SKU, never row position.",
            "Report unmatched related SKUs; do not invent stock products."]))
    # Reverse related tables: an incorrect positional join must not accidentally pass.
    for tab in cases[-1]["sheets"][1:]:
        tab["rows"][1:] = list(reversed(tab["rows"][1:]))

    odoo_headers = ["Internal Reference", "Name", "Unit of Measure",
                    "On Hand", "Vendor Lead Time", "Vendor"] + HEADERS[6:]
    cases.append(scenario("odoo_headers", [sheet("Products", [odoo_headers] + ROWS)],
                          [wide_mapping("Products", headers=odoo_headers)],
                          notes=["Fictional Odoo-style export; no live ERP data."]))
    arabic_headers = ["الصنف", "اسم الصنف", "UoM", "الكمية", "Lead Time", "المورد"] + HEADERS[6:]
    arabic_rows = [list(r) for r in ROWS]
    arabic_rows[0][1], arabic_rows[1][1] = "صنف تجريبي أ", "صنف تجريبي ب"
    cases.append(scenario("arabic_headers", [sheet("المخزون", [arabic_headers] + arabic_rows)],
        [wide_mapping("المخزون", headers=arabic_headers)], items=canonical_items(arabic=True),
        notes=["الصنف means SKU; اسم الصنف means name; الكمية means stock; المورد means supplier."]))
    cases.append(scenario("totals_merged_title", [sheet("Inventory", [
        ["SYNTHETIC totals report"], [], HEADERS] + ROWS + [
        ["Total", "", "", 20, "", "", 5, 10, 15],
        ["Grand Total", "", "", 20, "", "", 5, 10, 15]], ["A1:I1"])],
        [wide_mapping(header_row=3)], ignored_rows=[
            {"sheet": "Inventory", "row": 6, "reason": "total"},
            {"sheet": "Inventory", "row": 7, "reason": "grand total"}],
        notes=["Ignore merged title and summary rows; never count totals as products."]))

    mixed_rows = []
    for index, row in enumerate(long_rows):
        copy = list(row)
        if index % 3 != 2:
            copy[6] = date_cell(copy[6], style=1 if index % 3 == 0 else 2)
        mixed_rows.append(copy)
    cases.append(scenario("dates_serial_text", [sheet("Transactions", [long_headers] + mixed_rows)],
        [long_map], layout="long_transactions", notes=[
            "Date column mixes ISO text with numeric Excel serial dates.",
            "Style 1 is built-in numFmtId 14; style 2 is custom yyyy-mm-dd.",
            "Use the 1900 date system; never interpret serials as Unix milliseconds."]))
    serial_headers = HEADERS[:6] + [date_cell("2026-01-01", 1),
                                    date_cell("2026-02-01", 2), "March"]
    header_map = wide_mapping(headers=HEADERS[:6] + ["2026-01-01", "2026-02-01", "March"])
    cases.append(scenario("date_headers_serial", [sheet("Inventory", [serial_headers] + ROWS)],
        [header_map], notes=["G1 and H1 are styled numeric date headers; I1 inherits year 2026."]))
    rows1904 = []
    for row in long_rows:
        copy = list(row)
        copy[6] = date_cell(copy[6], style=2, date1904=True)
        rows1904.append(copy)
    cases.append(scenario("date_system_1904", [sheet("Transactions", [long_headers] + rows1904)],
        [long_map], layout="long_transactions", date1904=True,
        notes=["Workbook date1904=1; serial zero is 1904-01-01, not 1899-12-30."]))
    for identifier, quantity_header in [("fuzzy_qty_pcs", "Qty (pcs)"), ("fuzzy_qoh", "QOH")]:
        headers = HEADERS[:]
        headers[3] = quantity_header
        cases.append(scenario(identifier, [sheet("Inventory", [headers] + ROWS)],
            [wide_mapping(headers=headers)], notes=[
                "Deliberate fuzzy-only stock header; review proposal before confirmation."]))
    bad_headers = ["Warehouse", "Bin", "Qty On Hand"]
    cases.append(scenario("unusable_no_sku", [sheet("Notes", [bad_headers,
        ["Synthetic North", "N1", 12], ["Synthetic South", "S2", 8]])],
        [mappings("Notes", 1, bad_headers, {"on_hand": 3})], layout="unusable",
        missing=["sku"], notes=[
            "No product identifiers or product names; must block, not fabricate SKU."]))
    return cases


def workbook(case):
    """Emit the small macro-free OOXML subset used by the regression corpus."""
    strings, lookup = [], {}
    text_count = 0

    def shared(value):
        if value not in lookup:
            lookup[value] = len(strings)
            strings.append(value)
        return lookup[value]

    parts = []
    for number, tab in enumerate(case["sheets"], 1):
        root = element("worksheet", {"xmlns": MAIN})
        width = max(len(row) for row in tab["rows"])
        root.append(element("dimension", {"ref": "A1:{}{}".format(column(width), len(tab["rows"]))}))
        data = ET.SubElement(root, "sheetData")
        for row_number, row in enumerate(tab["rows"], 1):
            row_xml = ET.SubElement(data, "row", {"r": str(row_number)})
            for col, raw in enumerate(row, 1):
                if raw is None or raw == "":
                    continue
                style = raw.get("style", 0) if isinstance(raw, dict) else 0
                value = raw["value"] if isinstance(raw, dict) else raw
                attrs = {"r": "{}{}".format(column(col), row_number)}
                if style:
                    attrs["s"] = str(style)
                cell = ET.SubElement(row_xml, "c", attrs)
                if isinstance(value, bool):
                    cell.set("t", "b")
                    ET.SubElement(cell, "v").text = "1" if value else "0"
                elif isinstance(value, (int, float)):
                    ET.SubElement(cell, "v").text = str(value)
                elif isinstance(value, str):
                    text_count += 1
                    # Both encodings occur even in the smallest valid workbook.
                    if text_count % 2:
                        cell.set("t", "s")
                        ET.SubElement(cell, "v").text = str(shared(value))
                    else:
                        cell.set("t", "inlineStr")
                        inline = ET.SubElement(cell, "is")
                        ET.SubElement(inline, "t").text = value
                else:
                    raise TypeError(value)
        if tab["merges"]:
            merges = ET.SubElement(root, "mergeCells", {"count": str(len(tab["merges"]))})
            for ref in tab["merges"]:
                ET.SubElement(merges, "mergeCell", {"ref": ref})
        parts.append(("xl/worksheets/sheet{}.xml".format(number), xml(root)))

    sst = element("sst", {"xmlns": MAIN, "count": str(sum(
        1 for _, payload in parts for cell in ET.fromstring(payload).findall(".//m:c", NS)
        if cell.get("t") == "s")), "uniqueCount": str(len(strings))})
    for value in strings:
        ET.SubElement(ET.SubElement(sst, "si"), "t").text = value
    parts.append(("xl/sharedStrings.xml", xml(sst)))

    styles = element("styleSheet", {"xmlns": MAIN})
    fmts = ET.SubElement(styles, "numFmts", {"count": "1"})
    ET.SubElement(fmts, "numFmt", {"numFmtId": "164", "formatCode": "yyyy-mm-dd"})
    fonts = ET.SubElement(styles, "fonts", {"count": "1"})
    font = ET.SubElement(fonts, "font")
    ET.SubElement(font, "sz", {"val": "11"})
    ET.SubElement(font, "name", {"val": "Arial"})
    fills = ET.SubElement(styles, "fills", {"count": "2"})
    for pattern in ("none", "gray125"):
        ET.SubElement(ET.SubElement(fills, "fill"), "patternFill", {"patternType": pattern})
    borders = ET.SubElement(styles, "borders", {"count": "1"})
    border = ET.SubElement(borders, "border")
    for side in ("left", "right", "top", "bottom", "diagonal"):
        ET.SubElement(border, side)
    base = ET.SubElement(styles, "cellStyleXfs", {"count": "1"})
    xf = {"numFmtId": "0", "fontId": "0", "fillId": "0", "borderId": "0"}
    ET.SubElement(base, "xf", xf)
    xfs = ET.SubElement(styles, "cellXfs", {"count": "3"})
    for fmt in (0, 14, 164):
        ET.SubElement(xfs, "xf", dict(xf, numFmtId=str(fmt), xfId="0",
                                      applyNumberFormat="1" if fmt else "0"))
    names = ET.SubElement(styles, "cellStyles", {"count": "1"})
    ET.SubElement(names, "cellStyle", {"name": "Normal", "xfId": "0", "builtinId": "0"})
    parts.append(("xl/styles.xml", xml(styles)))

    book = element("workbook", {"xmlns": MAIN, "xmlns:r": REL})
    ET.SubElement(book, "workbookPr", {"date1904": "1" if case["date1904"] else "0"})
    tabs = ET.SubElement(book, "sheets")
    relationships = element("Relationships", {"xmlns": PKG})
    for number, tab in enumerate(case["sheets"], 1):
        ET.SubElement(tabs, "sheet", {"name": tab["name"], "sheetId": str(number),
                                     "r:id": "rId{}".format(number)})
        ET.SubElement(relationships, "Relationship", {"Id": "rId{}".format(number),
            "Type": REL + "/worksheet", "Target": "worksheets/sheet{}.xml".format(number)})
    for offset, kind in enumerate(("styles", "sharedStrings"), len(case["sheets"]) + 1):
        ET.SubElement(relationships, "Relationship", {"Id": "rId{}".format(offset),
            "Type": REL + "/" + kind, "Target": kind + ".xml"})
    parts.extend([("xl/workbook.xml", xml(book)),
                  ("xl/_rels/workbook.xml.rels", xml(relationships))])
    package_rels = element("Relationships", {"xmlns": PKG})
    ET.SubElement(package_rels, "Relationship", {"Id": "rId1", "Type": REL + "/officeDocument",
                                                "Target": "xl/workbook.xml"})
    parts.append(("_rels/.rels", xml(package_rels)))
    types = element("Types", {"xmlns": CONTENT})
    ET.SubElement(types, "Default", {"Extension": "rels",
        "ContentType": "application/vnd.openxmlformats-package.relationships+xml"})
    ET.SubElement(types, "Default", {"Extension": "xml", "ContentType": "application/xml"})
    for part, kind in [("xl/workbook.xml", "sheet.main"), ("xl/styles.xml", "styles"),
                        ("xl/sharedStrings.xml", "sharedStrings")] + [
            ("xl/worksheets/sheet{}.xml".format(n), "worksheet")
            for n in range(1, len(case["sheets"]) + 1)]:
        ET.SubElement(types, "Override", {"PartName": "/" + part,
            "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml." + kind + "+xml"})
    parts.append(("[Content_Types].xml", xml(types)))

    output = io.BytesIO()
    compression = zipfile.ZIP_STORED if case["compression"] == "STORE" else zipfile.ZIP_DEFLATED
    with zipfile.ZipFile(output, "w") as archive:
        for name, payload in sorted(parts):
            info = zipfile.ZipInfo(name, date_time=STAMP)
            info.compress_type = compression
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, payload, compress_type=compression, compresslevel=9)
    return output.getvalue()


def verify_intent(tables, expected):
    """Apply explicit oracle coordinates, without guessing headers like a parser.

    This checks that generated data really supports the independent scenario
    expectation. It does not test application detection or mapping heuristics.
    """
    products = {}
    unmatched = {}
    ignored = {(r["sheet"], r["row"]) for r in expected.get("ignored_rows", [])}
    number_fields = {"on_hand", "supplier_days"}
    for mapping in expected["mappings"]:
        name = mapping["sheet"]
        rows = tables[name]
        header = rows[mapping["header_row"] - 1]
        assert header == mapping["headers"], (expected["fixture"], name, header)
        fields = mapping["fields"]
        if "sku" not in fields:
            assert expected.get("missing") == ["sku"]
            continue
        indices = {field: sum((ord(c) - 64) * 26 ** power
                            for power, c in enumerate(reversed(info["column"]))) - 1
                   for field, info in fields.items()}
        for row_number, row in enumerate(rows[mapping["header_row"]:], mapping["header_row"] + 1):
            if not row or (name, row_number) in ignored:
                continue
            sku = row[indices["sku"]]
            if sku not in products:
                if "on_hand" not in fields:
                    unmatched.setdefault(name, set()).add(sku)
                    continue
                products[sku] = {"sku": sku, "monthly_sales": [0, 0, 0]}
            product = products[sku]
            for field, index in indices.items():
                if field in ("sku", "date", "quantity", "transaction_id"):
                    continue
                value = int(row[index]) if field in number_fields else row[index]
                # Repeated transaction attributes must agree, never be added.
                if field in product:
                    assert product[field] == value
                product[field] = value
            for sales in mapping.get("monthly_sales", []):
                index = sum((ord(c) - 64) * 26 ** power
                            for power, c in enumerate(reversed(sales["column"]))) - 1
                month = MONTHS.index(sales["month"])
                product["monthly_sales"][month] += int(row[index])
            if "date" in fields:
                date = dt.date.fromisoformat(row[indices["date"]])
                month = MONTHS.index(date.strftime("%Y-%m"))
                product["monthly_sales"][month] += int(row[indices["quantity"]])
    assert {name: sorted(skus) for name, skus in unmatched.items()} == expected.get("unmatched_skus", {})
    assert len(products) == expected["expected_product_count"]
    if expected["expected_scenario"] is not None:
        assert [products[sku] for sku in sorted(products)] == expected["expected_scenario"]["items"], expected["fixture"]
    else:
        assert not products


def verify_workbook(payload, case):
    """Independently decode emitted cells and assert source values and metadata.

    ElementTree sees only XML generated above in this process, never untrusted
    uploads. This stdlib-only fixture tool is not an application XML parser.
    """
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert archive.testzip() is None
        assert all(info.date_time == STAMP for info in archive.infolist())
        compression = zipfile.ZIP_STORED if case["compression"] == "STORE" else zipfile.ZIP_DEFLATED
        assert {info.compress_type for info in archive.infolist()} == {compression}
        for name in archive.namelist():
            ET.fromstring(archive.read(name))
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        properties = book.find("m:workbookPr", NS)
        assert properties is not None
        assert properties.get("date1904") == ("1" if case["date1904"] else "0")
        assert [tab.get("name") for tab in book.findall("m:sheets/m:sheet", NS)] == [s["name"] for s in case["sheets"]]
        strings = ["".join(node.itertext()) for node in
                   ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        styles = ET.fromstring(archive.read("xl/styles.xml"))
        assert [int(n.attrib["numFmtId"]) for n in styles.findall("m:cellXfs/m:xf", NS)] == [0, 14, 164]
        custom_format = styles.find("m:numFmts/m:numFmt", NS)
        assert custom_format is not None
        assert custom_format.get("formatCode") == "yyyy-mm-dd"
        count = 0
        decoded_tables = {}
        for number, tab in enumerate(case["sheets"], 1):
            root = ET.fromstring(archive.read("xl/worksheets/sheet{}.xml".format(number)))
            actual = {}
            for cell in root.findall("m:sheetData/m:row/m:c", NS):
                kind = cell.get("t")
                raw = cell.findtext("m:v", namespaces=NS)
                if kind == "s":
                    assert raw is not None
                    value = strings[int(raw)]
                elif kind == "inlineStr":
                    inline = cell.find("m:is", NS)
                    assert inline is not None
                    value = "".join(inline.itertext())
                elif kind == "b":
                    value = raw == "1"
                else:
                    assert raw is not None
                    value = float(raw)
                actual[cell.get("r")] = (value, int(cell.get("s", "0")))
            expected = {}
            for row_number, row in enumerate(tab["rows"], 1):
                for col, value in enumerate(row, 1):
                    if value is not None and value != "":
                        style = value.get("style", 0) if isinstance(value, dict) else 0
                        value = value["value"] if isinstance(value, dict) else value
                        expected["{}{}".format(column(col), row_number)] = (value, style)
            assert actual == expected, (case["id"], tab["name"])
            assert [node.get("ref") for node in root.findall("m:mergeCells/m:mergeCell", NS)] == tab["merges"]
            decoded_rows = []
            for row_number, source_row in enumerate(tab["rows"], 1):
                row = []
                for col in range(1, len(source_row) + 1):
                    value, style = actual.get("{}{}".format(column(col), row_number), ("", 0))
                    if style in (1, 2):
                        # Independent inverse for the modern dates in this corpus.
                        epoch = dt.date(1904, 1, 1) if case["date1904"] else dt.date(1899, 12, 30)
                        value = (epoch + dt.timedelta(days=value)).isoformat()
                    row.append(value)
                decoded_rows.append(row)
            decoded_tables[tab["name"]] = decoded_rows
            count += len(actual)
        verify_intent(decoded_tables, case["expected"])
        return count


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def artifacts():
    files, entries = {}, []
    cell_count = 0
    for case in scenarios():
        filename = case["id"] + ".xlsx"
        payload = workbook(case)
        cell_count += verify_workbook(payload, case)
        files[filename] = payload
        expected_name = case["id"] + ".expected.json"
        files[expected_name] = json_bytes(case["expected"])
        expected = case["expected"]
        entry = {"filename": filename, "expected_file": expected_name,
                 "expected_layout": expected["expected_layout"],
                 "expected_product_count": expected["expected_product_count"],
                 "important_mappings": expected["mappings"],
                 "compression": case["compression"], "date1904": case["date1904"],
                 "sha256": hashlib.sha256(payload).hexdigest()}
        if "missing" in expected:
            entry["missing"] = expected["missing"]
        entries.append(entry)
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerows([["SYNTHETIC inventory export"],
                      ["Fictional example only; reporting year 2026"], [], HEADERS] + ROWS)
    csv_name = "messy_title.csv"
    files[csv_name] = buffer.getvalue().encode("utf-8")
    expected = {"schema_version": 1, "fixture": csv_name, "expected_layout": "wide_months",
                "expected_product_count": 2, "mappings": [wide_mapping("CSV", 4)],
                "notes": ["Skip title, note and blank rows; header is physical row 4."],
                "expected_scenario": {"months": MONTHS, "items": canonical_items()}}
    files["messy_title.expected.json"] = json_bytes(expected)
    verify_intent({"CSV": list(csv.reader(io.StringIO(buffer.getvalue())))}, expected)
    entries.append({"filename": csv_name, "expected_file": "messy_title.expected.json",
        "expected_layout": "wide_months", "expected_product_count": 2,
        "important_mappings": expected["mappings"],
        "sha256": hashlib.sha256(files[csv_name]).hexdigest()})
    manifest = {"schema_version": 1, "synthetic": True,
        "generator": "scripts/generate_smart_import_fixtures.py", "fixture_count": len(entries),
        "assertion_scope": "Independent fixture intent; not generated from importer results.",
        "conventions": {"rows": "Physical one-based rows", "columns": "Excel letters",
            "reference_year": 2026, "stock": "Snapshot, never summed across transactions",
            "sales": "Historical fulfilled quantities in units, not forecasts",
            "missing_sku": "Block unusable input; never fabricate product identifiers",
            "inactive_products": "An explicit FALSE Active flag excludes a product; never used as quantity",
            "as_of": "Unspecified: compare months/items only; do not assert clock-derived dates"},
        "fixtures": entries}
    assert len(entries) >= 10
    assert len({entry["filename"] for entry in entries}) == len(entries)
    for entry in entries:
        expected = json.loads(files[entry["expected_file"]])
        if expected["expected_scenario"]:
            items = expected["expected_scenario"]["items"]
            count = 1 if entry["filename"] == "stored_mixed_cells.xlsx" else 2
            assert len(items) == entry["expected_product_count"] == count
            assert [item["sku"] for item in items] == ["A-001", "B-002"][:count]
            assert [item["on_hand"] for item in items] == [12, 8][:count]
            assert [item["supplier_days"] for item in items] == [14, 21][:count]
            assert [item["monthly_sales"] for item in items] == [[3, 6, 9], [2, 4, 6]][:count]
    files["manifest.json"] = json_bytes(manifest)
    files["README.md"] = (
        "# Synthetic Smart Excel import fixtures\n\n"
        "All names, SKUs, quantities and suppliers are fictional. No network or live data.\n\n"
        "Regenerate with `/usr/bin/python3 scripts/generate_smart_import_fixtures.py`; "
        "verify without writes by adding `--check`. Requires Python standard library only.\n\n"
        "`manifest.json` enumerates each input and independently intended mappings. "
        "Each `.expected.json` carries its canonical months/items oracle and physical "
        "header coordinates. These files describe acceptance intent, not importer output "
        "or a confirmation that any current parser supports these layouts. Mapping JSON "
        "is deliberately importer-independent; importer-specific proposal fields can be "
        "derived by the consumer while retaining this oracle.\n\n"
        "Most cases normalize to exactly A-001/B-002, stock 12/8, supplier lead time "
        "14/21 days, and January–March 2026 sales [3,6,9]/[2,4,6]. Long-layout stock "
        "is repeated metadata, not additive. The join starts from Stock and reports "
        "UNMATCHED-999 without creating it. The missing-SKU workbook must be blocked.\n\n"
        "OOXML includes STORE and DEFLATE ZIPs, fixed member timestamps and permissions, "
        "shared and inline text, numeric and boolean cells, date styles 14/164, 1900/1904 "
        "date systems, and a merged title. There are no formulas, macros, external links "
        "or volatile generation timestamps. Native Excel rendering is not asserted.\n"
    ).encode("utf-8")
    return files, len(entries), cell_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify checked-in bytes without writing")
    args = parser.parse_args()
    files, fixture_count, cell_count = artifacts()
    if args.check:
        differences = [name for name, content in files.items()
                       if not (OUT / name).is_file() or (OUT / name).read_bytes() != content]
        extra = sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*")
                       if p.is_file() and str(p.relative_to(OUT)) not in files)
        if differences or extra:
            raise SystemExit("Fixture drift: {} ; unexpected files: {}".format(differences, extra))
    else:
        OUT.mkdir(parents=True, exist_ok=True)
        for name, content in sorted(files.items()):
            (OUT / name).write_bytes(content)
    print(json.dumps({"status": "verified" if args.check else "generated_and_verified",
                      "fixtures": fixture_count, "xlsx": fixture_count - 1, "csv": 1,
                      "artifacts": len(files), "decoded_xlsx_cells": cell_count,
                      "output": str(OUT)}, sort_keys=True))


if __name__ == "__main__":
    main()
