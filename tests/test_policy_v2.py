"""Policy v2: independent demand, trigger and order-up-to regression oracles."""
import calendar
from datetime import date,timedelta
from fractions import Fraction
import math
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('policy_cli',ROOT/'stock_runway.py')
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
e,_=cli._load_modules()
MONTHS=['2026-08','2026-09','2026-10'];ASOF='2026-10-31'
def plan(**kw):
 settings=kw.pop('settings',{})
 raw=dict(sku='T',name='T',unit='u',on_hand=100,supplier_days=14,monthly_sales=[60,90,120],receipts={});raw.update(kw)
 row=e.forecast(raw,MONTHS,ASOF,settings=settings)
 item={**raw,**row,'as_of':ASOF}
 return e.order_guidance(item,ASOF,settings),item

def test_hand_recompute_sample_sd_trigger_and_single_window():
 g,row=plan()
 # Mean=90, SAMPLE sigma=sqrt((900+0+900)/2)=30.
 ss=math.ceil(1.6449*30*math.sqrt(44/30))
 assert ss==60 and g['safety_stock']==ss
 assert g['reorder_point']==102 # 14/30*90 + 60
 assert g['order_by']=='now' # reaches 60 on Nov14; minus 14 days = Oct31
 assert g['order_date']==ASOF and g['endpoint']=='2027-01-13'
 exact=Fraction(90)+90+Fraction(90*13,31)+ss-100
 assert g['quantity']==math.ceil(exact)==178
 assert row['order_by']==g['order_by']

def test_service_level_changes_default_quantity():
 assert [plan(settings={'service_level':s})[0]['quantity'] for s in [.9,.95,.99]]==sorted(set(plan(settings={'service_level':s})[0]['quantity'] for s in [.9,.95,.99]))

def test_zero_cover_never_orders_phantom_units():
 assert plan(settings={'months_of_cover':0})[0]['quantity']==0

def test_calendar_accumulates_exact_decimals_before_pack_rounding():
 item=dict(as_of=ASOF,monthly_demand=456.5,monthly_sales=[456.5]*3,seasonal=False)
 demand=Fraction(*e._guidance_calendar_demand(e._guidance_demand(item),ASOF,date(2027,1,31).toordinal()))
 assert demand==Fraction('1369.5')
 assert e.suggested_order_quantity(Fraction('913.0000000000001'),0,[],{'pack_size':913})==913

def test_undated_incoming_moves_both_order_window_and_timing():
 g,_=plan(on_order=500)
 assert g['order_date']==g['order_by']
 assert g['undated_on_order_assumed_within_lead'] is True
 assert g['quantity']>150

def test_receipt_lead_variability_is_explicit_and_affects_safety_stock():
 base,_=plan()
 g,_=plan(receipt_history=[{'ordered_on':'2026-01-01','received_on':f'2026-01-{d:02d}','quantity':1} for d in [2,3,4,5,20]])
 assert g['safety_stock']>base['safety_stock']
 assert g['safety_stock_provenance']['lead_time_variability']=='receipt history'
 assert base['safety_stock_provenance']['lead_time_variability']=='not available — demand variability only'

def test_rejected_receipt_records_do_not_inflate_safety_stock():
 base,_=plan()
 valid=[{'ordered_on':'2026-01-01','received_on':f'2026-01-{d:02d}','quantity':1} for d in [2,3,4,5,20]]
 invalid=[[{**r,'quantity':q} for r in valid] for q in [0,-1,None,True,'1']]
 invalid += [[{k:v for k,v in r.items() if k!='quantity'} for r in valid],
             [{**r,'ordered_on':'2026-11-01','received_on':'2026-11-20'} for r in valid]]
 for receipts in invalid:
  g,_=plan(receipt_history=receipts)
  assert g['safety_stock']==base['safety_stock']==60
  assert g['safety_stock_provenance']['receipt_samples']==0

def test_receipt_after_order_date_is_not_position_at_order_date():
 g,_=plan(on_hand=10,supplier_days=2,monthly_sales=[30]*3,receipts={'2026-12':100})
 assert g['order_date']=='2026-11-08'
 assert g['incoming']==0
 # Prefix before Dec1: November30 + December30/31 - stock10.
 # Endpoint Jan9 is covered by Dec1 supply, but the earlier gap remains.
 assert g['quantity']==math.ceil(Fraction(30)+Fraction(30,31)-10)==21


def test_no_sales_has_no_runout():
 g,row=plan(on_hand=0,monthly_sales=[0]*3)
 assert g['runout_date'] is None and row['runout_day'] is None
