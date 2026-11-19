"""Embedded approximate calendar and routing-only classifications."""
import engine
import forecast_lab as lab
from health import data_health


def test_embedded_calendar_dates_and_double_ramadan_year():
    assert ('2024-03-11','ramadan') in lab.HOLIDAY_STARTS
    assert ('2024-06-16','adha') in lab.HOLIDAY_STARTS
    assert len([d for d,k in lab.HOLIDAY_STARTS if d.startswith('2030') and k=='ramadan']) == 2
    assert lab.CALENDAR_NOTE == 'approx (Umm al-Qura), confirm locally'
    assert lab.calendar_seasonal([10]*36,'2040-12',3) is None


def test_calendar_is_optional_challenger_never_forced():
    raw=dict(sku='H',name='Synthetic',unit='box',on_hand=20,monthly_sales=[10]*60,receipts={})
    plain=engine.forecast_selection(raw,'2026-10')
    enabled=engine.forecast_selection({**raw,'calendar_forecast':True},'2026-10')
    assert 'calendar_seasonal' not in plain['candidates']
    assert 'calendar_seasonal' in enabled['candidates']
    assert not enabled['adopted']
    # A start-month event uplift is fitted only on observed months.
    months=[engine.month_after('2026-10',i-95) for i in range(96)]
    events={d[:7] for d,k in lab.HOLIDAY_STARTS if k=='ramadan'}
    ys=[100 if m in events else 10 for m in months]
    result=lab.calendar_seasonal(ys,'2026-10',12)
    assert result[3] > result[0] # Feb 2027 vs Nov 2026


def test_abc_xyz_classes_are_routing_only_and_health_gated():
    def item(sku,n):
        return dict(sku=sku,name='Synthetic',unit='box',on_hand=0,monthly_sales=[n]*24,receipts={})
    items=[item('A',80),item('B',15),item('C',5)]
    labels=lab.inventory_classes(items)
    assert [labels[k]['abc'] for k in ('A','B','C')] == ['A','B','C']
    assert all(v['xyz']=='X' and v['demand']=='smooth' and v['basis']=='quantity' for v in labels.values())
    assert lab.inventory_classes([{**x,'unit_cost':1} for x in items])['A']['basis']=='value'
    months=[engine.month_after('2026-10',i-23) for i in range(24)]
    health=data_health(dict(items=items,months=months,as_of='2026-10-31'))
    assert health['features']['demand_classes']['state']=='on'
    assert health['features']['demand_classes']['items']['A']['label']=='AX Smooth'
    partial=data_health(dict(items=items,months=months,as_of='2026-10-15'))
    assert partial['features']['demand_classes']['state']=='locked'
