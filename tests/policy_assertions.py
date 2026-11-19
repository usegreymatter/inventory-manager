"""Historical oracles keep every non-policy field, including full projections.

Policy v2 intentionally changes dates, purchase windows and planning statistics;
those fields are not forecast-model regressions. Never exclude demand, model
labels, backtest scores, projection cells, adopted-history traces or input facts.
"""
import base64
import json
import math

def assert_roundoff_equal(actual, historical):
    """Exact-rational policy integration can remove <=4 ULP calendar drift only."""
    if isinstance(actual, dict) and isinstance(historical, dict):
        assert actual.keys() == historical.keys()
        for k in actual: assert_roundoff_equal(actual[k], historical[k])
    elif isinstance(actual, list) and isinstance(historical, list):
        assert len(actual) == len(historical)
        for a,b in zip(actual,historical): assert_roundoff_equal(a,b)
    elif isinstance(actual,(int,float)) and isinstance(historical,(int,float)):
        assert actual == historical or math.isfinite(actual) and math.isfinite(historical) and abs(actual-historical)<=4*max(math.ulp(actual),math.ulp(historical)), (actual,historical)
    else: assert actual == historical

FORECAST_POLICY_FIELDS = frozenset({
    'demand_swing', 'safety_stock', 'safety_stock_provenance', 'reorder_point',
    'why', 'order_by', 'order_overdue', 'runout_day', 'runout_month',
    'suggested_order', 'big_order',
})
GUIDANCE_POLICY_FIELDS = frozenset({
    'demand_swing', 'safety_stock', 'safety_stock_provenance', 'reorder_point',
    'why', 'quantity', 'scenario_quantity', 'order_by', 'order_date', 'endpoint',
    'buffer_demand', 'undated_on_order_assumed_within_lead', 'incoming', 'big_order',
    'status',
})


def without_policy(row):
    return {k: v for k, v in row.items() if k not in FORECAST_POLICY_FIELDS}


def assert_guidance_frozen(actual, historical):
    """Physical crossing, gap, delivery, demand and holds remain exact."""
    actual = {k: v for k, v in actual.items() if k not in GUIDANCE_POLICY_FIELDS}
    historical = {k: v for k, v in historical.items() if k not in GUIDANCE_POLICY_FIELDS}
    # Only today balance integrates demand and may lose historical float drift.
    if "projected_balance_today" in actual:
        assert_roundoff_equal(actual.pop("projected_balance_today"),historical.pop("projected_balance_today"))
    assert actual == historical, {k: (actual.get(k),historical.get(k)) for k in actual.keys() | historical.keys() if actual.get(k) != historical.get(k)}


def assert_guidance_dates(engine, raw, row, as_of, today=None, settings=None):
    if row.get('held'):
        return
    guidance = engine.order_guidance({**raw, **row, 'as_of': as_of}, today or as_of, settings)
    if guidance['status'] == 'needs-data':
        return  # Held purchase plans retain their physical forecast dates.
    assert row['runout_day'] == guidance['runout_date']
    assert row['runout_month'] == (guidance['runout_date'][:7] if guidance['runout_date'] else None)
    assert row['order_by'] == guidance['order_by']
    assert row['order_overdue'] == (guidance['order_by'] == 'now')


def assert_bucket_policy(engine, item, today, settings=None):
    """Independent order-by urgency oracle; never use runout for 7/30-day bands."""
    from datetime import date
    guidance = engine.order_guidance(item, today, settings)
    if guidance['status'] == 'needs-data':
        expected = 'needs-data'
    elif guidance['supply_gap'] or guidance['status'] == 'supply-gap':
        expected = 'order' if guidance['quantity'] > 0 else 'running-low'
    elif guidance['quantity'] > 0:
        due = guidance['order_by']
        days = (date.fromisoformat(due) - date.fromisoformat(today)).days if due not in (None, 'now') else None
        expected = ('order' if due == 'now' or days is not None and days <= 7 else
                    'running-low' if days is not None and days <= 30 else 'healthy')
    else:
        history = guidance.get('demand_history', {})
        observed = [v for v, keep in zip(history.get('adjusted', history.get('corrected', [])), history.get('eligible', [])) if keep] if history.get('state') == 'on' else item.get('monthly_sales', [])
        if item['on_hand'] > 0 and len(observed) >= 3 and all(v == 0 for v in observed[-3:]) and guidance.get('committed_quantity', 0) == 0:
            expected = 'no-sales'
        elif item.get('on_order', 0) > 0 and guidance['status'] == 'healthy':
            expected = 'healthy'
        else:
            expected = 'overstocked' if guidance['overstock_months'] > 6 else 'healthy'
    assert engine.order_bucket(item, today, settings) == expected


def assert_forecast_frozen(actual, historical, engine, raw, as_of, today=None, settings=None):
    a,b = without_policy(actual),without_policy(historical)
    if "projection" in a:
        assert_roundoff_equal(a.pop("projection"),b.pop("projection"))
    assert a == b, {k:(a.get(k),b.get(k)) for k in a.keys() | b.keys() if a.get(k)!=b.get(k)}
    assert_guidance_dates(engine, raw, actual, as_of, today, settings)


def assert_tool_forecast_frozen(actual, historical, engine, raws, today, settings):
    """Compare the actual tool boundary, not just direct engine invocations."""
    actual, historical = json.loads(actual), json.loads(historical)
    rendered = {'items', 'summary', 'purchase_summary', 'card'}
    assert {k: v for k, v in actual.items() if k not in rendered} == {
        k: v for k, v in historical.items() if k not in rendered}
    assert len(actual['items']) == len(historical['items']) == len(raws)
    for row, old, raw in zip(actual['items'], historical['items'], raws):
        assert_forecast_frozen({k: v for k, v in row.items() if k not in {'guidance', 'order_bucket'}},
                               {k: v for k, v in old.items() if k not in {'guidance', 'order_bucket'}},
                               engine, raw, actual['as_of'], today, settings)
        assert_guidance_frozen(row['guidance'], old['guidance'])
        merged = {**raw, **row, 'as_of': actual['as_of']}
        assert row['order_bucket'] == engine.order_bucket(merged, today, settings)
        assert_bucket_policy(engine, merged, today, settings)
    # Card runout is policy-derived; all other DTO cells remain byte-equivalent.
    def card(payload):
        encoded = payload['card'].split('data="', 1)[1].split('"', 1)[0]
        dto = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
        dto['rows'] = sorted(({k: v for k, v in r.items() if k != 'runout'} for r in dto['rows']), key=lambda r: r['sku'])
        return dto
    assert card(actual) == card(historical)
    for dto_row in json.loads(base64.urlsafe_b64decode(actual['card'].split('data="')[1].split('"')[0] + '==='))['rows']:
        row = next(r for r in actual['items'] if r['sku'] == dto_row['sku'])
        runout = row.get('runout_month')
        if runout and runout > engine.month_after(actual['as_of'][:7],actual['horizon']): runout = None
        assert dto_row['runout'] == runout
    assert len(actual['summary']) == len(historical['summary'])
    assert len(actual['purchase_summary']) == len(historical['purchase_summary'])


def purchase_golden(name):
    """Reviewed policy-only outputs; legacy forecasting fixtures stay untouched."""
    from pathlib import Path
    return json.loads((Path(__file__).parent / 'fixtures/policy-v2-purchases.json').read_text())[name]
