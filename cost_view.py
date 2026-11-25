"""Pure display-only cost metrics. Never changes a forecast or order quantity.

Money uses the file/settings currency with no conversion. Unknown facts are
omitted, not treated as zero. See docs/COSTS.md for formulas and limitations.
"""
import math


def _number(value):
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and math.isfinite(value) and 0 <= value <= 1e12)


def cost_metrics(item, guidance=None, risk=None):
    """Value a read-only evaluated product; risk must supply expected units."""
    guidance, risk = guidance or {}, risk or {}
    cost = item.get('unit_cost')
    if not _number(cost):
        return {}
    result = {}
    # A stock count date translates on_hand to the as-of balance; value the counted stock.
    stock = item.get('counted_on_hand', item.get('on_hand'))
    for key, quantity in [('money_tied_up', stock),
                          ('incoming_value', guidance.get('incoming_qty', item.get('on_order'))),
                          ('order_value', guidance.get('quantity')),
                          ('expiry_value_at_risk', guidance.get('expiry_at_risk_qty', item.get('expiry_at_risk_qty')))]:
        if _number(quantity):
            result[key] = quantity * cost
    monthly = guidance.get('monthly_demand', item.get('monthly_demand'))
    if _number(monthly):
        result['weekly_cost'] = monthly * 7 / 30 * cost
        if result['weekly_cost'] > 0 and 'money_tied_up' in result:
            result['money_cover_weeks'] = result['money_tied_up'] / result['weekly_cost']
    price = item.get('sale_price')
    if _number(price):
        margin = price - cost
        result['margin_unit'] = margin
        if price > 0:
            result['margin_pct'] = margin / price * 100
        if _number(stock):
            result['stock_margin'] = stock * margin
            result['stock_sale_value'] = stock * price
        shortfall = risk.get('expected_shortfall_before')
        if _number(shortfall):
            result['lost_profit_est'] = shortfall * max(0, margin)
    return result


def cost_totals(metrics):
    """Sum known money only; coverage counts prevent partial totals misleading.

    Per-unit margins are never summed across mixed products/units. Total margin
    percent is weighted by stock selling value. Cover is a ratio for the same
    subset of products with both known on-hand value and positive weekly cost.
    """
    result = dict(count=len(metrics), coverage={})
    for row in metrics:
        for key in row:
            result['coverage'][key] = result['coverage'].get(key, 0) + 1
    for key in ['money_tied_up', 'incoming_value', 'order_value', 'lost_profit_est',
                'expiry_value_at_risk', 'weekly_cost', 'stock_margin', 'stock_sale_value']:
        values = [row[key] for row in metrics if key in row]
        if values:
            result[key] = sum(values)
    if result.get('stock_sale_value', 0) > 0:
        result['margin_pct'] = result.get('stock_margin', 0) / result['stock_sale_value'] * 100
    paired = [row for row in metrics if 'money_tied_up' in row and row.get('weekly_cost', 0) > 0]
    if paired:
        result['money_cover_weeks'] = sum(row['money_tied_up'] for row in paired) / sum(row['weekly_cost'] for row in paired)
    return result
