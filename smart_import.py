"""Bounded, dependency-free workbook reader and deterministic import understanding.

This layer suggests a canonical CSV; the existing strict/preflight validator remains
responsible for quantity ranges and forecast readiness. No ERP/network access.
Mirrored in desktop/smart-import.js; keep report fields and heuristics in parity.
"""
from __future__ import annotations

import csv
import io
import json
import math
import posixpath
import re
import zipfile
from datetime import date, timedelta
from decimal import Decimal, localcontext
from pathlib import Path
from xml.etree import ElementTree as ET
from .csv_import import PER_ITEM, AMBIGUOUS_NUMBER, number_style, erp_number

MAX_INPUT = 20 * 1024 * 1024
MAX_EXPANDED = 80 * 1024 * 1024
MAX_ROWS = 200000
MAX_COLS = 16384
MAX_CELLS = 2000000
FIXED = ['sku', 'name', 'unit', 'on_hand', 'supplier_days']
OPTIONAL = ['category', 'supplier', 'on_order', 'demand_change_pct', 'last_count_date']
NUMERIC_FIELDS = {'on_hand', 'on_order', 'supplier_days', 'demand_change_pct', 'quantity', *PER_ITEM}
BALANCE_ERROR = 'differing on-hand balances; use stock snapshot'
DATE_HEADERS = ['date', 'transaction date', 'sales date', 'invoice date', 'document date', 'posting date', 'month', 'period']
QUANTITY_HEADERS = ['quantity', 'qty', 'sales quantity', 'qty sold', 'quantity sold', 'units sold', 'sales', 'sold', 'demand', 'sales qty', 'quantity invoiced']
MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december']
REQUIRED = [('sku', 'Product code (SKU)'), ('name', 'Product name'), ('on_hand', 'On-hand stock')]
NUMERIC = re.compile(r'^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$')
LEGACY_ERROR = 'Save as .xlsx or CSV; legacy .xls and .xlsb workbooks are not supported.'
BOUNDS_ERROR = 'Workbook exceeds safe limits (200000 rows, 16384 columns or 2000000 cells).'
XML_BOUNDS_ERROR = 'Workbook XML exceeds safe limits (500000 elements or 200000 shared strings).'
XML_TOKENS = re.compile(r'<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"<]*"|\'[^\'<]*\'|[^\'"<>])*>|[^<]+')


def _trim(value):
    return str(value if value is not None else '').strip('\ufeff \t\r\n\v\f\x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000')


def _tag(element):
    return element.tag.rsplit('}', 1)[-1]


def _desc(element, tag):
    return [e for e in element.iter() if _tag(e) == tag]


def _xml(raw, budget=None):
    # Decode first: a UTF-16 DTD must not bypass the declaration check. No
    # entities/DTDs are accepted, so stdlib ET never expands attacker entities.
    text = _decode(raw)
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('Unsafe XML declarations in workbook.')
    # Count before ElementTree allocates any nodes. A tiny compressed workbook
    # can otherwise allocate millions of empty shared-string elements.
    if budget is None: budget = [0]
    strings = depth = position = 0
    # Match at the current cursor, never search each suffix of malformed '<'
    # runs. Unanchored finditer made a tiny deflated part quadratic to reject.
    while position < len(text):
        match = XML_TOKENS.match(text, position)
        if match is None: raise ValueError('Invalid XML in workbook.')
        position = match.end()
        token = match[0]
        if not token.startswith('<') or token.startswith(('<!--','<?','<![CDATA[')): continue
        if token.startswith('</'): depth -= 1; continue
        budget[0] += 1
        if re.match(r'<(?:[^\s:/>]+:)?si(?=[\s/>])', token): strings += 1
        if budget[0] > 500000 or strings > 200000: raise ValueError(XML_BOUNDS_ERROR)
        if depth + 1 > 255: raise ValueError('Workbook XML nesting is too deep.')
        if not token.endswith('/>'):
            depth += 1
            if depth > 255: raise ValueError('Workbook XML nesting is too deep.')
    root = ET.fromstring(text)
    stack = [(root, 1)]
    while stack:
        element, depth = stack.pop()
        if depth > 255: raise ValueError('Workbook XML nesting is too deep.')
        stack.extend((child, depth + 1) for child in element)
    return root


def _uint(raw, message='Invalid numeric attribute in workbook.'):
    raw = str(raw)
    if len(raw) > 10 or not re.fullmatch('[0-9]+', raw) or int(raw) > 2147483647:
        raise ValueError(message)
    return int(raw)


def _text(element):
    # Rich strings may contain phonetic annotations, which are not display text.
    return ''.join((child.text or '') if _tag(child) == 't' else _text(child)
                   for child in element if _tag(child) != 'rPh')


def _limits(sheets):
    rows = cells = 0
    for sheet in sheets:
        rows += len(sheet['rows'])
        for row in sheet['rows']:
            if len(row) > MAX_COLS: raise ValueError(BOUNDS_ERROR)
            cells += len(row)
        if rows > MAX_ROWS or cells > MAX_CELLS: raise ValueError(BOUNDS_ERROR)
    return sheets


def _decode(raw):
    try:
        text = raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')
        if '\x00' in text or '\ufffd' in text: raise UnicodeError
        return text
    except UnicodeError:
        raise ValueError('File is not UTF-8; re-export as CSV UTF-8') from None


def read_workbook(path):
    """Read a local .xlsx or UTF-8/UTF-16 CSV into [{name, rows}]."""
    path = Path(path).expanduser()
    if path.suffix.lower() in ('.xls', '.xlsb'): raise ValueError(LEGACY_ERROR)
    if path.stat().st_size > MAX_INPUT: raise ValueError('File must be no larger than 20 MiB.')
    with path.open('rb') as handle: raw = handle.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT: raise ValueError('File must be no larger than 20 MiB.')
    if raw.startswith(b'\xd0\xcf\x11\xe0'): raise ValueError(LEGACY_ERROR)
    if path.suffix.lower() == '.xlsx' or raw.startswith(b'PK'):
        return _read_xlsx(raw)
    from .csv_import import delimiter_for
    text = _decode(raw)
    old_limit = csv.field_size_limit()
    try:
        csv.field_size_limit(MAX_INPUT)
        rows = []; cells = 0
        delimiter = delimiter_for(text)
        for row in csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, strict=True):
            cells += len(row)
            if len(rows) >= MAX_ROWS or len(row) > MAX_COLS or cells > MAX_CELLS: raise ValueError(BOUNDS_ERROR)
            rows.append(row)
    except csv.Error:
        raise ValueError('Could not read the local CSV file.') from None
    finally:
        csv.field_size_limit(old_limit)
    return [{'name': path.stem, 'rows': rows, 'delimiter': delimiter}]


def _read_xlsx(raw):
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 4096: raise ValueError('Workbook contains too many ZIP entries.')
            names = set(); expanded = 0
            for info in infos:
                if info.flag_bits & 1: raise ValueError('Encrypted workbooks are not supported. Save an unencrypted .xlsx or CSV.')
                if info.compress_type not in (0, 8): raise ValueError('Unsupported ZIP compression; Save as .xlsx or CSV.')
                if info.filename in names: raise ValueError('Duplicate ZIP entries in workbook.')
                names.add(info.filename)
                expanded += info.file_size
                if expanded > MAX_EXPANDED: raise ValueError('Workbook expands beyond 80 MiB.')
            if 'xl/workbook.bin' in names: raise ValueError(LEGACY_ERROR)
            cache = {}; read_size = 0; xml_budget = [0]
            def load(name, optional=False):
                nonlocal read_size
                if name not in names:
                    if optional: return None
                    raise ValueError('Workbook is missing a required XML part.')
                if name not in cache:
                    chunks = []; size = 0
                    with archive.open(name) as stream:
                        while True:
                            chunk = stream.read(min(65536, MAX_EXPANDED - read_size + 1))
                            if not chunk: break
                            size += len(chunk); read_size += len(chunk)
                            if read_size > MAX_EXPANDED: raise ValueError('Workbook expands beyond 80 MiB.')
                            chunks.append(chunk)
                    cache[name] = _xml(b''.join(chunks), xml_budget)
                return cache[name]
            workbook = load('xl/workbook.xml')
            rels = load('xl/_rels/workbook.xml.rels')
            relations = {r.get('Id'): r for r in rels}
            props = _desc(workbook, 'workbookPr')
            epoch1904 = bool(props and props[0].get('date1904') in ('1','true'))
            styles = load('xl/styles.xml', True)
            formats = {}; style_ids = []
            if styles is not None:
                formats = {_uint(e.get('numFmtId', '0')): e.get('formatCode', '') for e in _desc(styles, 'numFmt')}
                xfs = _desc(styles, 'cellXfs')
                if xfs: style_ids = [_uint(e.get('numFmtId', '0')) for e in xfs[0]]
            strings = load('xl/sharedStrings.xml', True)
            shared = [_text(e) for e in strings if _tag(e) == 'si'] if strings is not None else []
            sheets = []; row_count = cell_count = padding_size = 0
            for sheet in _desc(workbook, 'sheet'):
                rid = next((v for k,v in sheet.attrib.items() if k.rsplit('}',1)[-1] == 'id'), None)
                relation = relations.get(rid)
                if relation is None or relation.get('TargetMode') == 'External':
                    raise ValueError('Workbook sheet relationship is missing or external.')
                target = relation.get('Target','')
                name = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
                if not name.startswith('xl/') or '\\' in name: raise ValueError('Unsafe workbook sheet path.')
                root = load(name); rows = []; percent_cells = []
                for row in _desc(root, 'row'):
                    row_index = _uint(row.get('r', len(rows)+1)) - 1
                    if row_index < len(rows) or row_index >= MAX_ROWS: raise ValueError(BOUNDS_ERROR)
                    row_count += row_index + 1 - len(rows)
                    if row_count > MAX_ROWS: raise ValueError(BOUNDS_ERROR)
                    while len(rows) <= row_index: rows.append([])
                    values = rows[row_index]
                    for cell in row:
                        if _tag(cell) != 'c': continue
                        ref = cell.get('r','')
                        if len(ref) > 16: raise ValueError('Invalid workbook cell reference.')
                        match = re.fullmatch(r'([A-Za-z]+)([1-9][0-9]*)', ref) if ref else None
                        if ref and (not match or _uint(match[2], 'Invalid workbook cell reference.') != row_index+1): raise ValueError('Invalid workbook cell reference.')
                        col = 0
                        if match:
                            for char in match[1].upper(): col = col*26 + ord(char)-64
                            col -= 1
                        else: col = len(values)
                        if col < len(values) or col >= MAX_COLS: raise ValueError(BOUNDS_ERROR)
                        cell_count += col+1-len(values)
                        if cell_count > MAX_CELLS: raise ValueError(BOUNDS_ERROR)
                        values.extend(['']*(col+1-len(values)))
                        value_node = _desc(cell, 'v')
                        value = value_node[0].text or '' if value_node else ''
                        typ = cell.get('t','')
                        if typ == 'inlineStr': value = _text(cell)
                        elif typ == 's':
                            index = _uint(value, 'Invalid shared-string index in workbook.')
                            if not 0 <= index < len(shared): raise ValueError('Invalid shared-string index in workbook.')
                            value = shared[index]
                        elif typ == 'b': value = 'TRUE' if value == '1' else 'FALSE'
                        elif typ not in ('str','e','d') and value:
                            style_index = _uint(cell.get('s','0'))
                            fmt_id = style_ids[style_index] if 0 <= style_index < len(style_ids) else 0
                            fmt = formats.get(fmt_id,'')
                            if fmt_id in (9,10) or '%' in re.sub(r'"[^\"]*"|\\.', '', fmt):
                                percent_cells.append([row_index, col])
                            if 14 <= fmt_id <= 22 or _date_format(fmt):
                                if len(value) > 256 or not NUMERIC.fullmatch(value): raise ValueError('Invalid Excel date value.')
                                serial = float(value)
                                if not math.isfinite(serial) or not 0 <= serial <= 2958465: raise ValueError('Invalid Excel date value.')
                                days = math.floor(serial)
                                # Excel's fictional 1900-02-29 maps to 1900-02-28.
                                epoch = date(1904,1,1) if epoch1904 else date(1899,12,31)
                                value = (epoch + timedelta(days=days if epoch1904 or days < 60 else days-1)).isoformat()
                            elif re.fullmatch('0+',fmt) and re.fullmatch('[0-9]+',value):
                                # Formatting can amplify tiny numeric cells independently
                                # of ZIP expansion. Budget before allocating padded text.
                                padding_size += max(0, len(fmt) - len(value))
                                if padding_size > MAX_EXPANDED: raise ValueError('Workbook formatting expands beyond 80 MiB.')
                                value = value.zfill(len(fmt))
                        values[col] = value
                result = {'name': sheet.get('name','Sheet'), 'rows': rows}
                if percent_cells: result['percent_cells'] = percent_cells
                sheets.append(result)
            return _limits(sheets)
    except (zipfile.BadZipFile, ET.ParseError, KeyError, IndexError, OverflowError, OSError, RuntimeError) as error:
        raise ValueError('Could not read workbook; Save as .xlsx or CSV.') from error


def _date_format(fmt):
    fmt = re.sub(r'"[^\"]*"|\\.|\[[^\]]*\]', '', fmt).lower()
    return bool(re.search('[dy]',fmt) or re.search('m',fmt) and not re.search('[hs]',fmt))


def _key(raw):
    raw = re.sub(r'([a-z0-9])([A-Z])',r'\1 \2',_trim(raw)).replace('#',' no').lower()
    return ' '.join(re.sub(r'[^\w\s]|_', ' ', raw).split())


def _month(raw, inferred=2000):
    t = _trim(raw)
    m = re.fullmatch(r'([1-9][0-9]{3})[-/.]([0-9]{1,2})(?:[-/.]([0-9]{1,2})(?:[ T].*)?)?',t)
    if m:
        y,mo,day = int(m[1]),int(m[2]),int(m[3] or '1')
        try: date(y,mo,day)
        except ValueError: return None
        return f'{y:04d}-{mo:02d}'
    m = re.fullmatch(r'([0-9]{1,2})[-/.]([1-9][0-9]{3})',t)
    if m: return f'{int(m[2]):04d}-{int(m[1]):02d}' if 1 <= int(m[1]) <= 12 else None
    m = re.fullmatch(r'([0-9]{1,2})([/.])([0-9]{1,2})\2([1-9][0-9]{3})',t)
    if m:
        mo,day = (int(m[1]),int(m[3])) if m[2] == '/' else (int(m[3]),int(m[1]))
        try: date(int(m[4]),mo,day)
        except ValueError: return None
        return f'{int(m[4]):04d}-{mo:02d}'
    m = re.fullmatch(r"([A-Za-z]{3,9})(?:[\s\-/.,']*([0-9]{4}|[0-9]{2}))?",t)
    if m:
        name = m[1].lower()
        for i,full in enumerate(MONTH_NAMES):
            if name in (full,full[:3]) or name == 'sept' and i == 8:
                y = int(m[2]) + (2000 if len(m[2]) == 2 else 0) if m[2] else inferred
                return f'{y:04d}-{i+1:02d}' if 1000 <= y <= 9999 else None
    return None


def _yearless(raw):
    return _month(raw) is not None and not re.search('[0-9]',raw)


def _sheet_numbers(sheet, picked, start):
    """Reuse preflight's convention per sheet, never guess lone Excel commas."""
    rows = sheet['rows'][start:]
    indices = [i for f, hits in picked.items() if f in NUMERIC_FIELDS or re.fullmatch(r'(?:rcv:)?[0-9]{4}-[0-9]{2}', f) for i in hits]
    delimiter = sheet.get('delimiter')

    # Excel numeric cells already use dot decimals. Without a CSV delimiter,
    # do not let comma text reinterpret a typed 1.234 as 1234.
    effective = delimiter or ','
    style = number_style(rows, indices, effective)
    lead_index = picked.get('supplier_days', [None])[0]
    mixed = style == 'decimal-comma' and any('.' in r[i] and NUMERIC.fullmatch(erp_number(r[i], ',', i == lead_index))
                and erp_number(r[i], effective, i == lead_index, style) == AMBIGUOUS_NUMBER
                for r in rows for i in indices if i < len(r) and len(r[i]) <= 256)
    def number(raw, lead=False):
        t = _trim(raw)
        if delimiter is None and style == 'decimal-dot' and ',' in t and not re.fullmatch(r'[+-]?[0-9]{1,3}(?:,[0-9]{3})+\.[0-9]+', t):
            return AMBIGUOUS_NUMBER
        result = erp_number(t, effective, lead, style, mixed)
        return _add('0', result) if lead and NUMERIC.fullmatch(result) else result
    return number, style


def _add(left, right):
    if not left: return right
    if not right: return left
    if len(left) > 256 or len(right) > 256 or not NUMERIC.fullmatch(left) or not NUMERIC.fullmatch(right): return 'Invalid quantity: ' + left + ' + ' + right
    try:
        with localcontext() as ctx:
            ctx.prec = 800
            a,b = Decimal(left),Decimal(right)
            if not a.is_finite() or not b.is_finite() or abs(a.adjusted()) > 308 or abs(b.adjusted()) > 308: return 'Invalid quantity'
            if (a+b).is_zero(): return '0'
            text = format(a+b,'f')
            return (text.rstrip('0').rstrip('.') if '.' in text else text) or '0'
    except ArithmeticError: return 'Invalid quantity'


def _same_number(left, right):
    a, b = _add('0', left), _add('0', right)
    return bool(NUMERIC.fullmatch(a) and NUMERIC.fullmatch(b) and a == b)


def _percent(raw):
    value = _add('0', raw)
    if not NUMERIC.fullmatch(value): return value
    with localcontext() as ctx:
        ctx.prec = 800
        return _add('0', str(Decimal(value) * 100))


def _analyse(sheet, overrides, aliases, type_aliases):
    rows = sheet['rows']; name = sheet['name']
    lookup = {}
    for field, labels in aliases.items():
        for rank,label in enumerate([field,*labels]): lookup.setdefault(_key(label),(field,rank))
    for rank,label in enumerate(type_aliases): lookup.setdefault(_key(label),('category',100+rank))
    for label, hit in list(lookup.items()): lookup.setdefault(label.replace(' ', ''), hit)
    abbreviations = {}
    for label, (field, _) in lookup.items():
        parts = label.split()
        if len(parts) >= 3:
            abbreviations.setdefault(''.join(p[0] for p in parts), set()).add(field)
    best = None
    # Confirmed column rules apply to the detected header, never to data rows.
    # Otherwise an override can give every row a full header score.
    scan = list(enumerate(rows[:30]))
    if overrides and rows:
        detected = _analyse(sheet, {}, aliases, type_aliases)[0]['header_row'] - 1
        scan = [(detected, rows[detected])]
    for ri,headers in scan:
        years = [_month(h)[:4] for h in headers if _month(h) and not _yearless(h)]
        inferred = int(years[0]) if years else 2000
        has_date = any(_key(h) in DATE_HEADERS for h in headers)
        mapping=[]; candidates=[]
        for i,source in enumerate(headers):
            key = _key(source); bracket_key = _key(re.sub(r'\([^)]*\)|\[[^]]*\]', '',source))
            if key not in lookup and key.replace(' ', '') in lookup: key = key.replace(' ', '')
            field=None; confidence='high'; reason='Exact header alias'; rank=0
            override_key=f'{name}:{i}'
            if override_key in overrides:
                field = overrides[override_key] or None; reason='Manual mapping'; rank=-1000
                if field is not None and field not in {*aliases,*FIXED,*OPTIONAL,*PER_ITEM,'date','quantity'} and not re.fullmatch(r'(?:rcv:)?[1-9][0-9]{3}-(?:0[1-9]|1[0-2])',field):
                    field=None; reason='Unknown manual mapping ignored'
            else:
                low=_trim(source).lower(); receipt=low.startswith('rcv:')
                label=_trim(source)[4:] if receipt else source
                month=_month(label,inferred)
                if month: field=('rcv:' if receipt else '')+month; reason='Monthly sales header' if not receipt else 'Monthly receipt header'
                elif key in DATE_HEADERS: field='date'; reason='Transaction date header'
                elif has_date and key in QUANTITY_HEADERS: field='quantity'; reason='Transaction quantity header'
                elif key in lookup or bracket_key in lookup:
                    field,rank=lookup.get(key,lookup.get(bracket_key)); reason='Exact header alias' if key in lookup else 'Header alias without unit annotation'
                    if key == 'barcode': rank=10000; reason='Barcode fallback identifier'
                elif key in abbreviations and len(abbreviations[key]) == 1:
                    field = next(iter(abbreviations[key])); rank = 500
                    confidence = 'low'; reason = 'Header abbreviation; review mapping'
                elif key:
                    tokens=set(key.split()); options=[]
                    for alias,(target,alias_rank) in lookup.items():
                        parts=set(alias.split())
                        if len(parts) >= 2 and len(tokens & parts) >= 2:
                            overlap=len(tokens & parts)/len(tokens | parts)
                            if overlap >= 0.5: options.append((-overlap,alias_rank,target))
                    if options:
                        options.sort(); overlap,rank,field=options[0]; confidence='medium' if -overlap >= 0.75 else 'low'; reason='Token overlap; review mapping'; rank+=100
            item={'index':i,'source':source,'field':field,'confidence':confidence if field else 'none','reason':reason if field else ('Ignored by manual mapping' if override_key in overrides and not overrides[override_key] else reason if override_key in overrides else 'No recognized header')}
            mapping.append(item)
            if field: candidates.append((rank,i,field))
        # An unlabeled date may be inferred only from textual dates, never serial numbers.
        fields={c[2] for c in candidates}
        if 'date' not in fields:
            for item in mapping:
                i=item['index']
                if item['field'] or f'{name}:{i}' in overrides: continue
                values=[_trim(r[i]) for r in rows[ri+1:ri+21] if i < len(r) and _trim(r[i])]
                if len(values)>=2 and all(re.search(r'[0-9][-/\.][0-9]',v) and _month(v) for v in values):
                    item.update(field='date',confidence='low',reason='Text date values; review mapping'); candidates.append((500,i,'date')); break
        if any(c[2] == 'date' for c in candidates):
            for item in mapping:
                i = item['index']
                if _key(item['source']) in QUANTITY_HEADERS and f'{name}:{i}' not in overrides:
                    candidates = [c for c in candidates if c[1] != i]
                    item.update(field='quantity', confidence='high', reason='Transaction quantity header')
                    candidates.append((0, i, 'quantity'))
        # NetSuite exports use Name as the code beside Display Name/Description.
        if not any(c[2] == 'sku' for c in candidates):
            names = [m for m in mapping if m['field'] == 'name']
            plain = [m for m in names if _key(m['source']) == 'name' and f'{name}:{m["index"]}' not in overrides]
            descriptions = [m for m in names if _key(m['source']) != 'name']
            if plain and descriptions:
                item = plain[0]; i = item['index']
                candidates = [c for c in candidates if c[1] != i]
                item.update(field='sku', confidence='medium', reason='Name identifier beside product description')
                candidates.append((0, i, 'sku'))
        if not any(c[2]=='sku' for c in candidates):
            possible=[]
            for item in mapping:
                i=item['index']
                if item['field'] or f'{name}:{i}' in overrides: continue
                # Location/bin codes can look like SKUs: require product context.
                hint = set(_key(item['source']).split())
                if hint and not hint & {'code','id','ref','reference','sku','item','article','material','part','product','identifier'}: continue
                if not any(c[2] == 'name' for c in candidates): continue
                values=[_trim(r[i]) for r in rows[ri+1:ri+21] if i < len(r) and _trim(r[i])]
                if len(values)>=2 and all(re.fullmatch(r'[A-Za-z0-9_-]{1,64}',v) and re.search('[0-9]',v) and not _month(v) for v in values): possible.append(item)
            if len(possible)==1:
                item=possible[0]; item.update(field='sku',confidence='low',reason='Identifier values; review mapping'); candidates.append((500,item['index'],'sku'))
        picked={}
        for rank,i,field in sorted(candidates):
            if field not in picked or re.fullmatch(r'(?:rcv:)?[0-9]{4}-[0-9]{2}',field): picked.setdefault(field,[]).append(i)
            else: mapping[i].update(field=None,confidence='none',reason='Duplicate field; preferred alias used')
        fields=set(picked)
        score=sum(12 if f in ('sku','name','on_hand') else 5 if f in ('date','quantity') else 2 for f in fields)
        layout='long' if {'date','quantity'} <= fields else 'wide' if any(re.fullmatch(r'(?:rcv:)?[0-9]{4}-[0-9]{2}',f) for f in fields) else 'products'
        result=dict(name=name,header_row=ri+1,score=score,layout=layout,mapping=mapping,
                    unmapped=[m['source'] for m in mapping if not m['field']],missing=[title for f,title in REQUIRED if f not in fields],products=0)
        if best is None or score > best[0]['score']: best=(result,picked,headers,inferred, bool(years))
    if best is None: best=(dict(name=name,header_row=1,score=0,layout='products',mapping=[],unmapped=[],missing=[t for _,t in REQUIRED],products=0),{},[],2000,False)
    report,picked,headers,inferred,has_year=best
    records={}; warnings=[]; locations={}
    number, style = _sheet_numbers(sheet, picked, report['header_row'])
    percent_cells = {tuple(cell) for cell in sheet.get('percent_cells', [])}
    warnings.append(f'{name}: Number format: {style}; review numeric text conventions.')
    if 'on_order' in picked and headers[picked['on_order'][0]] != 'on_order':
        index = picked['on_order'][0]
        vals = [number(r[index]) for r in rows[report['header_row']:] if index < len(r) and _trim(r[index])]
        if not any(NUMERIC.fullmatch(v) or v == AMBIGUOUS_NUMBER for v in vals):
            del picked['on_order']
            report['mapping'][index].update(field=None, confidence='none', reason='No numeric on_order values')
            report['unmapped'].append(headers[index])
            warnings.append(f'{name}: {headers[index]} ignored: no numeric on_order values parsed; no incoming stock counted')
    for field, hits in picked.items():
        if len(hits) > 1 and re.fullmatch(r'(?:rcv:)?[0-9]{4}-[0-9]{2}', field):
            warnings.append(f'{name}: duplicate month columns for {field} summed; review mapping.')
    if any(_yearless(_trim(h)[4:] if _trim(h).lower().startswith('rcv:') else h) for h in headers):
        warnings.append(f'{name}: month labels without a year use {inferred}' + (' inferred from other headers.' if has_year else '; no year found, review the fixed 2000 placeholder.'))
    skipped=0
    for rownum, row in enumerate(rows[report['header_row']:], report['header_row'] + 1):
        get=lambda f: _trim(row[picked[f][0]]) if f in picked and picked[f][0] < len(row) else ''
        sku=get('sku')
        if not any(_trim(v) for v in row): continue
        def summary(value):
            k = _key(value)
            return k in ('total','totals','grand total','subtotal','sub total') or k.endswith((' total',' subtotal',' sub total'))
        if not sku or summary(sku) or summary(get('name')):
            skipped+=1; continue
        if get('active').lower() in ('false','0','no','inactive') or get('inactive').lower() in ('true','1','yes','inactive'):
            warnings.append(f'{name}: row {rownum} inactive in ERP; row omitted.'); continue
        # Preflight normally rejects negative stock/incoming per row. Do not
        # let aggregation hide a bad count by netting it against another site.
        negative_fields = [f for f in ('on_hand','on_order') if report['layout'] != 'long' and _add('0',number(get(f))).startswith('-')]
        if negative_fields:
            warnings.append(f'{name}: row {rownum} negative {negative_fields[0]} in ERP; row omitted.'); continue
        location = get('location').casefold().lower()
        if sku in records:
            record = records[sku]
            reason = None
            if (record.get('unit') or 'units') != (get('unit') or 'units'):
                reason = 'conflicting stock units'
            elif report['layout'] != 'long':
                if not location or '' in locations[sku]: reason = 'duplicate sku without warehouse/location'
                elif location in locations[sku]: reason = 'duplicate sku at same warehouse/location'
                elif 'on_hand' in picked and (not record.get('on_hand') or not get('on_hand')): reason = 'missing on-hand stock for warehouse row'
            if reason:
                warnings.append(f'{name}: {sku}: {reason}; first row kept; row omitted ({rownum}).'); continue
            if report['layout'] != 'long':
                warnings.append(f'{name}: {sku}: combined distinct warehouse/location rows; stock, on order, sales and receipts summed; first-row metadata kept.')
        record=records.setdefault(sku,{})
        locations.setdefault(sku,set()).add(location)
        for f in picked:
            if f in ('date','quantity','sku','location','active','inactive'): continue
            is_month=bool(re.fullmatch(r'(?:rcv:)?[0-9]{4}-[0-9]{2}',f))
            numeric = is_month or f in NUMERIC_FIELDS
            vals=[(number(row[i], f == 'supplier_days') if numeric else _trim(row[i])) if i < len(row) else '' for i in picked[f]]
            for j, index in enumerate(picked[f]):
                if numeric and (rownum - 1, index) in percent_cells and vals[j]:
                    vals[j] = _percent(vals[j]) if f == 'demand_change_pct' else 'percentage-formatted quantity; use stock units'
                if is_month and not f.startswith('rcv:') and report['layout'] != 'long' and _add('0', vals[j]).startswith('-'):
                    vals[j] = '0'
                    warnings.append(f'{name}: {sku}: negative sales in {f} treated as 0 before warehouse aggregation.')
            value=vals[0]
            if is_month:
                for v in vals[1:]: value=_add(value,v)
            if f in ('on_hand','on_order') or is_month:
                if report['layout']=='long' and f in ('on_hand','on_order'):
                    if value and not record.get(f): record[f]=value
                    elif value and record.get(f)!=value and not _same_number(value, record[f]):
                        if f == 'on_hand':
                            record[f] = BALANCE_ERROR
                            warnings.append(f'{name}: {sku}: {BALANCE_ERROR}.')
                        else: warnings.append(f'{name}: differing {f} for {sku}; first value kept, not summed across transactions.')
                else: record[f]=_add(record.get(f,''),value)
            elif value:
                record.setdefault(f,value)
        if report['layout']=='long':
            month=_month(get('date'),inferred)
            if month: record[month]=_add(record.get(month,''),number(get('quantity')))
            elif get('date'): warnings.append(f'{name}: unrecognized transaction date for {sku}; quantity not imported.')
    if skipped: warnings.append(f'{name}: skipped {skipped} summary or blank-code rows.')
    report['products']=len(records)
    return report,records,warnings,headers


def understand_workbook(sheets, sheet=None, overrides=None):
    """Suggest mappings and join stock/product/history sheets on exact trimmed SKU.

    Overrides use ``sheetName:index`` keys. Empty values explicitly ignore columns.
    No name or on-hand values are fabricated. Missing stock units alone use units.
    """
    from .sources import ERP_ALIASES
    from .csv_import import PRODUCT_TYPE_ALIASES
    sheets=[{'name':str(s.get('name','Sheet')), 'delimiter':s.get('delimiter'), 'percent_cells':s.get('percent_cells', []), 'rows':[[str(v) if v is not None else '' for v in r] for r in s.get('rows',[])]} for s in sheets]
    _limits(sheets)
    if len({s['name'] for s in sheets}) != len(sheets): raise ValueError('Sheet names must be unique.')
    vocabulary = json.loads(Path(__file__).with_name('smart-import-vocabulary.json').read_text(encoding='utf-8'))
    aliases = {field: [*labels, *vocabulary.get(field, [])] for field, labels in ERP_ALIASES.items()}
    analyses=[_analyse(s,overrides or {},aliases,PRODUCT_TYPE_ALIASES) for s in sheets]
    if not analyses: raise ValueError('Workbook has no worksheets.')
    if sheet is not None:
        found=[i for i,s in enumerate(sheets) if s['name']==sheet or isinstance(sheet,int) and not isinstance(sheet,bool) and i==sheet]
        if not found: raise ValueError('Selected worksheet was not found.')
        base=found[0]
    else:
        def priority(i):
            report=analyses[i][0]; fields={m['field'] for m in report['mapping']}
            return (int('sku' in fields and 'on_hand' in fields),int('sku' in fields),report['score'])
        base=max(range(len(sheets)),key=priority)
    report,products,_,_=analyses[base]
    products={sku:dict(values) for sku,values in products.items()}
    warnings=[w for _,_,ws,_ in analyses for w in ws]
    matched=set(); unmatched=set(); available={m['field'] for m in report['mapping'] if m['field']}
    has_sales = lambda values: any(re.fullmatch(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])', f) and v for f,v in values.items())
    external_sales = False
    for i,(other,records,_,_) in enumerate(analyses):
        if i==base: continue
        external_sales = external_sales or any(has_sales(v) for v in records.values())
        available.update(m['field'] for m in other['mapping'] if m['field'])
        for sku,values in records.items():
            if sku not in products: unmatched.add(sku); continue
            matched.add(sku)
            target=products[sku]
            if target.get('unit') and values.get('unit') and target['unit'] != values['unit']:
                warnings.append(f'{other["name"]}: conflicting stock units for {sku}; auxiliary row omitted, base sheet kept.')
                continue
            for field,value in values.items():
                if not target.get(field): target[field]=value
                elif value and target[field]!=value and field=='unit': warnings.append(f'{other["name"]}: conflicting stock units for {sku}; base sheet value kept.')
    if unmatched: warnings.append(f'{len(unmatched)} product codes in other sheets did not match {report["name"]}; not imported.')
    fields=set().union(*(set(v) for v in products.values())) if products else available
    months=sorted(f for f in fields if re.fullmatch(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])',f))
    receipts=sorted(f for f in fields if re.fullmatch(r'rcv:[1-9][0-9]{3}-(?:0[1-9]|1[0-2])',f))
    headers=FIXED+[f for f in OPTIONAL+PER_ITEM if f in fields]+months+receipts
    canonical=[headers]
    for sku,values in products.items():
        canonical.append([sku if f=='sku' else values.get(f,'') or ('units' if f=='unit' else '') for f in headers])
    missing=[title for f,title in REQUIRED if (not products and f not in available) or
             any((not sku if f == 'sku' else not values.get(f) or f == 'on_hand' and values.get(f) == BALANCE_ERROR) for sku,values in products.items())]
    no_history = sum(not has_sales(v) for v in products.values()) if external_sales else 0
    if no_history:
        message = f'Sales history for {no_history} products (exact SKU match required)'
        missing.append(message)
        warnings.append(message + '; unmatched history is not zero demand; cannot import.')
    if any(m['confidence'] in ('medium','low') for a,_,_,_ in analyses for m in a['mapping']): warnings.append('Some mappings are suggestions; review medium/low-confidence columns before import.')
    return dict(sheets=[a for a,_,_,_ in analyses],sheet_used=report['name'],header_row=report['header_row'],layout=report['layout'],mapping=report['mapping'],unmapped=report['unmapped'],missing=missing,warnings=list(dict.fromkeys(warnings)),match_report={'matched':len(matched),'unmatched':len(unmatched)},fingerprint=json.dumps([[a['name'],h] for a,_,_,h in analyses],ensure_ascii=False,separators=(',',':')),canonical_rows=canonical)
