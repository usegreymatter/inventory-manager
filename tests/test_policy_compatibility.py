"""Policy-only migration oracles; frozen forecasting fixtures are never rewritten."""
import copy
from datetime import date, timedelta
import math

import pytest
import engine
from policy_assertions import assert_forecast_frozen, assert_guidance_dates, assert_bucket_policy

MONTHS = ['2026-08', '2026-09', '2026-10']
ASOF = '2026-10-31'


def raw(**updates) -> dict:
    return dict(sku='ORACLE', name='Synthetic', unit='ea', on_hand=100,
                monthly_sales=[60,90,120], supplier_days=14, receipts={}, **updates)


def row_and_item(source, settings=None):
    row = engine.forecast(source,MONTHS,ASOF,settings=settings,today=ASOF)
    return row, {**source,**row,'as_of':ASOF}


@pytest.mark.parametrize('count', [0,4,5,6])
def test_receipt_lead_variance_requires_five_valid_pairs_and_uses_sample_sd(count):
    leads = [1,2,3,4,19,7][:count]
    source = raw()
    source['receipt_history'] = [dict(ordered_on='2026-01-01',
        received_on=(date(2026,1,1)+timedelta(days=d)).isoformat(),quantity=1) for d in leads]
    row, item = row_and_item(source)
    # Monthly sample variance=900. Daily mean=90/30=3. Receipt lead sample
    # variance must contribute only with at least five usable matched pairs.
    leadvar = sum((d-sum(leads)/len(leads))**2 for d in leads)/(len(leads)-1) if count >= 5 else 0
    expected = math.ceil(1.6449*math.sqrt(900*(14+30)/30 + 3**2*leadvar))
    guidance = engine.order_guidance(item,ASOF)
    assert row['safety_stock'] == guidance['safety_stock'] == expected
    assert row['demand_swing'] == 30
    assert_guidance_dates(engine,source,row,ASOF)


def test_explicit_safety_off_preserves_forecast_and_displayed_ss_but_excludes_active_ss():
    source = raw()
    enabled, item = row_and_item(source)
    disabled, off_item = row_and_item(source,{'include_backup_in_orders':False})
    assert disabled['safety_stock'] == enabled['safety_stock'] == 60
    assert enabled['reorder_point'] == 102 and disabled['reorder_point'] == 42
    assert disabled['projection'] == enabled['projection']
    assert disabled['monthly_demand'] == enabled['monthly_demand'] == 90
    on = engine.order_guidance(item,ASOF)
    off = engine.order_guidance(off_item,ASOF,{'include_backup_in_orders':False})
    assert off['quantity'] < on['quantity']
    assert on['order_by'] == 'now' and off['order_by'] == '2026-11-20'


@pytest.mark.parametrize('changed', ['monthly_demand','forecast_explanation','error_percent','grade','projection','receipts','eoq'])
def test_historical_comparator_rejects_every_frozen_field_mutation(changed):
    source = raw()
    row, _ = row_and_item(source)
    changed_row = copy.deepcopy(row)
    if changed == 'projection':
        changed_row['projection'][0]['demand'] += 1
    elif changed == 'receipts':
        changed_row['receipts']['2026-12'] = 1
    else:
        changed_row[changed] = 'not the frozen value'
    with pytest.raises(AssertionError):
        assert_forecast_frozen(changed_row,row,engine,source,ASOF)


@pytest.mark.parametrize('days,bucket', [(7,'order'),(8,'running-low'),(30,'running-low'),(31,'healthy')])
def test_urgency_boundaries_use_order_by_not_physical_runout(days,bucket):
    source = raw()
    source.update(monthly_sales=[30]*3,on_hand=100,supplier_days=14)
    _, item = row_and_item(source)
    due = engine.order_guidance(item,ASOF)['order_by']
    today = (date.fromisoformat(due)-timedelta(days=days)).isoformat()
    guidance = engine.order_guidance(item,today)
    assert guidance['order_by'] == due
    assert date.fromisoformat(guidance['runout_date']) > date.fromisoformat(due)+timedelta(days=days if days < 14 else 0)
    assert engine.order_bucket(item,today) == bucket
    assert_bucket_policy(engine,item,today)
