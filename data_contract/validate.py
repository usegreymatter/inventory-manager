#!/usr/bin/env python3
"""Validate local, canonical CSV bundles; never connects to an ERP or places orders.

validate_bundle(path, today=None) returns JSON-compatible diagnostics and per-SKU
DATA-readiness gates. Gates do not assert that a feature is implemented in the app.
Only Python's standard library is used. See docs/data/CONTRACT.md.
"""
from __future__ import annotations

import argparse
import calendar
import csv
from datetime import date
from decimal import Decimal, DecimalException, InvalidOperation
import json
from pathlib import Path
import re

VERSION = '1.0'
MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 10000
LIMIT = Decimal('1000000000000')
PREFIX = ['sku', 'name', 'unit', 'on_hand', 'supplier_days']
# Required columns, all known columns, and unique key for each optional file.
TABLES = {
    'product_master.csv': ('sku', 'sku supplier unit pack_size moq max_order_qty unit_cost cbm weight_kg abc_override critical lifecycle replaced_by', 'sku'),
    'sales_history.csv': ('sku month quantity', 'sku month quantity in_stock_days backorder project', 'sku month'),
    'receipts.csv': ('receipt_id po_id sku warehouse po_date received_date quantity supplier', 'receipt_id po_id sku warehouse po_date promised_date received_date quantity supplier po_complete', 'receipt_id'),
    'incoming_pos.csv': ('po_line_id sku warehouse supplier remaining_qty due_date status', 'po_line_id sku warehouse supplier remaining_qty due_date status', 'po_line_id'),
    'customer_orders.csv': ('order_line_id sku warehouse quantity delivery_date status forecast_included', 'order_line_id sku warehouse quantity delivery_date status forecast_included', 'order_line_id'),
    'warehouses.csv': ('warehouse name', 'warehouse name', 'warehouse'),
    'warehouse_stock.csv': ('sku warehouse on_hand', 'sku warehouse on_hand', 'sku warehouse'),
    'transfers.csv': ('from_warehouse to_warehouse lead_days', 'from_warehouse to_warehouse lead_days', 'from_warehouse to_warehouse'),
    'stock_states.csv': ('sku warehouse damaged reserved quarantine returns', 'sku warehouse damaged reserved quarantine returns', 'sku warehouse'),
    'relationships.csv': ('source_sku target_sku kind direction ratio', 'source_sku target_sku kind direction ratio', 'source_sku target_sku kind'),
    'unit_conversions.csv': ('sku from_unit to_unit factor', 'sku from_unit to_unit factor', 'sku from_unit to_unit'),
    'reorder_rules.csv': ('rule_id sku warehouse min_qty max_qty multiple route trigger', 'rule_id sku warehouse min_qty max_qty multiple route trigger lead_days', 'rule_id'),
    'legacy_receipts.csv': ('sku month quantity', 'sku month quantity', ''),
}
NUMBERS = set('on_hand on_order supplier_days quantity in_stock_days pack_size moq max_order_qty unit_cost cbm weight_kg remaining_qty lead_days damaged reserved quarantine returns ratio factor min_qty max_qty multiple'.split())
POSITIVE = {'pack_size', 'ratio', 'factor', 'multiple'}
DATES = {'last_count_date', 'po_date', 'promised_date', 'received_date', 'due_date', 'delivery_date'}
BOOLS = {'critical', 'backorder', 'project', 'forecast_included', 'po_complete'}
ENUMS = {'abc_override': {'A','B','C'}, 'lifecycle': {'active','new','discontinued'},
         'status': {'confirmed','draft','cancelled'}, 'kind': {'substitute','kit','complement'},
         'direction': {'forward','both'}, 'trigger': {'auto','manual'}}
MONTH_RE = re.compile(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])\Z')
NUMBER_RE = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z')


def _month(value):
    return bool(MONTH_RE.fullmatch(value)) and '1000-01' <= value <= '9998-12'


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise ValueError('Use YYYY-MM-DD.')
    return date.fromisoformat(value)


def _next_month(value):
    y, m = map(int, value.split('-'))
    return f'{y + (m == 12):04d}-{m % 12 + 1:02d}'


def validate_bundle(directory, *, today=None):
    """Return all bounded diagnostics, counts and feature gates; no source writes.

    CSV row numbers include the header (first record is row 2). Empty optional
    cells mean unknown, never zero. Errors are scoped to files/SKUs. A malformed
    manifest locks every gate. Default decision date is snapshot+1 day, NOT clock.
    """
    root = Path(directory)
    errors, warnings, tables, headers = [], [], {}, {}

    def issue(code, filename, row=None, field=None, sku=None, message='', warning=False):
        (warnings if warning else errors).append(dict(code=code, file=filename, row=row,
            field=field, sku=sku, message=message))

    def numeric(raw, filename, line, field, sku):
        try:
            if not NUMBER_RE.fullmatch(raw):
                raise InvalidOperation
            value = Decimal(raw)
            cap = Decimal(3650) if field in {'supplier_days','lead_days'} else LIMIT
            if not value.is_finite() or value < 0 or value > cap or field in POSITIVE and value == 0 or field in {'ratio','factor'} and value < Decimal('1e-12'):
                raise InvalidOperation
            if field in {'pack_size', 'moq', 'max_order_qty', 'multiple'} and value:
                # Decimal.normalize() rounds to the ambient precision and can
                # underflow. Inspect the exact parsed digits without arithmetic.
                parts = value.as_tuple()
                exponent = parts.exponent
                assert isinstance(exponent,int)  # finite values checked above
                digits = parts.digits
                trailing = 0
                for digit in reversed(digits):
                    if digit != 0:
                        break
                    trailing += 1
                if exponent + trailing < -6:
                    raise InvalidOperation
            if field in {'lead_days','in_stock_days'} and value != value.to_integral_value():
                raise InvalidOperation
            return value
        except (DecimalException, ValueError):
            issue('number',filename,line,field,sku,'Use a finite non-negative ASCII number within the documented bounds; positive increments, at most six decimals.')
            return None

    def read_csv(filename, required, allowed, key, stock=False):
        path = root / filename
        if not path.exists():
            if stock:
                issue('missing_file',filename,message='stock.csv is required.')
            return
        tables[filename] = []
        try:
            if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_BYTES:
                issue('file_size',filename,message='Use a regular local file no larger than 2 MiB; symlinks are not followed.')
                return
            with path.open(encoding='utf-8-sig',newline='') as handle:
                reader = csv.reader(handle,strict=True)
                cols = next(reader,[])
                headers[filename] = cols
                if len(cols) != len(set(cols)):
                    issue('duplicate_header',filename,1,message='Column names must be unique.')
                    return
                missing = set(required) - set(cols)
                if missing or stock and cols[:5] != PREFIX:
                    issue('columns',filename,1,message='Missing required columns or wrong stock prefix: '+','.join(sorted(missing)))
                    return
                if not stock:
                    for col in set(cols)-set(allowed):
                        issue('unknown_column',filename,1,col,message='Unknown optional column is ignored.',warning=True)
                seen = set()
                for line, values in enumerate(reader,2):
                    if line > MAX_ROWS+1:
                        issue('row_limit',filename,line,message='At most 10000 data rows per file.')
                        break
                    if len(values) != len(cols):
                        issue('row_width',filename,line,message='Column count does not match header.')
                        continue
                    row = {col:value for col,value in zip(cols,values) if stock or col in allowed}
                    sku = row.get('sku') or row.get('source_sku')
                    row['_row'] = line
                    for col in required:
                        if row.get(col,'') == '' and not (stock and col == 'supplier_days'):
                            issue('required',filename,line,col,sku,'Required value is blank.')
                    for col in cols:
                        if not stock and col not in allowed:
                            continue
                        raw = row[col]
                        if raw != raw.strip():
                            issue('whitespace',filename,line,col,sku,'Values must not have surrounding whitespace; identifiers are not normalized.')
                        if stock and col == 'demand_change_pct':
                            if raw:
                                try:
                                    value = Decimal(raw)
                                    if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', raw) or not value.is_finite() or not -90 <= value <= 300:
                                        raise ValueError
                                    row[col] = value
                                except (DecimalException, ValueError):
                                    issue('number',filename,line,col,sku,'demand_change_pct must be a number from -90 to 300.')
                        elif col in NUMBERS or stock and (_month(col) or col.startswith('rcv:')):
                            if raw == '' and col not in required and not (_month(col) or col.startswith('rcv:')) or raw == '' and col == 'supplier_days':
                                continue
                            row[col] = numeric(raw,filename,line,col,sku)
                        elif col in DATES and raw:
                            try:
                                _date(raw)
                            except ValueError:
                                issue('date',filename,line,col,sku,'Use a real date in YYYY-MM-DD.')
                        elif col in BOOLS and raw and raw not in {'true','false'}:
                            issue('boolean',filename,line,col,sku,'Use true or false; blank is unknown.')
                        elif col in ENUMS and raw and raw not in ENUMS[col] and not (filename == 'incoming_pos.csv' and col == 'status' and raw == 'received'):
                            issue('enum',filename,line,col,sku,'Allowed: '+','.join(sorted(ENUMS[col])))
                    if key:
                        token = tuple(row.get(k) for k in key)
                        if token in seen:
                            issue('duplicate_key',filename,line,','.join(key),sku,'Duplicate record key.')
                        seen.add(token)
                    tables[filename].append(row)
                if not tables[filename]:
                    issue('empty_file',filename,message='No data records; omit unknown optional files instead of supplying an empty file.')
        except (OSError,UnicodeError,csv.Error) as exc:
            issue('read',filename,message='Cannot read bounded UTF-8 CSV: '+type(exc).__name__)

    read_csv('stock.csv',PREFIX,PREFIX,['sku'],stock=True)
    stock = tables.get('stock.csv',[])
    stock_cols = headers.get('stock.csv',[])
    months = [c for c in stock_cols[5:] if c not in {'category','on_order','demand_change_pct','last_count_date'} and not c.startswith('rcv:')]
    if len(months)<3 or any(not _month(m) for m in months) or any(_next_month(a)!=b for a,b in zip(months,months[1:]) if _month(a) and _month(b)):
        issue('months','stock.csv',1,message='At least three consecutive full YYYY-MM sales months from 1000-01 through 9998-12 are required.')
    rcv = [c[4:] for c in stock_cols if c.startswith('rcv:')]
    if rcv and (len(rcv)!=len(months) or set(rcv)!=set(months)):
        issue('receipt_coverage','stock.csv',1,message='rcv: columns must cover every sales month exactly.')
    for filename,(required,allowed,key) in TABLES.items():
        read_csv(filename,required.split(),allowed.split(),key.split())

    manifest = {}
    manifest_path = root/'manifest.json'
    snapshot = None
    if months and _month(months[-1]):
        y,m = map(int,months[-1].split('-'))
        snapshot = date(y,m,calendar.monthrange(y,m)[1])
    if manifest_path.exists():
        try:
            if manifest_path.is_symlink() or manifest_path.stat().st_size > MAX_BYTES:
                raise ValueError
            manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
            if not isinstance(manifest,dict):
                raise ValueError
            if manifest.get('contract_version') != VERSION:
                issue('version','manifest.json',field='contract_version',message='Only exact contract_version 1.0 is supported; do not guess future versions.')
            stated = _date(manifest.get('snapshot_date'))
            if snapshot and stated != snapshot:
                issue('snapshot','manifest.json',field='snapshot_date',message='Snapshot must equal the last full sales month-end, matching the legacy engine.')
            snapshot = stated
            if not re.fullmatch(r'[A-Z]{3}',str(manifest.get('currency',''))):
                issue('currency','manifest.json',field='currency',message='A single uppercase three-letter currency is required; no FX inference.')
            if 'synthetic' in manifest and not isinstance(manifest['synthetic'],bool):
                issue('manifest','manifest.json',field='synthetic',message='synthetic must be a JSON boolean.')
        except (OSError,UnicodeError,ValueError,TypeError,RecursionError):
            manifest = {}  # non-object JSON must not leak into later .get calls
            issue('manifest','manifest.json',message='Malformed manifest or date; all capability gates locked.')
    else:
        issue('legacy_snapshot','manifest.json',message='Legacy file: inferred snapshot at last sales month-end; currency unknown, value features locked.',warning=True)
    try:
        decision = _date(today) if today is not None else date.fromordinal(snapshot.toordinal()+1) if snapshot else None
    except (ValueError,TypeError,OverflowError):
        issue('decision_date','manifest.json',field='today',message='Decision date is outside the supported calendar.')
        decision = None
    if decision and snapshot and decision < snapshot:
        issue('decision_date','manifest.json',field='today',message='Decision date cannot precede the snapshot.')
    if decision and snapshot and (decision-snapshot).days>45:
        issue('stale_snapshot','manifest.json',message='Snapshot is over 45 days old; reconfirm stock before ordering.',warning=True)

    by_sku = {r['sku']:r for r in stock}
    warehouses = {r['warehouse'] for r in tables.get('warehouses.csv',[])}
    master = {r['sku']:r for r in tables.get('product_master.csv',[])}
    for filename, rows in tables.items():
        for row in rows:
            sku = row.get('sku') or row.get('source_sku')
            for field in ('sku','source_sku','target_sku','replaced_by'):
                if row.get(field) and row[field] not in by_sku:
                    issue('unknown_sku',filename,row['_row'],field,sku,'Reference must match stock.csv exactly.')
            for field in ('warehouse','from_warehouse','to_warehouse'):
                if field in row and row[field] not in warehouses:
                    issue('unknown_warehouse',filename,row['_row'],field,sku,'Reference must match warehouses.csv.')
            if filename=='product_master.csv':
                if row.get('unit') and sku in by_sku and row['unit']!=by_sku[sku]['unit']:
                    issue('unit_mismatch',filename,row['_row'],'unit',sku,'Product unit must match the stock base unit.')
                if isinstance(row.get('moq'),Decimal) and isinstance(row.get('max_order_qty'),Decimal) and row['moq']>row['max_order_qty']:
                    issue('order_conflict',filename,row['_row'],'max_order_qty',sku,'MOQ exceeds maximum; block purchase proposal.')
                pack, maximum, moq = row.get('pack_size'),row.get('max_order_qty'),row.get('moq')
                if isinstance(pack,Decimal) and pack>0 and isinstance(maximum,Decimal) and isinstance(moq,Decimal) and (moq/pack).to_integral_value(rounding='ROUND_CEILING')*pack>maximum:
                    issue('order_conflict',filename,row['_row'],'pack_size',sku,'No pack multiple satisfies both MOQ and maximum.')
                if row.get('lifecycle')=='discontinued' and not row.get('replaced_by'):
                    issue('discontinued','product_master.csv',row['_row'],'lifecycle',sku,'Discontinued item without successor: no automatic buy.',warning=True)
            if filename=='sales_history.csv':
                month = row.get('month','')
                if month not in months:
                    issue('history_month',filename,row['_row'],'month',sku,'Long history must cover exactly the stock sales months.')
                if isinstance(row.get('in_stock_days'),Decimal) and _month(month):
                    y,m = map(int,month.split('-'))
                    if row['in_stock_days']>calendar.monthrange(y,m)[1]:
                        issue('in_stock_days',filename,row['_row'],'in_stock_days',sku,'In-stock days exceed the month length.')
                    if row['in_stock_days']==0 and isinstance(row.get('quantity'),Decimal) and row['quantity']>0 and row.get('backorder')=='false':
                        issue('censored_sales',filename,row['_row'],'in_stock_days',sku,'Positive lost-sales quantity with no in-stock days is inconsistent.')
                if sku in by_sku and month in months and row.get('quantity')!=by_sku[sku].get(month):
                    issue('history_reconciliation',filename,row['_row'],'quantity',sku,'Long-form sales must match the unadjusted wide monthly quantity.')
            if filename=='receipts.csv':
                try:
                    if _date(row['received_date'])<_date(row['po_date']):
                        issue('receipt_chronology',filename,row['_row'],'received_date',sku,'Receipt precedes PO confirmation.')
                    if snapshot and _date(row['received_date'])>snapshot:
                        issue('future_receipt',filename,row['_row'],'received_date',sku,'Completed receipt is after snapshot; use incoming_pos.csv for future supply.')
                except (ValueError,TypeError):
                    pass
            if filename=='incoming_pos.csv' and row.get('status')=='confirmed':
                if sku in by_sku and isinstance(by_sku[sku].get('on_order'),Decimal) and by_sku[sku]['on_order']>0:
                    issue('incoming_overlap',filename,row['_row'],'remaining_qty',sku,'Do not combine positive undated on_order with dated incoming for the same SKU.')
                try:
                    if decision and _date(row['due_date'])<decision and row.get('remaining_qty',0):
                        issue('overdue_incoming',filename,row['_row'],'due_date',sku,'Overdue incoming is unresolved; confirm revised date, do not invent arrival or silently rebuy.',warning=True)
                except (ValueError,TypeError):
                    pass
            if filename=='legacy_receipts.csv':
                month = row.get('month','')
                if not _month(month) or not months or month<=months[-1] or (int(month[:4])*12+int(month[5:]))-(int(months[-1][:4])*12+int(months[-1][5:]))>12:
                    issue('future_month',filename,row['_row'],'month',sku,'Future receipt month must be within the next twelve months.')
                if any(r.get('sku')==sku for r in tables.get('incoming_pos.csv',[])):
                    issue('incoming_overlap',filename,row['_row'],'quantity',sku,'Use either legacy monthly receipts or dated incoming, not both for one SKU.')
                if sku in by_sku and isinstance(by_sku[sku].get('on_order'),Decimal) and by_sku[sku]['on_order']>0:
                    issue('incoming_overlap',filename,row['_row'],'quantity',sku,'Do not combine undated and legacy dated incoming for one SKU.')
            if filename=='transfers.csv' and row.get('from_warehouse')==row.get('to_warehouse'):
                issue('self_link',filename,row['_row'],'to_warehouse',message='Transfer endpoints must differ.')
            if filename=='relationships.csv':
                if row.get('source_sku')==row.get('target_sku'):
                    issue('self_link',filename,row['_row'],'target_sku',sku,'An item cannot link to itself.')
                if row.get('kind')!='substitute' and row.get('direction')=='both':
                    issue('relationship_direction',filename,row['_row'],'direction',sku,'Kits and complements must be directed forward.')
            if filename=='unit_conversions.csv' and row.get('from_unit')==row.get('to_unit') and row.get('factor')!=1:
                issue('conversion_conflict',filename,row['_row'],'factor',sku,'A unit converted to itself must have factor one.')
            if filename=='reorder_rules.csv' and isinstance(row.get('min_qty'),Decimal) and isinstance(row.get('max_qty'),Decimal) and row['min_qty']>row['max_qty']:
                issue('rule_range',filename,row['_row'],'max_qty',sku,'Rule min exceeds max.')

    substitute_edges, companion_edges = {}, set()
    for record in tables.get('relationships.csv',[]):
        a,b,ratio=record['source_sku'],record['target_sku'],record.get('ratio')
        if not isinstance(ratio,Decimal) or ratio<=0:
            continue
        if record.get('kind')=='substitute':
            edges=[(a,b,ratio)]
            if record.get('direction')=='both':
                edges.append((b,a,1/ratio))
            for source,target,factor in edges:
                previous=substitute_edges.get((source,target))
                if previous is not None and abs(previous-factor)>Decimal('1e-20')*max(previous,factor):
                    issue('relationship_conflict','relationships.csv',record['_row'],'ratio',message='Parallel substitute directions disagree; affected links are locked.')
                substitute_edges[source,target]=factor
        elif record.get('kind') in {'kit','complement'}:
            if (a,b) in companion_edges:
                issue('relationship_conflict','relationships.csv',record['_row'],'kind',message='One companion pair cannot be both kit and complement; choose one coverage meaning.')
            companion_edges.add((a,b))

    receipt_groups = {}
    for record in tables.get('receipts.csv',[]):
        key = (record['po_id'],record['sku'],record['warehouse'])
        receipt_groups.setdefault(key,[]).append(record)
    for records in receipt_groups.values():
        if any(len({r.get(field,'') for r in records})>1 for field in ('po_date','supplier','po_complete')):
            issue('po_observation_conflict','receipts.csv',sku=records[0]['sku'],message='Split receipts disagree on PO confirmation, supplier or completeness assertion.')
    monthly_receipts = {}
    for record in tables.get('legacy_receipts.csv',[]):
        if isinstance(record.get('quantity'),Decimal):
            key = (record['sku'],record['month'])
            monthly_receipts[key] = monthly_receipts.get(key,Decimal(0)) + record['quantity']
            if monthly_receipts[key]>LIMIT:
                issue('aggregate_quantity','legacy_receipts.csv',record['_row'],'quantity',record['sku'],'Monthly summed quantity exceeds 1e12.')

    for sku in by_sku:
        history = [r for r in tables.get('sales_history.csv',[]) if r.get('sku')==sku]
        if history and {r['month'] for r in history}!=set(months):
            issue('history_coverage','sales_history.csv',sku=sku,message='Supply all stock months for every included SKU; omit a SKU to leave its adjustments locked.')
        wh = [r for r in tables.get('warehouse_stock.csv',[]) if r.get('sku')==sku]
        if wh and {r['warehouse'] for r in wh} != warehouses:
            issue('warehouse_coverage','warehouse_stock.csv',sku=sku,message='Every declared warehouse needs a row, including explicit zeros.')
        if wh and all(isinstance(r.get('on_hand'),Decimal) for r in wh) and sum(r['on_hand'] for r in wh)!=by_sku[sku].get('on_hand'):
            issue('stock_reconciliation','warehouse_stock.csv',sku=sku,message='Warehouse gross stock must sum exactly to stock.csv on_hand.')
    wh_map = {(r['sku'],r['warehouse']):r.get('on_hand') for r in tables.get('warehouse_stock.csv',[])}
    for row in tables.get('stock_states.csv',[]):
        values = [row.get(k) for k in ('damaged','reserved','quarantine','returns')]
        gross = wh_map.get((row['sku'],row['warehouse']))
        if gross is None:
            issue('stock_state_reference','stock_states.csv',row['_row'],'warehouse',row['sku'],'Stock states need a matching warehouse-stock row.')
        elif isinstance(gross,Decimal) and all(isinstance(v,Decimal) for v in values) and sum(values)>gross:
            issue('stock_states_exceed','stock_states.csv',row['_row'],'damaged',row['sku'],'Disjoint unavailable states exceed gross physical stock.')

    # Directed kit/complement and supersession graphs must be acyclic. Iterative
    # traversal bounds depth even for 10,000 rows; substitutes are NOT expanded.
    def check_cycles(edges,filename):
        graph = {}
        for a,b in edges:
            graph.setdefault(a,[]).append(b)
        pending = {node:0 for node in graph}
        for values in graph.values():
            for node in values:
                pending[node] = pending.get(node,0)+1
        queue = [n for n,degree in pending.items() if degree==0]
        for node in queue:
            for nxt in graph.get(node,[]):
                pending[nxt]-=1
                if pending[nxt]==0:
                    queue.append(nxt)
        if len(queue)!=len(pending):
            issue('relationship_cycle',filename,message='Cycle detected; linked-demand feature locked.')
    check_cycles([(r['source_sku'],r['target_sku']) for r in tables.get('relationships.csv',[]) if r.get('kind') in {'kit','complement'}], 'relationships.csv')
    check_cycles([(r['sku'],r['replaced_by']) for r in master.values() if r.get('replaced_by')], 'product_master.csv')
    # All conversion paths must agree, not just direct reciprocal pairs.
    conversions = {}
    for row in tables.get('unit_conversions.csv',[]):
        factor = row.get('factor')
        if isinstance(factor,Decimal) and factor>0:
            graph = conversions.setdefault(row['sku'],{})
            graph.setdefault(row['from_unit'],[]).append((row['to_unit'],factor))
            graph.setdefault(row['to_unit'],[]).append((row['from_unit'],1/factor))
    for sku, graph in conversions.items():
        potential = {}
        for first in graph:
            if first in potential:
                continue
            potential[first]=Decimal(1)
            queue = [first]
            for node in queue:
                for nxt,factor in graph[node]:
                    value = potential[node]*factor
                    if nxt in potential:
                        if abs(value-potential[nxt])>Decimal('1e-20')*max(abs(value),abs(potential[nxt])):
                            issue('conversion_conflict','unit_conversions.csv',field='factor',sku=sku,message='Inconsistent conversion paths; ratios disagree.')
                    else:
                        potential[nxt]=value
                        queue.append(nxt)
        if sku in by_sku and by_sku[sku]['unit'] not in graph:
            issue('conversion_base','unit_conversions.csv',field='from_unit',sku=sku,message='Conversions must include the stock base unit.')

    indexed = {}
    for filename, records in tables.items():
        for record in records:
            for item_sku in {record.get('sku'),record.get('source_sku'),record.get('target_sku')} - {None}:
                indexed.setdefault((filename,item_sku),[]).append(record)

    def rows(filename,sku):
        return indexed.get((filename,sku),[])

    def complete(row,fields):
        return bool(row) and all(row.get(f) is not None and row.get(f)!='' for f in fields.split())

    # Index diagnostics once: invalid 10k-row files must not trigger a full
    # diagnostic scan for every feature and SKU.
    error_index = {}
    for error in errors:
        error_index.setdefault((error['file'],error['sku']),set()).add(error['code'])

    def state_coverage(sku):
        return bool(rows('warehouse_stock.csv',sku)) and {(r['sku'],r['warehouse']) for r in rows('warehouse_stock.csv',sku)} == {(r['sku'],r['warehouse']) for r in rows('stock_states.csv',sku)}

    # feature -> relevant input files, requirement predicate, short UI chip.
    features = {}
    def gate(name,files,requirement,chip):
        items = {}
        for sku in by_sku:
            present = name in {'baseline','seasonality','classification'} or any(rows(f,sku) for f in files) or name=='transfers' and 'warehouse_stock.csv' in tables
            needs = requirement(sku)
            bad = set()
            for filename in set(files)|{'manifest.json','stock.csv'}:
                bad.update(error_index.get((filename,None),set()))
                bad.update(error_index.get((filename,sku),set()))
            present = present or bool(bad)
            state = 'hidden' if not present else 'locked' if needs or bad else 'on'
            items[sku] = {'state':state,'needs':needs,'error_codes':sorted(bad)}
        states = {v['state'] for v in items.values()}
        features[name] = {'state':'on' if 'on' in states else 'locked' if 'locked' in states or not by_sku and name=='baseline' else 'hidden','chip':chip,'items':items}

    def missing_master(sku,fields):
        return [f for f in fields.split() if not complete(master.get(sku),f)]

    gate('baseline',[],lambda s: [],'Basic')
    gate('seasonality',[],lambda s: [] if len(months)>=24 else ['24 full months'],'Seasonality')
    gate('stockout_correction',['sales_history.csv'],lambda s: [] if rows('sales_history.csv',s) and all(complete(r,'in_stock_days backorder') for r in rows('sales_history.csv',s)) else ['in-stock days','backorder policy'],'Stockout adjustment')
    gate('project_exclusion',['sales_history.csv'],lambda s: [] if rows('sales_history.csv',s) and all(complete(r,'project') for r in rows('sales_history.csv',s)) else ['project flags'],'Project sales')
    def lead_needs(s):
        records = rows('receipts.csv',s)
        suppliers = {r.get('supplier') for r in records}
        selected = master.get(s,{}).get('supplier')
        if selected:
            records = [r for r in records if r.get('supplier')==selected]
        elif len(suppliers)>1:
            return ['chosen supplier']
        return [] if len({r.get('po_id') for r in records if r.get('po_complete')=='true'})>=5 else ['5 distinct completed POs']
    gate('lead_spread',['receipts.csv','product_master.csv'],lead_needs,'Lead-time spread')
    gate('dated_incoming',['incoming_pos.csv','legacy_receipts.csv','warehouses.csv'],lambda s: [] if rows('incoming_pos.csv',s) else ['incoming lines'],'Incoming orders')
    gate('committed_demand',['customer_orders.csv','warehouses.csv'],lambda s: [] if rows('customer_orders.csv',s) else ['customer orders'],'Customer orders')
    gate('usable_stock',['stock_states.csv','warehouse_stock.csv','warehouses.csv'],lambda s: [] if rows('warehouse_stock.csv',s) and {(r['sku'],r['warehouse']) for r in rows('warehouse_stock.csv',s)}=={(r['sku'],r['warehouse']) for r in rows('stock_states.csv',s)} else ['complete stock-state rows'],'Usable stock')
    comparison_costs_complete = all(complete(master.get(item),'unit_cost') for item in by_sku)
    gate('classification',['product_master.csv'],lambda s: (['12 full months'] if len(months)<12 else [])+missing_master(s,'unit_cost critical')+([] if comparison_costs_complete else ['complete comparison costs'])+([] if manifest.get('currency') else ['currency']),'ABC / XYZ')
    gate('supplier_groups',['product_master.csv'],lambda s: missing_master(s,'supplier'),'Supplier group')
    gate('container_fill',['product_master.csv'],lambda s: missing_master(s,'supplier unit_cost cbm weight_kg pack_size')+([] if manifest.get('currency') else ['currency']),'Container fill')
    gate('order_constraints',['product_master.csv'],lambda s: missing_master(s,'pack_size moq max_order_qty'),'Order limits')
    gate('transfers',['warehouse_stock.csv','warehouses.csv','transfers.csv','stock_states.csv'],lambda s: [] if rows('warehouse_stock.csv',s) and 'transfers.csv' in tables and {(r['sku'],r['warehouse']) for r in rows('warehouse_stock.csv',s)}=={(r['sku'],r['warehouse']) for r in rows('stock_states.csv',s)} else ['warehouse stock','stock states','transfer lead days'],'Transfer first')
    gate('allocation',['customer_orders.csv','warehouse_stock.csv','stock_states.csv','warehouses.csv'],lambda s: [] if rows('customer_orders.csv',s) and state_coverage(s) else ['customer orders','usable warehouse stock'],'Allocate stock')
    for name,kind,chip in [('substitutes','substitute','Alternatives'),('complements','complement','Add together'),('kits','kit','Kit parts')]:
        gate(name,['relationships.csv'],lambda s,k=kind: [] if any(r.get('kind')==k for r in rows('relationships.csv',s)) else [k+' relationship'],chip)
    gate('supersession',['product_master.csv'],lambda s: [] if master.get(s,{}).get('replaced_by') else ['successor SKU'],'Replaced product')
    gate('unit_conversion',['unit_conversions.csv'],lambda s: [] if rows('unit_conversions.csv',s) else ['unit conversion'],'Unit conversion')
    gate('rule_health',['reorder_rules.csv','product_master.csv','warehouses.csv'],lambda s: [] if rows('reorder_rules.csv',s) else ['reordering rules'],'Rule health')
    return {'contract_version':VERSION,'valid':not errors,'snapshot_date':snapshot.isoformat() if snapshot else None,
            'decision_date':decision.isoformat() if decision else None,'errors':errors,'warnings':warnings,
            'counts':{k:len(v) for k,v in tables.items()},'features':features}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    parser.add_argument('--today',help='YYYY-MM-DD; default snapshot + 1 day, not wall clock')
    args = parser.parse_args(argv)
    result = validate_bundle(args.directory,today=args.today)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if result['valid'] else 2


if __name__=='__main__':
    raise SystemExit(main())
