#!/usr/bin/env python3
"""Regenerate a clearly SYNTHETIC, fixed-date flooring distributor CSV bundle.

No randomness, wall clock, network, ERP, credentials, or non-standard libraries.
Writes only its explicit output directory (default samples/synthetic).
"""
from __future__ import annotations

import argparse
import calendar
import csv
from datetime import date, timedelta
import json
from pathlib import Path


MONTHS = ['2025-11','2025-12']+[f'2026-{m:02d}' for m in range(1,11)]
WAREHOUSES = ['MAIN','EAST','WEST']
PRODUCTS = [
    # sku, name, unit, stock, monthly, cost, pack, MOQ, max, CBM, kg, supplier, critical, lifecycle, successor
    ('TILE-SAND','SYNTHETIC Sand tile','box',[24,84,12],[120]*12,10,12,24,120,.02,20,'SYN-TILE','false','active',''),
    ('TILE-OLD','SYNTHETIC Old sand tile','box',[12,12,0],[24]*12,8,12,24,120,.02,20,'SYN-TILE','false','discontinued','TILE-SAND'),
    ('TILE-GREY','SYNTHETIC Grey tile','box',[48,24,24],[60]*12,12,12,24,120,.02,20,'SYN-TILE','false','active',''),
    ('ADH-20','SYNTHETIC Tile adhesive 20kg','bag',[40,20,20],[60]*12,3,1,10,100,.015,20,'SYN-CHEM','false','active',''),
    ('GROUT-5','SYNTHETIC Grout 5kg','bag',[20,10,10],[30]*12,2,1,5,100,.004,5,'SYN-CHEM','true','active',''),
    ('EDGE-NEW','SYNTHETIC Edge trim','piece',[4,4,4],[0]*8+[4,8,12,16],4,4,8,80,.001,.5,'SYN-TILE','false','new',''),
]


def make_samples(output):
    """Write deterministic files; returns record counts. Overwrite is explicit."""
    output = Path(output)
    output.mkdir(parents=True,exist_ok=True)
    counts = {}
    def emit(filename,fields,rows):
        rows = list(rows)
        with (output/filename).open('w',encoding='utf-8',newline='') as handle:
            writer = csv.writer(handle,lineterminator='\n')
            writer.writerow(fields.split() if isinstance(fields,str) else fields)
            writer.writerows(rows)
        counts[filename]=len(rows)
    manifest = {'contract_version':'1.0','snapshot_date':'2026-10-31','currency':'KWD','synthetic':True,
                'source':'SYNTHETIC deterministic generator, not company or Odoo data',
                'planning_example_date':'2026-11-01'}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    emit('stock.csv',['sku','name','unit','on_hand','supplier_days','category','on_order']+MONTHS,
        [[p[0],p[1],p[2],sum(p[3]),30 if p[0].startswith('TILE') else 14,'SYNTHETIC building materials',0]+p[4] for p in PRODUCTS])
    emit('product_master.csv','sku supplier unit pack_size moq max_order_qty unit_cost cbm weight_kg abc_override critical lifecycle replaced_by',
        [[p[0],p[11],p[2],p[6],p[7],p[8],p[5],p[9],p[10],'',p[12],p[13],p[14]] for p in PRODUCTS])
    emit('warehouses.csv','warehouse name',[[w,'SYNTHETIC '+w+' warehouse'] for w in WAREHOUSES])
    emit('warehouse_stock.csv','sku warehouse on_hand',[[p[0],w,p[3][i]] for p in PRODUCTS for i,w in enumerate(WAREHOUSES)])
    emit('transfers.csv','from_warehouse to_warehouse lead_days',
        [[a,b,3 if {a,b}=={'MAIN','WEST'} else 2] for a in WAREHOUSES for b in WAREHOUSES if a!=b])
    emit('stock_states.csv','sku warehouse damaged reserved quarantine returns',
        [[p[0],w,6 if p[0]=='TILE-SAND' and w=='MAIN' else 0,6 if p[0]=='TILE-SAND' and w=='MAIN' else 0,
          2 if p[0]=='ADH-20' and w=='EAST' else 0,1 if p[0]=='GROUT-5' and w=='WEST' else 0]
         for p in PRODUCTS for w in WAREHOUSES])
    history=[]
    for p in PRODUCTS:
        for i,month in enumerate(MONTHS):
            y,m=map(int,month.split('-'))
            days=calendar.monthrange(y,m)[1]
            # One censored lost-sales month; one confirmed project-only month.
            history.append([p[0],month,p[4][i],15 if p[0]=='TILE-SAND' and month=='2026-08' else days,
                            'false','true' if p[0]=='ADH-20' and month=='2026-07' else 'false'])
    emit('sales_history.csv','sku month quantity in_stock_days backorder project',history)
    receipts=[]
    for i,lead in enumerate([20,25,30,35,45],1):
        po=date(2026,i,1)
        receipts.append([f'SYN-R{i}',f'SYN-PO{i}','TILE-SAND','MAIN',po.isoformat(),(po+timedelta(days=30)).isoformat(),(po+timedelta(days=lead)).isoformat(),48,'SYN-TILE','true'])
    emit('receipts.csv','receipt_id po_id sku warehouse po_date promised_date received_date quantity supplier po_complete',receipts)
    emit('incoming_pos.csv','po_line_id sku warehouse supplier remaining_qty due_date status',
        [['SYN-OPEN-1','TILE-SAND','MAIN','SYN-TILE',48,'2026-11-25','confirmed'],
         ['SYN-OPEN-2','ADH-20','EAST','SYN-CHEM',20,'2026-10-25','confirmed'],
         ['SYN-OPEN-3','GROUT-5','WEST','SYN-CHEM',10,'2026-11-05','draft']])
    emit('customer_orders.csv','order_line_id sku warehouse quantity delivery_date status forecast_included',
        [['SYN-SO-1','TILE-SAND','MAIN',36,'2026-11-10','confirmed','true'],
         ['SYN-SO-2','TILE-SAND','EAST',24,'2026-11-20','confirmed','true'],
         ['SYN-SO-3','ADH-20','MAIN',10,'2026-11-15','confirmed','false']])
    emit('relationships.csv','source_sku target_sku kind direction ratio',
        [['TILE-SAND','TILE-GREY','substitute','both',1],['TILE-SAND','ADH-20','complement','forward',.25],
         ['TILE-SAND','GROUT-5','kit','forward',.125]])
    emit('unit_conversions.csv','sku from_unit to_unit factor',
        [['TILE-SAND','box','m2',1.44],['TILE-GREY','box','m2',1.44],['TILE-OLD','box','m2',1.44]])
    emit('reorder_rules.csv','rule_id sku warehouse min_qty max_qty multiple route trigger lead_days',
        [['SYN-RULE-1','TILE-SAND','MAIN',12,120,12,'buy','manual',30],
         ['SYN-RULE-2','GROUT-5','WEST',2,5,1,'buy','auto',14]])
    return counts


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'samples'/'synthetic')
    args=parser.parse_args(argv)
    print(json.dumps({'synthetic':True,'output':str(args.output),'counts':make_samples(args.output)},indent=2))


if __name__=='__main__':
    main()
