"""Bounded, local CSV preflight. Report schema and rules mirror Desktop CORE.

Warehouse rows sum stock, undated incoming, sales and historical receipts.
Other metadata uses the first usable row; differing product units are unsafe.
"""
from __future__ import annotations
import csv
import io
import json
import calendar
import math
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from .sources import MAX_CSV_BYTES

ENCODING_ERROR = 'File is not UTF-8; re-export as CSV UTF-8'
FIXED = ['sku', 'name', 'unit', 'on_hand', 'supplier_days']
OPTIONAL = ['category', 'supplier', 'on_order', 'demand_change_pct', 'last_count_date']
PER_ITEM = ['minimum_order', 'pack_size', 'unit_cost', 'sale_price', 'shelf_life_days']
LOT_FIELDS = ['lots', 'lot', 'expiry', 'lot_qty']
# Existing ERP aliases keep their rank; plain Product remains a product-name alias.
PRODUCT_TYPE_ALIASES = ('type', 'product product category', 'categ id')


def product_type_rows(rows):
    """Resolve type aliases before the legacy strict normalizer's prefix shortcut."""
    from .sources import ERP_ALIASES, _header_key
    if not rows:
        return rows
    aliases = [*ERP_ALIASES['category'], *PRODUCT_TYPE_ALIASES]
    hits = [(aliases.index(_header_key(h)), i) for i, h in enumerate(rows[0])
            if _header_key(h) in aliases]
    # Preserve the existing duplicate-canonical-column rejection.
    if not hits or rows[0].count('category') > 1:
        return rows
    chosen = min(hits)[1]
    others = {i for _, i in hits if i != chosen}
    return [['category' if rownum == 0 and i == chosen else value for i, value in enumerate(row)
             if i not in others] for rownum, row in enumerate(rows)]

NUMERIC = re.compile(r'^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$')


def expiry_date(raw):
    """Normalize bounded expiry text; US-first ambiguous dates remain unapproved."""
    from .sources import SourceError, erp_month
    raw = import_trim(raw)
    if len(raw) > 256: raise SourceError('invalid expiry date')
    notes, ambiguous = [], False
    try:
        if re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', raw):
            parsed = date.fromisoformat(raw)
        elif re.fullmatch(r'[0-9]{4}-[0-9]{2}|[0-9]{1,2}[-/.][0-9]{4}|[A-Za-z]{3,9}[\s\-/.,\']*[0-9]{4}', raw):
            normalized = erp_month(raw)
            if not normalized: raise ValueError
            year, month = map(int, normalized.split('-'))
            parsed = date(year, month, calendar.monthrange(year, month)[1])
            notes.append('month-only expiry interpreted as end of month')
        elif re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', raw):
            serial = float(raw)
            if not 1 <= serial <= 2958465: raise ValueError
            days = math.floor(serial)
            parsed = date(1899, 12, 31) + timedelta(days=days if days < 60 else days - 1)
            notes.append('Excel serial expiry interpreted using 1900 date system')
        else:
            match = re.fullmatch(r'([0-9]{1,2})([/.\-])([0-9]{1,2})\2([0-9]{4})', raw)
            if not match: raise ValueError
            first, second, year = int(match[1]), int(match[3]), int(match[4])
            ambiguous = 1 <= first <= 12 and 1 <= second <= 12 and first != second
            month, day = (first, second) if first <= 12 else (second, first)
            parsed = date(year, month, day)
            if ambiguous: notes.append('ambiguous expiry date interpreted month/day/year; acknowledge before ordering')
        if parsed.year < 1000: raise ValueError
    except (ValueError, OverflowError):
        raise SourceError('invalid expiry date') from None
    return parsed.isoformat(), notes, ambiguous


def merge_lots(lots):
    """Aggregate legitimate repeated lot rows, retaining an unapproved date flag."""
    from .sources import SourceError, MAX_QUANTITY
    result, seen = [], {}
    for lot in lots:
        key = (lot['lot'], lot['expiry'])
        if key not in seen:
            seen[key] = dict(lot); result.append(seen[key])
        else:
            seen[key]['qty'] += lot['qty']
            if lot.get('expiry_acknowledged') is False: seen[key]['expiry_acknowledged'] = False
        if seen[key]['qty'] > MAX_QUANTITY: raise SourceError('combined lot quantity exceeds 1000000000000')
    return result


def lot_fields(get, number, rownum=2, *, has_lot_qty=False):
    """Parse one lot row or a canonical JSON lot list, never trusting approval text."""
    from .sources import SourceError, _number
    raw = get('lots')
    if raw:
        try: source = json.loads(raw)
        except (ValueError, RecursionError): raise SourceError('lots must be a JSON list') from None
        if not isinstance(source, list) or len(source) > 10000: raise SourceError('lots must be a JSON list of at most 10000 lots')
    elif any(get(f) for f in ('lot', 'expiry', 'lot_qty')):
        if has_lot_qty and not get('lot_qty'):
            # A blank explicit lot quantity is unknown, not product stock or 0.
            if not get('expiry'): raise SourceError('each lot requires an expiry date')
            _, notes, _ = expiry_date(get('expiry'))
            return [], [*notes, 'missing lot quantity; lot stock unknown; acknowledge before ordering']
        source = [dict(lot=get('lot'), expiry=get('expiry'), qty=number(get('lot_qty') or get('on_hand')))]
    else: return [], []
    lots, warnings = [], []
    for entry in source:
        if not isinstance(entry, dict) or not isinstance(entry.get('lot'), str) or not isinstance(entry.get('expiry'), str):
            raise SourceError('each lot requires lot, expiry and qty')
        if not entry['expiry']: raise SourceError('each lot requires an expiry date')
        qty = entry.get('qty')
        if isinstance(qty, bool) or not isinstance(qty, (str, int, float)): raise SourceError('each lot requires a numeric qty')
        value = _number(str(qty), rownum, 'lot_qty')
        expiry, notes, ambiguous = expiry_date(entry['expiry'])
        lot = dict(lot=import_trim(entry['lot']), expiry=expiry, qty=value)
        if ambiguous or entry.get('expiry_acknowledged') is False:
            lot['expiry_acknowledged'] = False
            if not ambiguous: notes.append('ambiguous expiry date requires acknowledgement before ordering')
        warnings.extend(notes); lots.append(lot)
    return merge_lots(lots), list(dict.fromkeys(warnings))


# Explicit shared boundary/lead whitespace; retains legacy identifier trimming.
IMPORT_WHITESPACE = ' \t\n\r\v\f\x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def import_trim(raw):
    return raw.strip(IMPORT_WHITESPACE)


def decode_csv(raw):
    from .sources import SourceError
    try:
        if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
            return raw.decode('utf-16')
        text = raw.decode('utf-8-sig')
        if '\x00' in text or '\ufffd' in text:
            raise UnicodeError
        return text
    except UnicodeError:
        raise SourceError(ENCODING_ERROR) from None


def delimiter_for(text):
    # Count only unquoted separators in the header, not decimal commas in data.
    counts = {',': 0, ';': 0, '\t': 0}
    quoted = False
    for c in text:
        if c == '"': quoted = not quoted
        elif c in '\r\n' and not quoted: break
        elif c in counts and not quoted: counts[c] += 1
    return max(counts, key=lambda key: counts[key])


AMBIGUOUS_NUMBER = 'ambiguous number format'


def number_parts(raw):
    t = import_trim(raw)
    negative = t.startswith('(') and t.endswith(')')
    if negative: t = import_trim(t[1:-1])
    currency = bool(re.search(r'^[$€£¥₹﷼]|[$€£¥₹﷼]$', t))
    t = import_trim(re.sub(r'^[$€£¥₹﷼]|[$€£¥₹﷼]$', '', t))
    if re.fullmatch(r'[+-]?[0-9]{1,3}(?:[ \t\u00a0\u2007\u202f\ufeff][0-9]{3})+(?:[.,][0-9]+)?', t):
        t = re.sub(r'[ \t\u00a0\u2007\u202f\ufeff]', '', t)
    return t, negative, currency


def number_style(rows, indices, delimiter):
    # A single convention for the file, scanning only recognized numeric cells.
    if delimiter == ';':
        for row in rows:
            for idx in indices:
                if idx < len(row) and len(row[idx]) <= 256:
                    t, _, _ = number_parts(row[idx])
                    if re.fullmatch(r'[+-]?(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+),[0-9]+', t):
                        return 'decimal-comma'
    return 'decimal-dot'


def erp_number(raw, delimiter=',', lead=False, style='decimal-dot', mixed=False):
    t = import_trim(raw)
    if len(t) > 256: return raw
    if lead:
        m = re.fullmatch(rf'([0-9][0-9.,]*)[{re.escape(IMPORT_WHITESPACE)}]*(days?|weeks?|months?)', t.lower())
        if m:
            value = erp_number(m[1], delimiter, False, style, mixed)
            if value == AMBIGUOUS_NUMBER: return value
            if NUMERIC.fullmatch(value):
                return str(float(value) * (7 if m[2].startswith('week') else 30 if m[2].startswith('month') else 1))
    t, negative, currency = number_parts(t)
    dotted_group = re.fullmatch(r'[+-]?[1-9][0-9]{0,2}(?:\.[0-9]{3})+(?:,[0-9]+)?', t)
    if style == 'decimal-comma':
        # A currency value with three comma digits can also be thousands.
        if (currency or mixed) and re.fullmatch(r'[+-]?[1-9][0-9]{0,2},[0-9]{3}', t): return AMBIGUOUS_NUMBER
        if mixed and dotted_group and ',' not in t: return AMBIGUOUS_NUMBER
        if dotted_group: t = t.replace('.', '').replace(',', '.')
        elif re.fullmatch(r'[+-]?[0-9]+,[0-9]+', t): t = t.replace(',', '.')
        elif ('.' in t or ',' in t) and re.fullmatch(r'[+-]?[0-9][0-9.,]*(?:[eE][+-]?[0-9]+)?', t): return AMBIGUOUS_NUMBER
    else:
        if delimiter == ';' and dotted_group: return AMBIGUOUS_NUMBER
        if re.fullmatch(r'[+-]?[1-9][0-9]{0,2}(?:,[0-9]{3})+(?:\.[0-9]+)?', t) or re.fullmatch(r'[+-]?[1-9][0-9]?(?:,[0-9]{2})+,[0-9]{3}(?:\.[0-9]+)?', t):
            t = t.replace(',', '')
        elif ',' in t and re.fullmatch(r'[+-]?[0-9][0-9.,]*', t): return AMBIGUOUS_NUMBER
    return '-' + t if negative else t


def import_csv(path, strict=False, *, max_bytes=MAX_CSV_BYTES):
    from .sources import SourceError, _csv_byte_limit, _read_csv_bytes
    limit = _csv_byte_limit(max_bytes)
    size_error = f'CSV must be a local file no larger than {limit}.'
    if not isinstance(path, str) or not path.strip():
        raise SourceError('CSV source requires an explicit local csv_path.')
    try:
        p = Path(path).expanduser().resolve(strict=True)
        if not p.is_file() or p.stat().st_size > max_bytes:
            raise SourceError(size_error)
        # A file can grow after stat; never perform an unbounded read.
        with p.open('rb') as handle: raw = _read_csv_bytes(handle, max_bytes)
        if len(raw) > max_bytes: raise SourceError(size_error)
        return preflight_csv(decode_csv(raw), strict=strict, max_bytes=max_bytes)
    except (OSError, csv.Error):
        raise SourceError('Could not read the local CSV file.') from None


def preflight_csv(text, strict=False, *, max_bytes=MAX_CSV_BYTES):
    from .sources import (SourceError, _parse_canonical_csv, normalize_erp_rows,
                          _header_key, _ALIAS_LOOKUP, erp_month, MAX_ROWS, MAX_QUANTITY, _csv_byte_limit)
    limit = _csv_byte_limit(max_bytes)
    if len(text) > max_bytes or len(text.encode('utf-8')) > max_bytes:
        raise SourceError(f'CSV must be no larger than {limit}.')
    if '\ufffd' in text or '\x00' in text: raise SourceError(ENCODING_ERROR)
    text = text.removeprefix('\ufeff')
    old_limit = csv.field_size_limit()
    delimiter = delimiter_for(text)
    rows, row_numbers = [], []
    try:
        csv.field_size_limit(max_bytes)
        reader = csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, strict=True)
        previous_line = 0
        for row in reader:
            line = previous_line + 1
            previous_line = reader.line_num
            if len(row) > 1 or row and row[0] != '':
                rows.append(row); row_numbers.append(line)
    except csv.Error: raise SourceError('Could not read the local CSV file.') from None
    finally:
        csv.field_size_limit(old_limit)
    if strict:
        if rows and any(_ALIAS_LOOKUP.get(_header_key(h), ('',))[0] in [*LOT_FIELDS, 'shelf_life_days'] for h in rows[0]):
            result = preflight_csv(text, max_bytes=max_bytes)
            report = result.pop('import_report')
            if report['rows_set_aside']: raise SourceError(report['rows_set_aside'][0]['reason'])
            return result
        return _parse_canonical_csv(normalize_erp_rows(product_type_rows(rows)))
    headers = rows[0] if rows else []
    if len(rows) - 1 > MAX_ROWS: raise SourceError('CSV contains more than 10000 rows.')
    aliases = dict(_ALIAS_LOOKUP)
    for rank, key in enumerate(PRODUCT_TYPE_ALIASES, 100):
        aliases.setdefault(key, ('category', rank))
    picked, ranks, months, receipts = {}, {}, [], []
    for idx, raw in enumerate(headers):
        raw = import_trim(raw)
        key = _header_key(raw)
        low = raw.strip().lower()
        month = erp_month(raw.strip()[4:] if low.startswith('rcv:') else raw)
        if month:
            (receipts if low.startswith('rcv:') else months).append((('rcv:' if low.startswith('rcv:') else '') + month, idx))
            continue
        if low.startswith('rcv:'):
            receipts.append((raw, idx)); continue
        hit = aliases.get(key) or aliases.get(key.replace(' ', ''))
        if hit:
            field, rank = hit
            if field not in ranks or rank < ranks[field]: picked[field], ranks[field] = idx, rank
    if 'sku' not in picked and 'name' in picked:
        plain = [i for i,h in enumerate(headers) if _header_key(h) == 'name' and i != picked['name']]
        descriptions = [i for i,h in enumerate(headers) if _header_key(h) == 'description']
        if plain: picked['sku'] = plain[0]
        elif _header_key(headers[picked['name']]) == 'name' and descriptions:
            picked['sku'], picked['name'] = picked['name'], descriptions[0]
    for field, title in [('category','Category'),('supplier','Supplier'),('on_order','On order'),('demand_change_pct','demand_change_pct'),('last_count_date','last_count_date')]:
        if headers.count(field) > 1: raise SourceError(f'{title} column must be unique.')
    canonical = headers[:5] == FIXED
    if not canonical: months.sort(); receipts.sort()
    if not {'sku','name','on_hand'} <= picked.keys():
        raise SourceError('CSV columns must begin: sku,name,unit,on_hand,supplier_days. Common ERP names also work, e.g. Item Code, Item Name, UoM, Qty On Hand, Lead Time.')
    numeric_indices = [idx for field,idx in picked.items() if field in ['on_hand','supplier_days','on_order','demand_change_pct','lot_qty',*PER_ITEM]] + [idx for _,idx in months+receipts]
    style = number_style(rows[1:], numeric_indices, delimiter)
    # Adding an optional sale price cannot alter pre-existing inventory numbers.
    # Keep the legacy evidence set and parsing for every other numeric field.
    quantity_indices = [idx for idx in numeric_indices if idx != picked.get('sale_price')]
    quantity_style = number_style(rows[1:], quantity_indices, delimiter)
    def mixed_for(indices, convention):
        return convention == 'decimal-comma' and any(
            '.' in row[idx] and NUMERIC.fullmatch(erp_number(row[idx], ',', idx == picked.get('supplier_days')))
            and erp_number(row[idx], delimiter, idx == picked.get('supplier_days'), convention) == AMBIGUOUS_NUMBER
            for row in rows[1:] for idx in indices if idx < len(row) and len(row[idx]) <= 256)
    mixed = mixed_for(numeric_indices, style)
    quantity_mixed = mixed_for(quantity_indices, quantity_style)
    number = lambda raw, lead=False: erp_number(raw, delimiter, lead, quantity_style, quantity_mixed)
    price_number = lambda raw: erp_number(raw, delimiter, False, style, mixed)
    dropped_order = None
    if 'on_order' in picked and headers[picked['on_order']] != 'on_order':
        vals = [number(r[picked['on_order']]) for r in rows[1:] if picked['on_order'] < len(r) and import_trim(r[picked['on_order']])]
        if not any(NUMERIC.fullmatch(v) or v == AMBIGUOUS_NUMBER for v in vals):
            dropped_order = headers[picked.pop('on_order')]
    fields = {idx: field for field,idx in picked.items()}
    fields.update({idx: field for field,idx in months + receipts})
    report: dict[str, Any] = dict(matched=[dict(source=h,field=fields[i]) for i,h in enumerate(headers) if i in fields],
                  ignored=[h for i,h in enumerate(headers) if i not in fields], defaulted=[],
                  rows_imported=0, products_ready=0, rows_set_aside=[], accepted_rows=[], warnings=[], source_headers=headers)
    report['warnings'].append('Number format: ' + style + (' (comma decimal; dot thousands)' if style == 'decimal-comma' else ' (dot decimal; comma thousands)'))
    if dropped_order is not None: report['warnings'].append(f'{dropped_order} ignored: no numeric on_order values parsed; no incoming stock counted')
    if 'unit' not in picked: report['defaulted'].append(dict(field='unit', value='units', reason='unit column missing'))
    if 'supplier_days' not in picked: report['defaulted'].append(dict(field='supplier_days',value=None,reason='lead time missing'))
    if any(_header_key(h) in ('purchase uom','purchase unit of measure') for h in report['ignored']):
        report['warnings'].append('Purchase UoM ignored; quantities must already use the stock unit')
    if any(_header_key(h) in ('expected date','expected') for h in report['ignored']):
        report['warnings'].append('Expected dates ignored; no confirmed incoming deliveries were created')
    output_headers = FIXED + [f for f in OPTIONAL if f in picked] + [m for m,_ in months+receipts]
    # Validate file schema even when every data row will be set aside.
    dummy = ['CHECK','Check','units','0',''] + ['' if f in ('category','supplier','on_order','demand_change_pct','last_count_date') else '0' for f in output_headers[5:]]
    schema = _parse_canonical_csv([output_headers,dummy])
    items, by_sku, combined, locations = [], {}, {}, {}
    lot_snapshots = {}
    blanks = 0
    returns = {}
    missing_lead = 0
    for row_index, (rownum, values) in enumerate(zip(row_numbers[1:], rows[1:]), 1):
        if not any(import_trim(v) for v in values): continue
        get = lambda field: import_trim(values[picked[field]]) if field in picked and picked[field] < len(values) else ''
        def aside(reason): report['rows_set_aside'].append(dict(row=rownum,reason=reason,values=values))
        if get('sku').lower() in ('total','grand total','totals') or not get('sku') and get('name').lower() in ('total','grand total','totals'):
            aside('summary/footer row (not a product)'); continue
        if get('active').lower() in ('false','0','no','inactive') or get('inactive').lower() in ('true','1','yes','inactive'):
            aside('inactive in ERP'); continue
        if not get('sku'): aside('blank sku in ERP — add a reference'); continue
        if len(values) != len(headers): aside(f'Row {rownum}: column count does not match the header.'); continue
        if (any(number(values[idx], idx == picked.get('supplier_days')) == AMBIGUOUS_NUMBER for idx in quantity_indices)
                or 'sale_price' in picked and price_number(get('sale_price')) == AMBIGUOUS_NUMBER):
            aside(AMBIGUOUS_NUMBER); continue
        row_returns = []
        local_blanks = 0
        line = [get('sku'),get('name'),get('unit') if 'unit' in picked else 'units',number(get('on_hand')),number(get('supplier_days'),True)]
        line += [number(get(f)) if f in ('on_order','demand_change_pct') else get(f) for f in OPTIONAL if f in picked]
        try:
            if NUMERIC.fullmatch(line[3]) and float(line[3]) < 0: raise SourceError('negative stock in ERP — fix count')
            for month,idx in months+receipts:
                raw = import_trim(values[idx])
                val = number(raw)
                if not month.startswith('rcv:'):
                    if not raw: val='0'; local_blanks += 1
                    elif NUMERIC.fullmatch(val) and math.isfinite(float(val)) and -MAX_QUANTITY <= float(val) < 0:
                        val='0'; row_returns.append(month)
                line.append(val)
            item = _parse_canonical_csv([output_headers,line])['items'][0]
            for f in PER_ITEM:
                if get(f):
                    if f == 'shelf_life_days' and get(f).lower() in ('none', 'null', '0'):
                        item[f] = None
                        continue
                    from .sources import _number
                    value = _number(price_number(get(f)) if f == 'sale_price' else number(get(f)),rownum,f)
                    if f in ('pack_size','minimum_order') and value != 0:
                        from .engine import valid_order_increment
                        if not valid_order_increment(value): raise SourceError(f'Row {rownum}: {f} must be a valid order increment.')
                    if f == 'pack_size' and value == 0: raise SourceError(f'Row {rownum}: pack_size must be positive.')
                    if f == 'shelf_life_days' and (value <= 0 or int(value) != value): raise SourceError(f'Row {rownum}: shelf_life_days must be a positive integer.')
                    item[f] = value
            lots, lot_notes = lot_fields(get, number, rownum, has_lot_qty='lot_qty' in picked)
            lot_row = bool(lots) or 'lot_qty' in picked and any(get(f) for f in ('lot', 'expiry'))
            if lot_row: item['lots'] = lots
            if lot_notes: item['expiry_warnings'] = lot_notes
            sku=item['sku']
            if sku in by_sku:
                if not lot_row and 'location' not in picked: raise SourceError('duplicate sku without warehouse/location — first row kept')
                if not lot_row and get('location') and get('location').casefold().lower() in locations[sku]: raise SourceError('duplicate sku at same warehouse/location — first row kept')
                first=by_sku[sku]
                if first['unit'] != item['unit']: raise SourceError('warehouse units differ — convert to one stock unit')
                aggregate = {**first,'on_hand':first['on_hand']+item['on_hand'], 'monthly_sales':[a+b for a,b in zip(first['monthly_sales'],item['monthly_sales'])]}
                if 'on_order' in first or 'on_order' in item: aggregate['on_order']=first.get('on_order',0)+item.get('on_order',0)
                if 'historical_receipts' in first: aggregate['historical_receipts']={m:first['historical_receipts'][m]+item['historical_receipts'][m] for m in first['historical_receipts']}
                if lot_row:
                    # Explicit lot quantities accompany a product/location snapshot;
                    # implicit quantities mean each row's on_hand is lot stock.
                    location_key = get('location').casefold().lower()
                    prior = lot_snapshots.get((sku, location_key))
                    if prior is not None:
                        aggregate = dict(first)
                        explicit = 'lot_qty' in picked or bool(get('lots'))
                        if not explicit:
                            aggregate['on_hand'] = first['on_hand'] + item['on_hand']
                        elif prior['on_hand'] != item['on_hand']:
                            lot_notes.append('conflicting stock snapshot across lot rows; first snapshot kept; acknowledge before ordering')
                        if any(prior.get(k) != item.get(k) for k in ('monthly_sales', 'on_order', 'historical_receipts')):
                            lot_notes.append('conflicting sales/incoming snapshot across lot rows; first snapshot kept; acknowledge before ordering')
                    aggregate['lots'] = merge_lots([*first.get('lots', []), *lots])
                    notes = list(dict.fromkeys([*first.get('expiry_warnings', []), *lot_notes]))
                    if notes: aggregate['expiry_warnings'] = notes
                totals=[aggregate['on_hand'],*aggregate['monthly_sales'],aggregate.get('on_order',0),*aggregate.get('historical_receipts',{}).values()]
                if any(v > MAX_QUANTITY for v in totals): raise SourceError('combined warehouse quantity exceeds 1000000000000')
                first.update(aggregate)
                if not lot_row: combined[sku]=combined.get(sku,1)+1
            else: items.append(item); by_sku[sku]=item
            if lot_row:
                lot_snapshots.setdefault((sku, get('location').casefold().lower()), dict(item))
            locations.setdefault(sku, {})[get('location').casefold().lower()] = get('location')
            report['accepted_rows'].append(row_index)
            report['rows_imported']+=1; blanks+=local_blanks; missing_lead += item['supplier_days'] is None; 
            for month in row_returns: returns[month] = returns.get(month, 0) + 1
        except SourceError as error:
            aside(str(error).replace('Row 2:',f'Row {rownum}:') if rownum != 2 else str(error))
    for month,n in returns.items(): report['warnings'].append(f'returns exceeded sales in {month} ({n} rows)')
    for sku,n in combined.items(): report['warnings'].append(f'{sku}: combined {n} warehouse rows ({", ".join(label or "Unspecified" for label in locations[sku].values())}); stock, on order, sales and receipts summed; first-row metadata kept')
    if 'location' in picked and not any(f in picked for f in LOT_FIELDS) and any('' in labels for labels in locations.values()):
        report['warnings'].append('Blank warehouse/location treated as Unspecified; all blank-location rows aggregated, including repeated blanks. Check for duplicate exports.')
    if missing_lead and 'supplier_days' in picked: report['defaulted'].append(dict(field='supplier_days',value=None,reason=f'lead time blank in {missing_lead} imported rows'))
    if 'location' in picked:
        partial = dict.fromkeys(import_trim(r['values'][picked['sku']]) for r in report['rows_set_aside'] if picked['sku'] < len(r['values']) and import_trim(r['values'][picked['sku']]) in by_sku)
        for sku in partial: report['warnings'].append(f'{sku}: some warehouse rows set aside; totals include usable rows only')
    if blanks: report['warnings'].append(f'{blanks} blank sales cells treated as 0')
    for item in items:
        if 'lots' not in item: continue
        notes = item.get('expiry_warnings', [])[:]
        if not math.isclose(sum(lot['qty'] for lot in item['lots']), item['on_hand'], rel_tol=1e-12, abs_tol=1e-9):
            notes.append('lot total does not match on-hand stock; check lot quantities')
        if notes:
            item['expiry_warnings'] = list(dict.fromkeys(notes))
            report['warnings'].extend(f'{item["sku"]}: {note}' for note in item['expiry_warnings'])
    report['products_ready']=len(items)
    if not items:
        error=SourceError('CSV has no usable item rows.' + (' ' + report['rows_set_aside'][0]['reason'] if report['rows_set_aside'] else ''))
        setattr(error, 'import_report', report)
        raise error
    return dict(as_of=schema['as_of'],months=schema['months'],items=items,import_report=report)
