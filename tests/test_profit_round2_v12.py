"""Synthetic regression contracts for round-2 safety fallbacks and cadence."""
import json
from pathlib import Path
import subprocess
import unittest
import engine
import profit_order

ROOT = Path(__file__).resolve().parents[1]

class Round2(unittest.TestCase):
    def item(self, sales=None, **kw):
        raw = dict(sku='ROUND2',name='Synthetic',unit='u',on_hand=0,unit_cost=10,
                   sale_price=20,supplier_days=3,monthly_sales=sales or [100]*24,receipts={})
        raw.update(kw)
        return raw

    def guidance(self, raw, settings):
        months = [engine.month_after('2024-12',i+1) for i in range(len(raw['monthly_sales']))]
        p = engine.forecast(raw,months,'2026-12-31',settings=settings)
        return engine.order_guidance({**raw,**p,'as_of':'2026-12-31'},'2027-01-01',settings)

    def test_irregular_demand_omits_suggestion_without_changing_standard_plan(self):
        raw=self.item([0,0,80,0,0,100]*4)
        g=self.guidance(raw,{'profit_suggestion':True})
        ordinary=self.guidance(raw,{})
        self.assertNotIn('profit_suggestion',g)
        self.assertEqual(g['profit_suggestion_unavailable'],'Sales too irregular for a reliable profit estimate; using standard amount.')
        for key in ('quantity','order_by','order_date','safety_stock','reorder_point'):
            self.assertEqual(g.get(key),ordinary.get(key))

    def test_short_life_cadence_is_guidance_only(self):
        raw=self.item(shelf_life_days=14)
        g=self.guidance(raw,{'profit_suggestion':True,'review_days':7})
        self.assertEqual(g['shelf_cap_qty'],self.guidance(raw,{})['shelf_cap_qty'])
        self.assertEqual(g['order_every_days'],7)
        self.assertIn('Order every 7 days',g['cap_reason'])
        self.assertIn('7-day review',g['profit_suggestion']['reason'])

    def test_opt_in_optimizer_keeps_lane_o_stock_basis(self):
        raw=self.item(shelf_life_days=90,on_hand=50)
        ordinary=self.guidance(raw,{'profit_suggestion':True})
        lots=self.guidance({**raw,'lots':[{'lot':'SYN','expiry':'2027-01-02','qty':50}]},{'profit_suggestion':True})
        self.assertEqual(lots['profit_suggestion']['qty'],ordinary['profit_suggestion']['qty'])

    def test_imported_sale_price_flows_without_setting(self):
        import tempfile
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            csv=Path(directory)/'synthetic-price.csv'
            csv.write_text('sku,name,unit,on_hand,unit_cost,sales price,supplier_days,2026-10,2026-11,2026-12\nROUND2,Synthetic,u,0,10,27.5,3,100,100,100\n')
            p=subprocess.run(['/usr/bin/python3','stock_runway.py',str(csv),'--today','2027-01-01','--profit-suggestion','--costs','--all','--json','--show-orders-anyway'],cwd=ROOT,text=True,capture_output=True)
            self.assertEqual(p.returncode,0,p.stderr)
            rows=json.loads(p.stdout)
            self.assertEqual(rows[0]['margin_unit'],17.5)
            self.assertIn('profit_suggestion',rows[0])
            self.assertIsNotNone(rows[0]['profit_suggestion']['expected_profit'])

    def test_unavailable_reason_is_in_cli_explanation(self):
        raw=self.item([0,0,80,0,0,100]*4)
        months=[engine.month_after('2024-12',i+1) for i in range(24)]
        p=engine.forecast(raw,months,'2026-12-31')
        text=engine.why_this_amount({**raw,**p,'as_of':'2026-12-31'},'2027-01-01',{'profit_suggestion':True})
        self.assertNotIn('Most profitable:',text)
        self.assertIn('Sales too irregular',text)

    def test_forecast_does_not_compute_unused_profit_suggestions(self):
        from unittest.mock import patch
        raw=self.item(on_order=10)
        months=[engine.month_after('2024-12',i+1) for i in range(24)]
        with patch.object(profit_order,'suggest',wraps=profit_order.suggest) as sampler:
            p=engine.forecast(raw,months,'2026-12-31',settings={'profit_suggestion':True})
            self.assertEqual(sampler.call_count,0)
            g=engine.order_guidance({**raw,**p,'as_of':'2026-12-31'},'2027-01-01',{'profit_suggestion':True})
            self.assertEqual(sampler.call_count,1)
            self.assertIsNotNone(g['profit_suggestion'])

    def test_python_js_safety_and_review_parity(self):
        cases=[(self.item([0,0,80,0,0,100]*4),{'profit_suggestion':True}),
               (self.item(shelf_life_days=14),{'profit_suggestion':True,'review_days':7}),
               (self.item(on_hand=80,shelf_life_days=90),{'profit_suggestion':True})]
        script="""const fs=require('fs'),vm=require('vm');const s=fs.readFileSync('desktop/plugin.js','utf8');const c=vm.createContext({TextEncoder,TextDecoder,atob,btoa});vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replaceAll('export ',''),c);c.cases=JSON.parse(fs.readFileSync(0,'utf8'));const r=vm.runInContext(`cases.map(([raw,settings])=>{const months=Array.from({length:raw.monthly_sales.length},(_,i)=>monthAfter('2024-12',i+1));const p=calculate([raw],months,'2026-12-31',6,settings)[0];const g=orderGuidance({...raw,...p,as_of:'2026-12-31'},'2027-01-01',settings);return {suggestion:g.profit_suggestion??null,unavailable:g.profit_suggestion_unavailable??null,cap:g.shelf_cap_qty??null,every:g.order_every_days??null}})`,c);console.log(JSON.stringify(r));"""
        expected=[]
        for raw,s in cases:
            g=self.guidance(raw,s)
            expected.append(dict(suggestion=g.get('profit_suggestion'),unavailable=g.get('profit_suggestion_unavailable'),cap=g.get('shelf_cap_qty'),every=g.get('order_every_days')))
        p=subprocess.run(['node','-e',script],input=json.dumps(cases),text=True,capture_output=True,cwd=ROOT)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(json.loads(p.stdout),expected)

if __name__ == '__main__': unittest.main()
