"""Local import interpretation, mirrored by desktop/input-meaning.js; no forecast math."""
from __future__ import annotations
from copy import deepcopy
from datetime import date
from decimal import Decimal
import math
import re
from .csv_import import number_style, erp_number, NUMERIC
from .sources import erp_month, MAX_QUANTITY
import json
from pathlib import Path
# Single shared contract; sync_input_meaning.py embeds it in the JS mirror.
INPUT_WARNING_PREFIXES = json.loads(Path(__file__).with_name('input-meaning-warning-order.json').read_text())


def ordered_input_warnings(messages):
    def key(text):
        rank = next((i for i, prefix in enumerate(INPUT_WARNING_PREFIXES) if text.startswith(prefix)), len(INPUT_WARNING_PREFIXES))
        # Match JavaScript string comparison (UTF-16 code units), including non-BMP SKU/sheet names.
        return rank, text.encode('utf-16-be', errors='surrogatepass')
    return sorted(set(messages), key=key)


INCOMING_UNKNOWN = 'Incoming orders unknown — counted as 0. Check open POs before ordering.'
INCOMING_PARTLY_UNKNOWN = 'Incoming partly unknown — known incoming retained; check open POs for every warehouse before ordering.'


def input_meaning_choices(raw=None):
    raw = raw or {}
    return {k: raw.get(k) is True for k in ('stock_includes_reserved', 'incoming_not_in_file', 'units_confirmed')}


def review_input_meaning(sheets, report, raw_choices=None, today=None):
    evidence = None
    if report.get('review_sheets') is not None:
        # Preserve source-row completeness and units; arithmetic uses joined facts.
        source_report = {k: v for k, v in report.items() if k not in ('review_sheets', 'review_report')}
        evidence = review_input_meaning(sheets, source_report, {}, today)
        sheets, report = report['review_sheets'], report['review_report']
    today = today or date.today().isoformat()
    choices = input_meaning_choices(raw_choices)
    warnings, reasons, affected = [], list(report.get('reasons', [])), {}
    sheets = deepcopy(sheets)
    def mark(sku, text):
        if sku and text not in affected.setdefault(sku, []):
            affected[sku].append(text)
    def key(value):
        return re.sub(r'\s+', ' ', re.sub(r'[_-]+', ' ', str(value or '').strip().lower()))
    def add_unit(units, sku, value):
        if value:
            units.setdefault(sku, set()).add(key(value))
    for sku, notes in report.get('input_warnings', {}).items():
        for text in notes:
            mark(sku, text)
            if text not in warnings:
                warnings.append(text)
    if choices['stock_includes_reserved']:
        for sku, names in report.get('reserved_missing', {}).items():
            if names:
                text = 'Reserved stock missing in sheets ' + ', '.join(names) + ' — available stock may be overstated; check allocations before ordering.'
                mark(sku, text)
                if text not in warnings:
                    warnings.append(text)
        for sku, notes in report.get('reserved_warnings', {}).items():
            for text in notes:
                mark(sku, text)
    missing = total = sales_rows = missing_sales_rows = reserved_failed = not_launched = 0
    main_rows, sales_evidence, long_sales, wide_sales = [], set(), [], []
    future = reserved_found = False
    latest_month = ''
    stock_units, sales_units, stock_skus, unknown_skus = {}, {}, {}, {}
    incoming_evidence = {}
    for meta in report.get('sheets', []):
        sheet = next((s for s in sheets if s['name'] == meta['name']), None)
        if sheet is None or not sheet['rows']:
            continue
        mappings = meta.get('mapping', [])
        def index(field):
            return next((m['index'] for m in mappings if m.get('field') == field), None)
        headers = sheet['rows'][meta['header_row'] - 1]
        def find(names):
            return next((i for i, h in enumerate(headers) if key(h) in names), -1)
        sku_index, stock_index, incoming, unit, quantity, dates = [index(f) for f in ('sku', 'on_hand', 'on_order', 'unit', 'quantity', 'date')]
        reserved = find(['reserved', 'reserved qty', 'reserved quantity', 'allocated', 'allocated qty', 'allocated stock', 'reserved stock', 'reserved or allocated stock'])
        stock_unit = find(['stock unit', 'stock uom', 'inventory unit'])
        sales_unit = find(['sales unit', 'sales uom', 'sold unit'])
        months = sorted([m for m in mappings if re.fullmatch(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])', m.get('field') or '')], key=lambda m: m['field'])
        if months:
            latest_month = max(latest_month, months[-1]['field'])
        if any(m['field'] > today[:7] for m in months):
            future = True
        rows = sheet['rows'][meta['header_row']:]
        numeric = [i for i in [stock_index, incoming, quantity, *[m['index'] for m in months]] if i is not None and i >= 0]
        delimiter = sheet.get('delimiter') or ','
        style = number_style(rows, numeric, delimiter)
        def numeric_value(raw):
            v = erp_number(str(raw or ''), delimiter, False, style)
            return float(v) if NUMERIC.fullmatch(v) and math.isfinite(float(v)) and 0 <= float(v) <= MAX_QUANTITY else None
        def stock_text(value):
            text = format(value, 'f')
            if '.' in text:
                text = text.rstrip('0').rstrip('.')
            # Keep convention evidence even when subtraction gives an integer.
            if style == 'decimal-comma':
                if '.' not in text:
                    text += '.0'
                text = text.replace('.', ',')
            return text
        reserved_groups, locations = {}, {}
        accepted_rows = set(meta['accepted_rows']) if 'accepted_rows' in meta else None
        for row_index, row in enumerate(rows, meta['header_row']):
            def get(i):
                return '' if i is None or i < 0 or i >= len(row) else str(row[i] or '').strip()
            sku = get(sku_index)
            if not sku or key(sku) in ('total', 'grand total', 'totals'):
                continue
            if key(get(index('active'))) in ('false', '0', 'no', 'inactive') or key(get(index('inactive'))) in ('true', '1', 'yes', 'inactive'):
                continue
            history = [(m['field'], bool(get(m['index']))) for m in months]
            main = None
            if any(get(m['index']) for m in months):
                sales_evidence.add(sku)
            if meta['name'] == report['sheet_used']:
                stock_skus[sku] = None
                total += 1
                main = dict(sku=sku, missing=not get(stock_index), needs_sales=not months and quantity is None)
                main_rows.append(main)
                add_unit(stock_units, sku, get(stock_unit if stock_unit >= 0 else unit))
                if reserved >= 0:
                    reserved_found = True
                # Match the importer: distinct locations with one stock unit contribute.
                location = get(index('location')).lower()
                prior = locations.setdefault(sku, [])
                usable = numeric_value(get(stock_index)) is not None and (not choices['stock_includes_reserved'] or reserved < 0 or numeric_value(get(reserved) or '0') is not None)
                contributes = usable and (row_index in accepted_rows if accepted_rows is not None else not prior or quantity is not None or (location and all(p[0] and p[0] != location and p[1] == get(unit) for p in prior)))
                if contributes:
                    prior.append((location, get(unit)))
                if contributes and numeric_value(get(stock_index)) is not None:
                    incoming_evidence.setdefault(sku, []).append(bool(get(incoming)))
                if choices['stock_includes_reserved'] and reserved >= 0 and stock_index is not None:
                    stock, held = numeric_value(get(stock_index)), numeric_value(get(reserved) or '0')
                    if not get(reserved):
                        mark(sku, 'Reserved cell is blank — counted as 0; check allocations before ordering.')
                    if 'available' in key(headers[stock_index]):
                        mark(sku, 'Stock header says already available — subtracting reserved again may double-count allocations.')
                    if stock is None or held is None:
                        reserved_failed += 1
                        detail = 'Stock is blank but reserved is filled — available stock cannot be calculated.' if not get(stock_index) and get(reserved) else 'Reserved stock could not be subtracted — check stock and reserved quantities.'
                        row[stock_index] = detail if detail.startswith('Stock is blank') else 'Invalid reserved stock'
                        mark(sku, detail)
                    else:
                        if held > stock:
                            mark(sku, 'Oversold: reserved exceeds stock in a warehouse — available stock is netted across contributing warehouses, then floored at 0. Check allocations before ordering.')
                        net = Decimal(str(stock)) - Decimal(str(held))
                        if contributes:
                            group = sku if quantity is None else (sku, id(row))
                            reserved_groups.setdefault(group, []).append((row, net))
                        else:
                            row[stock_index] = stock_text(max(Decimal(0), net))
                if choices['incoming_not_in_file'] and incoming is not None:
                    row[incoming] = '0'
            if months:
                wide_sales.append((sku, history, main))
                if main is None:
                    sales_rows += 1
            if quantity is not None:
                sales_rows += 1
                month = erp_month(get(dates)) if dates is not None else None
                long_sales.append((sku, month, bool(get(quantity))))
                if get(quantity):
                    sales_evidence.add(sku)
            add_unit(sales_units, sku, get(sales_unit if sales_unit >= 0 else unit if quantity is not None or months else None))
            if dates is not None:
                m = erp_month(get(dates))
                if m:
                    latest_month = max(latest_month, m)
                if m and m > today[:7] or re.fullmatch(r'\d{4}-\d{2}-\d{2}', get(dates)) and get(dates) > today:
                    future = True
        for entries in reserved_groups.values():
            remaining = max(Decimal(0), sum((net for _, net in entries), Decimal(0)))
            for row, net in entries:
                value = min(max(Decimal(0), net), remaining)
                row[stock_index] = stock_text(value)
                remaining -= value
    launch_counts = {}
    first_long_sale = {}
    for sku, month, present in long_sales:
        if present and month:
            first_long_sale[sku] = min(first_long_sale.get(sku, month), month)
    for sku, history, _ in wide_sales:
        for month, present in history:
            if present:
                first_long_sale[sku] = min(first_long_sale.get(sku, month), month)
    for sku, history, main in wide_sales:
        first_sale = first_long_sale.get(sku)
        missing_month = False
        for month, present in history:
            if not present:
                if first_sale and month < first_sale:
                    not_launched += 1
                    launch_counts[sku] = launch_counts.get(sku, 0) + 1
                else:
                    missing_month = True
        if main is not None:
            main['missing'] = main['missing'] or missing_month
        elif missing_month:
            missing_sales_rows += 1
    for sku, month, present in long_sales:
        if not present:
            if month and sku in first_long_sale and month < first_long_sale[sku]:
                not_launched += 1
                launch_counts[sku] = launch_counts.get(sku, 0) + 1
            else:
                missing_sales_rows += 1
    missing = sum(1 for r in main_rows if r['missing'] or r['needs_sales'] and r['sku'] not in sales_evidence)
    if evidence is not None:
        missing, total = evidence['missing_rows'], evidence['total_rows']
        missing_sales_rows, sales_rows = evidence['missing_sales_rows'], evidence['sales_rows']
        not_launched = evidence['not_yet_launched_cells']
        for row in evidence['affected']:
            for text in row['warnings']:
                if text.startswith(('Sales and stock units', 'Sales dates', 'Latest month', 'New product:')):
                    mark(row['sku'], text)
        for text in evidence['warnings']:
            if text.startswith(('Sales and stock units', 'Sales dates', 'Latest month', 'New product:')) and text not in warnings:
                warnings.append(text)
        for text in evidence['reasons']:
            if text not in reasons:
                reasons.append(text)
    else:
        for sku, count in launch_counts.items():
            text = f'New product: {count} months before first sale ignored'
            mark(sku, text)
            if text not in warnings:
                warnings.append(text)
    if reserved_failed:
        text = f'Reserved stock could not be subtracted for {reserved_failed} rows — they were set aside. Check stock and reserved quantities before ordering.'
        warnings.append(text)
        reasons.append(text)
    if choices['stock_includes_reserved'] and not reserved_found:
        text = 'Stock includes reserved or allocated stock, but no reserved column was found. Available stock may be overstated — check allocations before ordering.'
        warnings.append(text)
        for sku in stock_skus:
            mark(sku, text)
    for entries in affected.values():
        for text in entries:
            if text.startswith(('Oversold:', 'Stock header')) and text not in warnings:
                warnings.append(text)
    for sku in stock_skus:
        evidence = report.get('incoming_evidence', incoming_evidence).get(sku, [])
        if choices['incoming_not_in_file'] or not evidence or not all(evidence):
            unknown_skus[sku] = None
            text = INCOMING_PARTLY_UNKNOWN if not choices['incoming_not_in_file'] and any(evidence) else INCOMING_UNKNOWN
            if text not in warnings:
                warnings.append(text)
            mark(sku, text)
    for sku in dict.fromkeys([*stock_units, *sales_units]):
        units = stock_units.get(sku, set()) | sales_units.get(sku, set())
        if len(units) > 1:
            mark(sku, 'Sales and stock units disagree — convert both to the same unit before ordering.')
    if any(any(s.startswith('Sales and stock units') for s in a) for a in affected.values()):
        warnings.append('Sales and stock units disagree — convert both to the same unit before ordering.')
        reasons.append(warnings[-1])
    if total and missing / total > 0.2 or sales_rows and missing_sales_rows / sales_rows > 0.2:
        reasons.append('More than 20% of rows lack stock or sales. Missing sales can look like zero demand; check the file before ordering.')
    if future:
        text = 'Sales dates are in the future. Dates may be shifted — check the sales period before ordering.'
        reasons.append(text)
        warnings.append(text)
        for sku in stock_skus:
            mark(sku, text)
    if latest_month == today[:7]:
        text = f'Latest month ({latest_month}) is still in progress — partial sales may lower the forecast. Remove it or wait for month end.'
        warnings.append(text)
        reasons.append(text)
        for sku in stock_skus:
            mark(sku, text)
    return dict(sheets=sheets, choices=choices, warnings=ordered_input_warnings(warnings), affected=[dict(sku=sku, warnings=ordered_input_warnings(w)) for sku, w in sorted(affected.items(), key=lambda entry: entry[0].encode('utf-16-be', errors='surrogatepass'))], incoming_unknown=list(unknown_skus), requires_ack=bool(reasons), reasons=ordered_input_warnings(reasons), missing_rows=missing, total_rows=total, missing_sales_rows=missing_sales_rows, sales_rows=sales_rows, not_yet_launched_cells=not_launched, rows_kept=total-reserved_failed, rows_flagged=len(set(stock_skus).intersection(affected)))


def attach_input_meaning(data, review):
    for item in data['items']:
        for note in item.get('expiry_warnings', []):
            if 'lot total does not match' not in note and 'missing lot quantity' not in note: continue
            message = item['sku'] + ': ' + note
            if message not in review['reasons']: review['reasons'].append(message)
            if message not in review['warnings']: review['warnings'].append(message)
            row = next((r for r in review['affected'] if r['sku'] == item['sku']), None)
            if row is None:
                row = dict(sku=item['sku'], warnings=[])
                review['affected'].append(row)
            if message not in row['warnings']: row['warnings'].append(message)
            review['requires_ack'] = True
        if (review['choices']['incoming_not_in_file'] or item.get('on_order') is None) and item['sku'] not in review['incoming_unknown']:
            review['incoming_unknown'].append(item['sku'])
            if INCOMING_UNKNOWN not in review['warnings']:
                review['warnings'].append(INCOMING_UNKNOWN)
            row = next((r for r in review['affected'] if r['sku'] == item['sku']), None)
            if row is None:
                row = dict(sku=item['sku'], warnings=[])
                review['affected'].append(row)
            if INCOMING_UNKNOWN not in row['warnings']:
                row['warnings'].append(INCOMING_UNKNOWN)
        item['input_warnings'] = ordered_input_warnings(next((r['warnings'] for r in review['affected'] if r['sku'] == item['sku']), []))
        if item['sku'] in review['incoming_unknown']:
            if review['choices']['incoming_not_in_file']:
                item.pop('on_order', None)
            item['incoming_unknown'] = True
    review['warnings'] = ordered_input_warnings(review['warnings'])
    for row in review['affected']:
        row['warnings'] = ordered_input_warnings(row['warnings'])
    report = data.get('import_report', {})
    headers = report.get('source_headers', [])
    sku_source = next((m['source'] for m in report.get('matched', []) if m['field'] == 'sku'), 'sku')
    sku_index = headers.index(sku_source) if sku_source in headers else 0
    for entry in report.get('rows_set_aside', []):
        values = entry.get('values', [])
        sku = str(values[sku_index]).strip() if sku_index < len(values) else ''
        notes = next((r['warnings'] for r in review['affected'] if r['sku'] == sku), [])
        detail = next((w for w in notes if w.startswith('Stock is blank but reserved is filled')), None)
        if detail and detail in values and 'on_hand must be a number' in entry.get('reason', ''):
            entry['reason'] = detail
    review['rows_kept'] = report.get('rows_imported', len(data['items']))
    review['rows_flagged'] = sum(bool(item['input_warnings']) for item in data['items'])
    data['input_meaning'] = {k: v for k, v in review.items() if k != 'sheets'}
    return data


def interpret_csv(path, data, choices, today, strict=False, max_bytes=2 * 1024 * 1024):
    """Bounded CSV adapter; retain default parser behavior unless a meaning flag changes facts."""
    import csv
    import io
    from pathlib import Path
    from .csv_import import decode_csv, delimiter_for, preflight_csv
    from .smart_import import contributor_metadata, REVIEW_ALIASES, _key
    from .sources import SourceError, _read_csv_bytes
    with Path(path).expanduser().open('rb') as handle:
        raw = _read_csv_bytes(handle, max_bytes)
    if len(raw) > max_bytes:
        raise SourceError('CSV exceeds the configured byte limit.')
    text = decode_csv(raw)
    delimiter = delimiter_for(text)
    rows = list(csv.reader(io.StringIO(text, newline=''), delimiter=delimiter))
    # Match preflight's logical-record indexing, including multi-cell blank rows.
    rows = [r for r in rows if len(r) > 1 or r and r[0] != '']
    preflight = preflight_csv(text, max_bytes=max_bytes)
    matched = preflight['import_report']['matched']
    headers = rows[0]
    mapping = [dict(index=i, source=h, field=next((m['field'] for m in matched if m['source'] == h), None)) for i, h in enumerate(headers)]
    for entry in mapping:
        if entry['field'] is None:
            entry['field'] = next((field for field, aliases in REVIEW_ALIASES.items() if _key(entry['source']) in aliases), None)
    meta = dict(name='CSV', header_row=1, mapping=mapping, accepted_rows=preflight['import_report']['accepted_rows'])
    report = dict(sheet_used='CSV', sheets=[meta])
    sheet = dict(name='CSV', rows=rows, delimiter=delimiter)
    def serialize(source_rows):
        out = io.StringIO(newline='')
        csv.writer(out, delimiter=delimiter, lineterminator='\r\n').writerows(source_rows)
        return out.getvalue()
    def parse_internal(generated, strict=False):
        # The user's byte budget was already enforced on the original file.
        # Serialization/diagnostic text may grow; do not apply a file-size gate
        # again to our own bounded, generated representation.
        return preflight_csv(generated, strict=strict, max_bytes=max(max_bytes, len(generated.encode('utf-8'))))
    # Ask the existing CSV importer which rows it really sums. Workbook joins
    # have different duplicate/blank-location rules; do not approximate them.
    provisional = review_input_meaning([sheet], report, choices, today)
    eligibility_text = serialize(provisional['sheets'][0]['rows'])
    eligibility = parse_internal(eligibility_text)
    meta['accepted_rows'] = eligibility['import_report']['accepted_rows']
    report.update(contributor_metadata(sheet, meta))
    review = review_input_meaning([sheet], report, choices, today)
    if choices.get('stock_includes_reserved') or choices.get('incoming_not_in_file'):
        changed = parse_internal(serialize(review['sheets'][0]['rows']), strict=strict)
        original = {item['sku']: item for item in data['items']}
        for item in changed['items']:
            item['receipts'] = original.get(item['sku'], {}).get('receipts', {})
        data = changed
    return attach_input_meaning(data, review)
