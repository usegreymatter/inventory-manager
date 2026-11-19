#!/usr/bin/env python3
"""Offline deterministic hostile reader/understanding/preflight differential probe.

/usr/bin/python3 scripts/stress_hostile_imports.py [--record-only]
Only writes synthetic files/results under .scratch. No third-party Python modules.
"""
import argparse
import collections
import csv
import hashlib
import importlib
import io
import json
from pathlib import Path
import random
import resource
import signal
import struct
import subprocess
import sys
import tempfile
import time
import types
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType('stock_runway')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', package)
core = importlib.import_module('stock_runway.smart_import')
preflight = importlib.import_module('stock_runway.csv_import')
SEED = 20261118
HEADER = ['sku', 'name', 'unit', 'on_hand', 'supplier_days', '2026-01', '2026-02', '2026-03']
ROW = ['A', 'Widget', 'pcs', '10', '7', '1', '2', '3']
WB = '<workbook xmlns:r="urn:r"><sheets><sheet name="Stock" r:id="r1"/></sheets></workbook>'
RELS = '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'
SHEET = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>safe</t></is></c></row></sheetData></worksheet>'


def csv_bytes(rows, delimiter=','):
    out = io.StringIO(newline='')
    csv.writer(out, delimiter=delimiter, lineterminator='\n').writerows(rows)
    return out.getvalue().encode()


def workbook(sheet=SHEET, wb=WB, rels=RELS, extras=(), method=zipfile.ZIP_STORED):
    out = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(out, 'w') as archive:
            for name, text in [('xl/workbook.xml', wb), ('xl/_rels/workbook.xml.rels', rels),
                               ('xl/worksheets/sheet1.xml', sheet), *extras]:
                info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
                archive.writestr(info, text, compress_type=method)
    return out.getvalue()


def corpus():
    rng = random.Random(SEED)
    cases = []
    def add(group, data, suffix, reject=False):
        cases.append(dict(id='%04d-%s' % (len(cases), group), group=group,
                          raw=data, suffix=suffix, must_reject=reject))
    # Structurally malformed CSV: unterminated/illegal closing quotes and encoding.
    for i in range(256):
        prefix = csv_bytes([HEADER])
        bad = [b'"open', b'"closed"junk,1', b'"a" b', b'A,"unterminated\n',
               b'\xffinvalid', b'\xc0\x80', b'\x00', b'\xef\xbf\xbd'][i % 8]
        add('csv-malformed', prefix + bad + str(i).encode(), '.csv', True)
    # Valid syntax containing hostile data; final strict/preflight validation decides.
    hostile = ['1e999999', '-1e999999', 'NaN', 'Infinity', '-0', '1e-999999', '9' * 257,
               '=HYPERLINK("https://invalid.example")', '+SUM(1,2)', '@SUM(1)', '-2+3',
               '<img src=x onerror="globalThis.__hostile=1">', '</script><script>alert(1)</script>',
               '__proto__', 'constructor', 'prototype', 'Straße', 'STRASSE', 'ΟΣ', 'ος',
               '\u202eexe.csv', '\u2066A\u2069', 'مسمار', 'e\u0301', 'é', '\ufeff=1+1', '\t=1+1',
               '\r=1+1', '\n=1+1', '1,23,456', '1.234,56', '0x10']
    for i in range(224):
        row = ROW[:]
        row[rng.randrange(len(row))] = hostile[i % len(hostile)]
        rows = [HEADER[:], row]
        if i % 3 == 0: rows.append(row[:])
        if i % 7 == 0:
            rows = [HEADER + ['Warehouse'], row + ['Straße'], row + ['STRASSE']]
        rows[0].append('hostile_case')
        for row in rows[1:]: row.append(str(i))
        add('csv-hostile-data', csv_bytes(rows, [';', ',', '\t'][i % 3]), '.csv')
    # Known XML well-formedness violations, no remote resources ever accessed.
    bad_xml = ['<t>&bogus;</t>', '<t>&bare</t>', '<t>&#0;</t>', '<t>&#1;</t>',
               '<t>&#xD800;</t>', '<t>&#xFFFE;</t>', '<t>bad]]>text</t>',
               '<t a="<bad">x</t>', '<t a="1" a="2"/>', '<t><x></t>',
               '<t>\x01</t>', '<t/>trailing', 'leading<t/>', '<t/><t/>',
               '<!DOCTYPE t [<!ENTITY x "attack">]><t>&x;</t>',
               '<!DOCTYPE t SYSTEM "file:///hostile-never-read"><t/>']
    for i in range(192):
        xml = '<?hostile case="%d"?>' % i + bad_xml[i % len(bad_xml)]
        # Test the same attack across every parsed XML part and both supported ZIP methods.
        part = (i // len(bad_xml)) % 3
        args = {'wb': xml} if part == 0 else {'rels': xml} if part == 1 else {'sheet': xml}
        if i % 4 == 0: args = {k: b'\xff\xfe' + v.encode('utf-16le') for k, v in args.items()}
        add('xlsx-malformed-xml', workbook(**args, method=8 if i % 2 else 0), '.xlsx', True)
    # ZIP structure/entry and relationship attacks.
    for i in range(80):
        variant = i % 10
        if variant == 0: raw = workbook(extras=[('xl/workbook.xml', WB)])
        elif variant == 1: raw = workbook(rels=RELS.replace('worksheets/sheet1.xml', '../../outside.xml'))
        elif variant == 2: raw = workbook(rels=RELS.replace('Target=', 'TargetMode="External" Target='))
        elif variant == 3: raw = workbook()[:rng.randrange(1, 300)]
        elif variant == 4:
            raw = bytearray(workbook()); at = raw.index(b'PK\x01\x02'); struct.pack_into('<I', raw, at + 24, 80 * 1024 * 1024 + 1); raw = bytes(raw)
        elif variant == 5:
            raw = bytearray(workbook()); at = raw.index(b'PK\x01\x02'); raw[at + 8] |= 1; raw = bytes(raw)
        elif variant == 6:
            raw = bytearray(workbook()); at = raw.index(b'PK\x01\x02'); struct.pack_into('<H', raw, at + 10, 99); raw = bytes(raw)
        elif variant == 7:
            raw = bytearray(workbook()); raw[raw.index(b'<workbook') + 2] ^= 1; raw = bytes(raw)
        elif variant == 8: raw = workbook(extras=[('xl/workbook.bin', b'legacy')])
        else: raw = workbook(sheet=SHEET.replace('A1', 'XFE1'))
        # ZIP comments distinguish otherwise repeated structural attack variants.
        if variant != 3:
            raw = bytearray(raw); end = raw.rfind(b'PK\x05\x06')
            comment = ('hostile-%d' % i).encode(); struct.pack_into('<H', raw, end + 20, len(comment)); raw.extend(comment); raw = bytes(raw)
        else: raw += ('hostile-%d' % i).encode()
        add('xlsx-zip-path', raw, '.xlsx', True)
    resource_cases = [
        ('rows', workbook(sheet='<worksheet>' + '<row/>' * 200001 + '</worksheet>', method=8)),
        ('columns', csv_bytes([['x'] * 16385])),
        ('csv-rows', b'x\n' * 200001),
        ('cells', (('x,' * 999 + 'x\n') * 2001).encode()),
        ('depth', workbook(wb='<a>' * 256 + '</a>' * 256, method=8)),
        ('elements', workbook(wb='<a>' + '<b/>' * 500001 + '</a>', method=8)),
        ('strings', workbook(extras=[('xl/sharedStrings.xml', '<sst>' + '<si/>' * 200001 + '</sst>')], method=8)),
        ('entries', workbook(extras=[('x%d' % i, '') for i in range(4094)])),
        ('input', b'x' * (20 * 1024 * 1024 + 1)),
        ('declared-expansion', workbook(extras=[('bomb', b'0' * (80 * 1024 * 1024 + 1))], method=8)),
        ('sparse-row', workbook(sheet=SHEET.replace('r="1"', 'r="200001"'))),
        ('entity-run', workbook(sheet='<t>' + '&' * 50000 + '</t>', method=8)),
        ('markup-run', workbook(sheet='<' * 100000, method=8)),
        ('quote-run', workbook(sheet='<"' * 50000, method=8)),
    ]
    for name, raw in resource_cases:
        add('bounds-' + name, raw, '.csv' if name in ('columns', 'csv-rows', 'cells', 'input') else '.xlsx', True)
    fmt = '0' * 1000000
    styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="' + fmt + '"/></numFmts><cellXfs><xf numFmtId="164"/></cellXfs></styleSheet>'
    sheet = '<worksheet><row>' + '<c s="0"><v>1</v></c>' * 90 + '</row></worksheet>'
    add('bounds-format-amplification', workbook(sheet=sheet, extras=[('xl/styles.xml', styles)], method=8), '.xlsx', True)
    # Positive controls: compressed UTF-16 XML, literal formula payload, cached formula.
    for i in range(16):
        text = '<worksheet><sheetData><row><c t="inlineStr"><is><t>=1+1</t></is></c><c><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'
        text = '<!--case %d-->' % i + text
        if i % 2: text = b'\xff\xfe' + text.encode('utf-16le')
        add('xlsx-formula-literal', workbook(sheet=text, method=8 if i % 4 else 0), '.xlsx')
    return cases


def result(path, group):
    start = time.perf_counter()
    out = {}
    try:
        sheets = core.read_workbook(path)
        out['reader'] = 'accept'
        out['sheets_hash'] = digest(sheets)
        try:
            report = core.understand_workbook(sheets)
            out['understand'] = 'accept'
            out['canonical_hash'] = digest(report['canonical_rows'])
        except ValueError as error:
            out.update(understand='reject', understand_error=str(error))
    except ValueError as error:
        out.update(reader='reject', reader_error=str(error))
    except Exception as error:
        out.update(reader='crash', reader_error=type(error).__name__ + ': ' + str(error))
    if path.suffix == '.csv' and path.stat().st_size <= 2 * 1024 * 1024:
        try:
            data = preflight.import_csv(str(path))
            out.update(preflight='accept', items_hash=digest(data['items']))
        except ValueError as error:
            out.update(preflight='reject', preflight_error=str(error))
        except Exception as error:
            out.update(preflight='crash', preflight_error=type(error).__name__ + ': ' + str(error))
    out['ms'] = round((time.perf_counter() - start) * 1000, 3)
    return out


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def case_timeout(signum, frame):
    raise TimeoutError('Python import exceeded 5-second per-case watchdog')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record-only', action='store_true', help='record findings without failing on parity gaps')
    args = parser.parse_args()
    scratch = ROOT / '.scratch'; scratch.mkdir(exist_ok=True)
    started = time.perf_counter()
    cases = corpus()
    with tempfile.TemporaryDirectory(prefix='hostile-', dir=scratch) as directory:
        directory = Path(directory)
        requests = []
        python = []
        for case in cases:
            path = directory / (case['id'] + case['suffix'])
            path.write_bytes(case['raw'])
            requests.append({k: v for k, v in case.items() if k not in ('raw', 'suffix')})
            requests[-1].update(path=str(path), sha256=hashlib.sha256(case['raw']).hexdigest())
            previous = signal.signal(signal.SIGALRM, case_timeout)
            try:
                signal.setitimer(signal.ITIMER_REAL, 5)
                python.append(result(path, case['group']))
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, previous)
        manifest = directory / 'manifest.json'; manifest.write_text(json.dumps(requests))
        run = subprocess.run(['node', '--max-old-space-size=512', 'scripts/stress-hostile-imports.mjs', str(manifest)],
                             cwd=ROOT, capture_output=True, text=True, timeout=180)
        if run.returncode:
            raise SystemExit('JS probe failed: ' + run.stderr + run.stdout)
        js = json.loads(run.stdout)
        assert len(js['results']) == len(requests), 'Missing JS results'
        assert len(set(r['sha256'] for r in requests if r['must_reject'])) >= 500, 'Need 500 distinct malformed inputs'
        findings = []
        for request, py, other in zip(requests, python, js['results']):
            fields = ['reader', 'sheets_hash', 'understand', 'canonical_hash', 'preflight', 'items_hash']
            differences = {key: [py.get(key), other.get(key)] for key in fields if py.get(key) != other.get(key)}
            unsafe = request['must_reject'] and (py['reader'] != 'reject' or other['reader'] != 'reject')
            over_budget = py['ms'] > 5000 or other['ms'] > 5000
            if differences or unsafe or over_budget or 'crash' in (py.get('reader'), other.get('reader'), py.get('preflight'), other.get('preflight')):
                findings.append(dict(id=request['id'], differences=differences, unsafe=unsafe, over_budget=over_budget, python=py, js=other))
        report = dict(seed=SEED, cases=len(cases), corpus_sha256=digest([r['sha256'] for r in requests]),
                      unique_inputs=len(set(r['sha256'] for r in requests)), must_reject_cases=sum(r['must_reject'] for r in requests),
                      groups=dict(collections.Counter(c['group'] for c in cases)), findings=findings,
                      finding_count=len(findings), python_reader=dict(collections.Counter(r['reader'] for r in python)),
                      per_case_budget_ms=5000, node_heap_limit_mib=512, node_job_deadline_s=180,
                      js_reader=dict(collections.Counter(r['reader'] for r in js['results'])),
                      python_preflight=dict(collections.Counter(r.get('preflight', 'not-applicable') for r in python)),
                      python_ms=round(sum(r['ms'] for r in python), 3), js_ms=round(sum(r['ms'] for r in js['results']), 3),
                      elapsed_s=round(time.perf_counter()-started, 3), python_max_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                      js_max_rss_bytes=js['max_rss_bytes'],
                      slowest_python=sorted([dict(id=r['id'], ms=p['ms']) for r,p in zip(requests,python)], key=lambda r:r['ms'], reverse=True)[:8],
                      slowest_js=sorted([dict(id=r['id'], ms=p['ms']) for r,p in zip(requests,js['results'])], key=lambda r:r['ms'], reverse=True)[:8],
                      export_checks=js['export_checks'])
        target = scratch / 'stress-hostile-results.json'; target.write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n')
        print(json.dumps({k:v for k,v in report.items() if k != 'findings'}, indent=2))
        print('Detailed findings:', target)
        return 0 if args.record_only or not findings else 1


if __name__ == '__main__':
    sys.exit(main())
