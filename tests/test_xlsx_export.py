"""Exercise the dependency-free JS writer with Python's independent ZIP/XML readers."""
import base64
import io
from pathlib import Path
import shutil
import subprocess
import unittest
# Parse only XML produced by our local writer from bounded test fixtures;
# no untrusted documents/DTDs are loaded and no external entities are resolved.
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "standalone/design/xlsx-gm-b.js"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def node(source):
    result = subprocess.run([shutil.which("node") or "node", "-"], input=source,
                            text=True, capture_output=True, cwd=ROOT, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def workbook(source):
    output = node("const fs=require('node:fs'),vm=require('node:vm');\n"
                  + "vm.runInThisContext(fs.readFileSync(" + repr(str(HELPER)) + ", 'utf8'));\n"
                  + source)
    return zipfile.ZipFile(io.BytesIO(base64.b64decode(output)))


def cells(archive, sheet=1):
    root = ET.fromstring(archive.read(f"xl/worksheets/sheet{sheet}.xml"))
    result = []
    for row in root.findall("s:sheetData/s:row", NS):
        result.append([(c.attrib, c.findtext("s:is/s:t", default="", namespaces=NS)
                        if c.get("t") == "inlineStr" else c.findtext("s:v", default="", namespaces=NS))
                       for c in row.findall("s:c", NS)])
    return result


class XlsxExportTests(unittest.TestCase):
    def test_real_stored_zip_relationships_crc_and_determinism(self):
        source = "const bytes=wlXlsxWorkbook([{name:'Purchase order',rows:[['SKU','Quantity'],['001',2.5]]},{name:'All products',rows:[['Name']]}]); console.log(Buffer.from(bytes).toString('base64'));"
        archive = workbook(source)
        self.assertIsNone(archive.testzip())
        self.assertEqual(len(archive.namelist()), len(set(archive.namelist())))
        for entry in archive.infolist():
            self.assertEqual(entry.compress_type, zipfile.ZIP_STORED)
            self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
            ET.fromstring(archive.read(entry))
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        self.assertEqual([s.get("name") for s in book.findall("s:sheets/s:sheet", NS)],
                         ["Purchase order", "All products"])
        relns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
        for path, prefix in (("_rels/.rels", ""), ("xl/_rels/workbook.xml.rels", "xl/")):
            for relation in ET.fromstring(archive.read(path)).findall("r:Relationship", relns):
                target = relation.get("Target")
                assert target is not None
                self.assertIn(prefix + target, archive.namelist())
        self.assertEqual(archive.read("xl/worksheets/sheet1.xml"), workbook(source).read("xl/worksheets/sheet1.xml"))
        again = workbook(source)
        assert isinstance(archive.fp, io.BytesIO) and isinstance(again.fp, io.BytesIO)
        self.assertEqual(archive.fp.getvalue(), again.fp.getvalue())

    def test_cell_types_bold_headers_iso_dates_and_literal_formulas(self):
        archive = workbook("""
const rows=[['SKU','Quantity','Cost','Date','Unsafe'],['001',2.5,0,new Date('2026-11-17T00:00:00Z'),'=1+1'],['+SUM(A1)','@formula','-not-a-number','<tag> & العربية\\u0001','_x00\\u000141_'],[null,NaN,Infinity,-3.125,true]];
console.log(Buffer.from(wlXlsxWorkbook([{name:'Types',rows}])).toString('base64'));
""")
        rows = cells(archive)
        self.assertTrue(all(a.get("s") == "1" for a, _ in rows[0]))
        self.assertEqual(rows[1][0][1], "001")
        self.assertEqual(rows[1][1][1], "2.5")
        self.assertNotIn("t", rows[1][1][0])
        self.assertEqual(rows[1][2][1], "0")
        self.assertEqual(rows[1][3][1], "2026-11-17")
        self.assertEqual(rows[1][4][1], "=1+1")
        self.assertEqual(rows[2][3][1], "<tag> & العربية")
        self.assertEqual(rows[2][4][1], "_x005F_x0041_")
        self.assertTrue(all(value == "" for _, value in rows[3][:3]))
        self.assertEqual(rows[3][3][1], "-3.125")
        root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        self.assertEqual(root.findall(".//s:f", NS), [])
        styles = ET.fromstring(archive.read("xl/styles.xml"))
        self.assertIsNotNone(styles.find("s:fonts/s:font[2]/s:b", NS))
        header_style = styles.find("s:cellXfs/s:xf[2]", NS)
        assert header_style is not None
        self.assertEqual(header_style.get("fontId"), "1")

    def test_wide_sheet_addresses_empty_sheets_and_limits(self):
        archive = workbook("console.log(Buffer.from(wlXlsxWorkbook([{name:'Wide',rows:[Array.from({length:28},(_,i)=>i)]},{name:'Empty',rows:[]}])).toString('base64'));")
        self.assertEqual(cells(archive)[0][26][0]["r"], "AA1")
        self.assertEqual(cells(archive)[0][27][0]["r"], "AB1")
        self.assertEqual(cells(archive, 2), [])
        result = node("const fs=require('node:fs'),vm=require('node:vm');vm.runInThisContext(fs.readFileSync(" + repr(str(HELPER)) + ",'utf8')); for(const sheets of [[],[{name:'bad/name',rows:[]}],[{name:'same',rows:[]},{name:'SAME',rows:[]}],[{name:'wide',rows:[Array(16385).fill(1)]}]]){try{wlXlsxWorkbook(sheets);console.log('accepted')}catch(e){console.log('rejected')}}")
        self.assertEqual(result.splitlines(), ["rejected"] * 4)

    def test_adapter_selected_purchase_order_all_current_products_visible_order(self):
        archive = workbook("""
const currentToday='2026-11-17',settings={};
const make=(sku,supplier,qty,cost)=>({item:{sku,name:'Product '+sku,unit:'m',supplier,cost},bucket:'order',guidance:{quantity:qty,order_by:'now',lead_days:14,runout_date:null}});
const a=make('001','Z Supplier',2.5,1.125),b=make('002','A Supplier',4,0),c=make('003','',3,null),d=make('004','A Supplier',0,5),e=make('005','A Supplier',null,5);
a.guidance.order_by='2026-12-27';a.guidance.lead_days=7;c.guidance.lead_days=null;
const currentRows=[a,b,c,d,e],wlStatus=[['order','Order now']];
function wlOrderGroups(rows){const groups=new Map();for(const r of rows){const s=r.item.supplier;if(!groups.has(s))groups.set(s,[]);groups.get(s).push(r)}return [...groups].sort((a,b)=>Number(!a[0])-Number(!b[0])||a[0].localeCompare(b[0]))}
function wlVisible(){return [['product','Product'],['qty','Order qty'],['status','Status'],['due','Order by'],['runout','Runs out']]}
function wlCompare(a,b){return b.item.sku.localeCompare(a.item.sku)}
function wlValue(r,k){return ({product:r.item.name,qty:r.guidance.quantity,status:0,due:'0000-00-00',runout:'9999-12-31'})[k]}
function resolveOrderSettings(i){return {values:{unit_cost:i.cost}}}
function dateOrdinal(s){return Number.isFinite(Date.parse(s))?Date.parse(s)/86400000:null}
function ordinalDate(n){return new Date(n*86400000).toISOString().slice(0,10)}
function wlDownload(bytes,name,mime){if(name!=='inventory-manager-order.xlsx'||mime!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')throw Error('wrong download');console.log(Buffer.from(bytes).toString('base64'))}
const before=JSON.stringify(currentRows);
wlExcel([a,c,b,d]);
if(JSON.stringify(currentRows)!==before)throw Error('source rows mutated');
""")
        po = cells(archive)
        # Intentional advisory additions get a separate Note column, not changed product quantities.
        self.assertEqual([v for _, v in po[0]], ["Supplier", "SKU", "Name", "Quantity", "Unit", "Unit cost", "Line value", "Requested delivery", "Note"])
        self.assertEqual([r[1][1] for r in po[1:]], ["002", "001", "003"])
        self.assertEqual([v for _, v in po[1]][3:], ["4", "m", "0", "0", "2026-12-01", ""])
        self.assertEqual(po[2][6][1], "2.8125")
        self.assertEqual(po[2][7][1], "2027-01-03")
        self.assertEqual(po[3][5][1], "")
        self.assertEqual(po[3][7][1], "")
        all_products = cells(archive, 2)
        self.assertEqual([v for _, v in all_products[0]], ["Product", "Order qty", "Status", "Order by", "Runs out"])
        self.assertEqual(len(all_products), 6)
        self.assertIn("005", all_products[1][0][1])
        self.assertEqual(all_products[1][2][1], "Order now")
        self.assertEqual(all_products[1][3][1], "2026-11-17")
        self.assertEqual(all_products[1][4][1], "")

    def test_thousand_product_workbook_preserves_unicode_and_exact_numbers(self):
        archive = workbook("""
const rows=[['SKU','Name','Quantity'],...Array.from({length:1000},(_,n)=>[String(n).padStart(5,'0'),'مادة 🧱 '+n,n/4])];
console.log(Buffer.from(wlXlsxWorkbook([{name:'All products',rows}])).toString('base64'));
""")
        self.assertIsNone(archive.testzip())
        rows = cells(archive)
        self.assertEqual(len(rows), 1001)
        self.assertEqual(rows[-1][0][1], "00999")
        self.assertEqual(rows[-1][1][1], "مادة 🧱 999")
        self.assertEqual(rows[-1][2][1], "249.75")


if __name__ == '__main__':
    unittest.main()
