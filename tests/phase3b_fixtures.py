"""Dependency-free synthetic fixtures shared by Python and Node parity tests."""
import calendar
import engine


def raw(sales=None, sku='BIAS'):
    return dict(sku=sku, name='Synthetic', unit='box', on_hand=0, supplier_days=14,
                monthly_sales=sales or [80, 100, 90, 110]*12, receipts={})


def dataset(item=None, last='2026-10'):
    item = item or raw()
    n = len(item['monthly_sales'])
    months = [engine.month_after(last, i-n+1) for i in range(n)]
    return dict(items=[item], months=months, as_of=last+'-'+str(calendar.monthrange(int(last[:4]),int(last[5:]))[1]))


def diary_rows(data, prediction=80):
    return [dict(version=1, sku=data['items'][0]['sku'], as_of=engine.month_after(m,-1), method='champion', scale=10,
                 forecast=[dict(month=engine.month_after(m,h), p50=prediction, p80=prediction+20, p95=prediction+30) for h in range(3)])
            for m in data['months'][-6:]]
