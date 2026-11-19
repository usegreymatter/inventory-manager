"""Read-only dataset health and readiness. No forecasting or policy selection.

See standalone/design/HEALTH.md for field semantics. ``today`` is explicit so
results are reproducible; omitted means the snapshot date (no wall-clock IO).
"""
from calendar import monthrange
from datetime import date
import math
import re

LABELS = {
    'external_ignored': 'Import ignored',
    'pattern_changed': 'Pattern changed',
    'negative_stock': 'Negative stock', 'excess_stock': 'Check stock level',
    'stale_stock_count': 'Old stock count', 'invalid_count_date': 'Check count date',
    'manual_locked': 'Check demand change',
    'duplicate_sku': 'Duplicate SKU', 'partial_month': 'Partial month',
    'negative_value': 'Negative value', 'missing_value': 'Missing data',
    'invalid_value': 'Invalid value', 'unit_sanity': 'Check units',
    'order_conflict': 'Order limits clash', 'stale_snapshot': 'Old snapshot',
    'late_po': 'Late PO', 'incoming_invalid': 'Check incoming orders',
    'overdue_order': 'Late customer order', 'committed_invalid': 'Check customer orders',
    'reservation_mapping': 'Map reservations', 'stockout_locked': 'Check sales history', 'project_locked': 'Check project flags', 'outlier_suggestion': 'Check sales spike',
}


def _number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        # JSON integers may exceed float range; JS sees a non-finite number.
        return False


def _day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


try:
    from .engine import evaluation_pass
except ImportError:
    from engine import evaluation_pass


@evaluation_pass
def data_health(dataset, today=None, settings=None):
    """Return deterministic ``features`` and compact, deduplicated ``warnings``."""
    data = dataset if isinstance(dataset, dict) else {}
    settings = settings if isinstance(settings, dict) else {}
    raw_items = data.get('items')
    items = raw_items if isinstance(raw_items, list) else []
    months = data.get('months') if isinstance(data.get('months'), list) else []
    snapshot = _day(data.get('as_of'))
    now = _day(today if today is not None else data.get('as_of'))
    warnings, seen, skus = [], set(), set()

    def warn(code, sku='', severity='warning'):
        identity = (code, sku)
        if identity not in seen:
            seen.add(identity)
            warnings.append(dict(code=code, sku=sku, severity=severity, short_label=LABELS[code]))

    if data.get('external_ignored') is True:
        warn('external_ignored')
    if not snapshot or not months or not items:
        warn('missing_value', severity='error')
    if snapshot and now and (now - snapshot).days > 45:
        warn('stale_snapshot')
    valid_months = []
    for month in months:
        first = _day(month + '-01') if isinstance(month, str) else None
        if first:
            valid_months.append(first)
        else:
            warn('invalid_value', severity='error')
    contiguous = len(valid_months) == len(months) and all(
        (b.year * 12 + b.month) - (a.year * 12 + a.month) == 1
        for a, b in zip(valid_months, valid_months[1:]))
    if not contiguous:
        warn('invalid_value', severity='error')
    # A later month is incomplete; the snapshot's own month is complete only at month-end.
    partial = data.get('partial_last_month') is True or bool(snapshot and valid_months and (
        (valid_months[-1].year, valid_months[-1].month) > (snapshot.year, snapshot.month) or
        ((valid_months[-1].year, valid_months[-1].month) == (snapshot.year, snapshot.month) and
         snapshot.day < monthrange(snapshot.year, snapshot.month)[1])))
    if partial:
        warn('partial_month')
    full_count = sum(date(m.year, m.month, monthrange(m.year, m.month)[1]) <= snapshot
                     for m in valid_months) if contiguous and snapshot else 0
    if data.get('partial_last_month') is True and full_count == len(months):
        full_count = max(0, full_count - 1)
    history_counts, receipt_counts, intermittent = [], [], []
    usable = committed = receipts = substitutes = kits = warehouses = False
    incoming_hint = False
    if any(not isinstance(item, dict) for item in items):
        warn('invalid_value', severity='error')
    for item in items:
        if not isinstance(item, dict):
            continue
        sku = item.get('sku') if isinstance(item.get('sku'), str) else ''
        if sku in skus and sku:
            warn('duplicate_sku', sku, 'error')
        skus.add(sku)
        for key in ('sku', 'name', 'unit', 'on_hand', 'monthly_sales'):
            if key not in item or item[key] is None or item[key] == '':
                warn('missing_value', sku, 'error')
        sales = item.get('monthly_sales') if isinstance(item.get('monthly_sales'), list) else []
        if len(sales) != len(months):
            warn('missing_value', sku, 'error')
        numeric = ['on_hand', 'on_order', 'usable_on_hand', 'damaged', 'reserved', 'supplier_days',
                   'pack_size', 'minimum_order', 'max_stock']
        values = [item[key] for key in numeric if key in item and item[key] is not None] + sales
        for key in ('receipts', 'historical_receipts'):
            if isinstance(item.get(key), dict):
                values.extend(item[key].values())
        for value in values:
            if value is None:
                warn('missing_value', sku, 'error')
            elif not _number(value):
                warn('invalid_value', sku, 'error')
            elif value < 0:
                warn('negative_value', sku, 'error')
        good_history = len(sales) == len(months) and all(_number(v) and v >= 0 for v in sales)
        history_counts.append(full_count if good_history else 0)
        full_sales = sales[:full_count] if good_history else []
        intermittent.append(bool(full_sales and sum(v == 0 for v in full_sales) > len(full_sales) / 2))
        avg = sum(full_sales) / len(full_sales) if full_sales else 0
        stock = item.get('on_hand')
        accuracy = 'last_count_date' in item
        if accuracy and _number(stock) and stock < 0:
            warn('negative_stock', sku)
        if accuracy and avg > 0 and _number(stock) and stock > 24 * avg:
            warn('excess_stock', sku)
        if accuracy:
            counted = _day(item['last_count_date'])
            if not counted or now and counted > now:
                warn('invalid_count_date', sku)
            elif now and (now - counted).days > 180:
                warn('stale_stock_count', sku)
        guidance = item.get('guidance') if isinstance(item.get('guidance'), dict) else {}
        if avg > 0 and any(_number(v) and v > 24 * avg for v in (None if accuracy else stock, guidance.get('quantity'), item.get('suggested_order'))):
            warn('unit_sanity', sku)
        override = settings.get('product_overrides', {})
        override = override.get(sku, {}) if isinstance(override, dict) else {}
        override = override if isinstance(override, dict) else {}
        pack, minimum, maximum = (override.get(k, item.get(k)) for k in ('pack_size', 'minimum_order', 'max_stock'))
        pack = pack if _number(pack) and pack > 0 else 1
        if _number(maximum) and maximum >= 0 and ((minimum if _number(minimum) else 0) > maximum or pack > maximum or
                (_number(minimum) and minimum > 0 and math.ceil(minimum / pack - 1e-9) * pack > maximum + 1e-9)):
            warn('order_conflict', sku, 'error')
        dated = item.get('receipt_history') if isinstance(item.get('receipt_history'), list) else []
        count = 0
        for receipt in dated:
            if not isinstance(receipt, dict):
                warn('invalid_value', sku, 'error')
                continue
            ordered, received = _day(receipt.get('ordered_on')), _day(receipt.get('received_on'))
            quantity = receipt.get('quantity')
            if not ordered or not received or not _number(quantity):
                warn('missing_value', sku, 'error')
            elif quantity < 0 or received < ordered:
                warn('negative_value', sku, 'error')
            elif quantity > 0 and snapshot and received <= snapshot:
                count += 1
        receipt_counts.append(count)
        usable |= (_number(item.get('usable_on_hand')) and item['usable_on_hand'] >= 0 or
                   all(_number(item.get(k)) and item[k] >= 0 for k in ('on_hand', 'damaged', 'reserved')))
        committed |= isinstance(item.get('committed_orders'), list) and bool(item['committed_orders'])
        receipts |= bool(isinstance(item.get('receipts'), dict) and any(_number(v) and v > 0 for v in item['receipts'].values()) or count)
        incoming_hint |= _number(item.get('on_order')) and item['on_order'] > 0 or (isinstance(item.get('open_receipts'), list) and bool(item['open_receipts']))
        substitutes |= isinstance(item.get('substitutes'), list) and bool(item['substitutes'])
        kits |= isinstance(item.get('kit_components'), list) and bool(item['kit_components'])
        warehouses |= isinstance(item.get('warehouse_stock'), list) and len(item['warehouse_stock']) > 1

    def gate(on, present, needs):
        return dict(state='on' if on else 'locked' if present else 'hidden', needs='' if on else needs)

    features = {
        'seasonality': gate(bool(history_counts) and min(history_counts) >= 24, bool(months), '24 full months'),
        'lead_time_spread': gate(bool(receipt_counts) and min(receipt_counts) >= 5, bool(items), '5 dated receipts'),
        'intermittent': gate(any(intermittent), bool(months), 'zero sales months'),
        'usable_stock': gate(usable, bool(items), 'usable stock'),
        'committed_orders': gate(committed, False, 'customer orders'),
        'receipts': gate(receipts, incoming_hint, 'receipt dates'),
        'substitutes': gate(substitutes, False, 'item links'),
        'kits': gate(kits, False, 'kit components'),
        'multi_warehouse': gate(warehouses, False, 'warehouse stock'),
    }
    try:
        from .engine import forecast_selection
    except ImportError:
        from engine import forecast_selection
    smart = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        ready = forecast_selection(item, months[-1]) if months and full_count == len(months) and not partial and snapshot and months[-1] == snapshot.isoformat()[:7] else dict(state='locked' if months else 'hidden', needs='28 full months')
        smart[item.get('sku') or ''] = dict(state=ready['state'], needs=ready['needs'])
    states = [g['state'] for g in smart.values()]
    features['smart_forecast'] = dict(state='on' if 'on' in states else 'locked' if 'locked' in states else 'hidden', chip='Smart forecast', items=smart)
    if any(isinstance(i,dict) and isinstance(i.get('monthly_sales'),list) and len(i['monthly_sales'])>=18 for i in items):
        try:
            from .forecast_lab import inventory_classes
        except ImportError:
            from forecast_lab import inventory_classes
        labels = inventory_classes(items) if not partial and full_count==len(months) and snapshot else {}
        features['demand_classes'] = dict(state='on' if labels else 'locked',chip='Demand class',items=labels)
    if any(isinstance(i,dict) and 'calendar_forecast' in i for i in items):
        gates = {}
        for i in items:
            if isinstance(i,dict):
                ready = forecast_selection(i,months[-1]) if months and not partial and full_count==len(months) else {}
                on = i.get('calendar_forecast') is True and 'calendar_seasonal' in ready.get('candidates',{})
                gates[i.get('sku') or ''] = gate(on,'calendar_forecast' in i,'36 full months')
        states = [g['state'] for g in gates.values()]
        features['calendar_forecast'] = dict(state='on' if 'on' in states else 'locked',chip='Calendar',items=gates)
    if any(isinstance(i, dict) and "planning_facts" in i for i in items):
        try:
            from .engine import dated_facts, committed_facts, stockout_history, adopted_history
        except ImportError:
            from engine import dated_facts, committed_facts, stockout_history, adopted_history
        gates = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                facts = dated_facts(item, data.get('as_of'), today or data.get('as_of'))
            except (ValueError, TypeError, KeyError):
                facts = dict(state='locked', needs='HOLD: incoming order data needs checking.', late=0)
            gates[(item.get('sku') or '')] = dict(state=facts['state'], needs=facts['needs'])
            if facts['late']:
                warn('late_po', (item.get('sku') or ''))
            elif facts['state'] == 'locked':
                warn('incoming_invalid', (item.get('sku') or ''), 'error')
        states = [g['state'] for g in gates.values()]
        features['dated_incoming'] = dict(state='on' if 'on' in states else 'locked' if 'locked' in states else 'hidden', chip='Incoming orders', items=gates)
        demand_gates = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                demand = committed_facts(item, data.get('as_of'), today or data.get('as_of'))
            except (ValueError, TypeError, KeyError):
                demand = dict(state='locked', needs='HOLD: customer order data needs checking.', overdue=0)
            demand_gates[(item.get('sku') or '')] = dict(state=demand['state'], needs=demand['needs'])
            if demand['overdue']:
                warn('overdue_order', (item.get('sku') or ''))
            if demand['state'] == 'locked':
                warn('reservation_mapping' if 'reservation' in demand['needs'] else 'committed_invalid', (item.get('sku') or ''), 'error')
        states = [g['state'] for g in demand_gates.values()]
        features['committed_demand'] = dict(state='on' if 'on' in states else 'locked' if 'locked' in states else 'hidden', chip='Customer orders', items=demand_gates)
        if any(s != 'hidden' for s in states):
            features['committed_orders'] = dict(state=features['committed_demand']['state'], needs='' if 'on' in states else 'customer orders / reservations')
        history_gates = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                history = stockout_history(item, (data.get('as_of') or '')[:7])
            except (ValueError, TypeError, KeyError):
                history = dict(state='locked', needs='HOLD: stockout history needs checking.')
            history_gates[(item.get('sku') or '')] = dict(state=history['state'], needs=history['needs'])
            if history['state'] == 'locked':
                warn('stockout_locked', (item.get('sku') or ''), 'error')
        states = [g['state'] for g in history_gates.values()]
        features['stockout_correction'] = dict(state='on' if 'on' in states else 'locked' if 'locked' in states else 'hidden', chip='Stockout adjustment', items=history_gates)
        project_gates, suggestion_gates = {}, {}
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                history = adopted_history(item, (data.get('as_of') or '')[:7])
            except (ValueError, TypeError, KeyError):
                history = dict(project_state='locked', needs='HOLD: project history needs checking.')
            state = history.get('project_state', 'hidden')
            project_gates[(item.get('sku') or '')] = dict(state=state, needs=history['needs'] if state=='locked' else '')
            suggestions = history.get('outlier_suggestions', dict(state='hidden', needs='', months=[]))
            suggestion_gates[(item.get('sku') or '')] = dict(state=suggestions['state'], needs=suggestions['needs'], months=suggestions['months'])
            if state == 'locked':
                warn('project_locked', (item.get('sku') or ''), 'error')
            if suggestions['months']:
                warn('outlier_suggestion', (item.get('sku') or ''))
        states = [g['state'] for g in project_gates.values()]
        if any(s != 'hidden' for s in states):
            features['project_exclusion'] = dict(state='on' if 'on' in states else 'locked', chip='Project sales', items=project_gates)
            states = [g['state'] for g in suggestion_gates.values()]
            features['outlier_suggestions'] = dict(state='on' if 'on' in states else 'locked' if 'locked' in states else 'hidden', chip='Check spike', items=suggestion_gates)
    if any(isinstance(i, dict) and 'demand_change_pct' in i for i in items):
        try:
            from .engine import adopted_history
        except ImportError:
            from engine import adopted_history
        manual_gates = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                history = adopted_history(item, (data.get('as_of') or '')[:7])
            except (ValueError, TypeError, KeyError):
                history = dict(manual_state='locked', needs='HOLD: manual change needs valid monthly history.')
            state = history.get('manual_state', 'hidden')
            manual_gates[(item.get('sku') or '')] = dict(state=state, needs=history['needs'] if state=='locked' else '')
            if state == 'locked':
                warn('manual_locked', (item.get('sku') or ''), 'error')
        states = [g['state'] for g in manual_gates.values()]
        features['manual_change'] = dict(state='on' if 'on' in states else 'locked', chip='Demand change', items=manual_gates)
    if any(isinstance(i, dict) and '_learning_context' in i for i in items):
        try:
            from .learning import pattern_changed
        except ImportError:
            from learning import pattern_changed
        gates = {}
        for item in items:
            entries = item.get('_learning_context', {}).get('entries', [])
            gates[item.get('sku', '')] = gate(len(entries) >= 6, True, '6 matured months')
            if pattern_changed(entries):
                warn('pattern_changed', item.get('sku', ''))
        features['learning'] = dict(state='on' if any(g['state']=='on' for g in gates.values()) else 'locked', chip='Accuracy', items=gates)
    return dict(features=features, warnings=warnings)
