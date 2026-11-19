#!/usr/bin/env python3
"""JSON bridge/corpus for the real Python advisory and guidance functions."""
import calendar
import json
from pathlib import Path
import random
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine

FIELDS = ('status','quantity','monthly_demand','order_by','runout_date','safety_stock','reorder_point','reason')


def case(sales, **extra) -> dict[str, Any]:
    months = [engine.month_after('2026-10',i-len(sales)+1) for i in range(len(sales))]
    return dict(item=dict(sku='ADVISORY',name='Fictional parity case',unit='units',on_hand=50,
                          supplier_days=14,receipts={},monthly_sales=sales,**extra),
                months=months,as_of='2026-10-31',today='2026-11-17')


def corpus():
    cases = [case(v) for v in ([90,100,110,0,100],[100,100,100,20,100],
             [100,100,100,19,50],[100,100,100,0,49],[0,100,100,100],
             [100,100,100,0],[100,100,100,0,0,100],[0,0,100,0,100],[0]*5)]
    for stock in (0,1,2,None):
        cases.append(case([100,100,100,0,100],stock_history={'2026-09':{'month_end_stock':stock}}))
    cases.append(case([0,20,30,0,40],stock_history=[{'month':'2026-06','stockout_days':2},
                                                               {'month':'2026-09','stockout_days':1}]))
    equal = case([100]*5)
    equal['item']['planning_facts'] = dict(version='1.0',sales_history=[
        dict(sku='ADVISORY',month=m,quantity=100,
             in_stock_days=3 if i==3 else calendar.monthrange(*map(int,m.split('-')))[1],backorder=False)
        for i,m in enumerate(equal['months'])])
    cases.append(equal)
    rng = random.Random(20261117)
    for i in range(360):
        n = rng.choice((3,5,7,12,24))
        c = case([rng.choice((0,.1,5.5,30,60,100)) for _ in range(n)])
        if i % 3 == 0:
            c['item']['stock_history'] = {m:dict(stockout_days=1) for j,m in enumerate(c['months']) if j%5 == 0}
        if i % 4 == 0:
            c['item']['planning_facts'] = dict(version='1.0',sales_history=[
                dict(sku='ADVISORY',month=m,quantity=q,
                     in_stock_days=(1 if j%4 == 0 else calendar.monthrange(*map(int,m.split('-')))[1]),
                     backorder=False) for j,(m,q) in enumerate(zip(c['months'],c['item']['monthly_sales']))])
        if i % 7 == 0:
            c['item']['demand_change_pct'] = 10
        cases.append(c)
    # Detection on ALL committed sample/demo rows, not a hand-selected subset.
    for filename in ('sample.json','demo-1000.json'):
        data = json.loads((ROOT/'data'/filename).read_text())
        for raw in data['items']:
            cases.append(dict(item=raw,months=data['months'],as_of=data['as_of'],today='2026-11-17',detection_only=True))
    return cases


@engine.evaluation_pass
def evaluate(cases):
    rows = []
    for c in cases:
        raw = c['item']
        result = dict(detection=engine.detect_stockout_months(raw,c['as_of'][:7]))
        if not c.get('detection_only'):
            physical = engine.forecast(raw,c['months'],c['as_of'],today=c['today'])
            item = {**raw,**physical,'on_hand':raw.get('on_hand'),'as_of':c['as_of']}
            for key,enabled in (('before',False),('after',True)):
                guidance = engine.order_guidance(item,c['today'],{'stockout_adjust':enabled},c['as_of'])
                result[key] = {k:guidance.get(k) for k in FIELDS}
        rows.append(result)
    return rows


if __name__ == '__main__':
    value = corpus() if '--corpus' in sys.argv else evaluate(json.load(sys.stdin))
    print(json.dumps(value,allow_nan=False,separators=(',',':')))
