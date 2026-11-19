"""Approved-protocol scorer real-launch tests; synthetic fixture only."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import engine
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('score_november',ROOT/'scripts/score_november.py')
scorer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorer)


class NovemberDraftTests(unittest.TestCase):
    def fixture(self):
        months=[engine.month_after('2023-11',i) for i in range(37)]
        return dict(months=months,items=[dict(sku='SYN-NOV-'+str(i),monthly_sales=[50+(k*7+i*11)%19 for k in range(37)]) for i in range(3)])

    def test_real_cli_launch_hashes_frozen_doc_and_ten_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'synthetic.json';output=Path(directory)/'report.json'
            source.write_text(json.dumps(self.fixture()))
            result=subprocess.run(['/usr/bin/python3',str(ROOT/'scripts/score_november.py'),str(source),'--output',str(output)],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            report=json.loads(output.read_text())
            self.assertEqual(report['status'],'APPROVED 2026-11-18 by owner')
            self.assertEqual(len(report['groups']['overall']['candidates']),10)
            self.assertEqual(report['hashes']['docs/history/changes/nov-2026-preregistration.md'],hashlib.sha256(scorer.PREREG.read_bytes()).hexdigest())
            self.assertEqual(report['hashes']['docs/history/changes/nov-2026-candidates.json'],hashlib.sha256(scorer.CONFIG.read_bytes()).hexdigest())
            self.assertEqual(report['input_sha256'],hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(report['counts']['eligible_skus'],3)
            self.assertTrue(all(not c['numeric_gate'] for c in report['groups']['overall']['candidates'].values()))

    def test_complete_three_month_fixture_runs_decision_replay(self):
        data=self.fixture()
        data['months'] += ['2026-12','2027-01']
        for item in data['items']:
            item['monthly_sales'] += [60,55]
        data['items'][1]['censored_months']=['2026-12']
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'synthetic.json';p.write_text(json.dumps(data))
            report=scorer.score(p)
            self.assertTrue(report['counts']['decision_ready'])
            self.assertEqual(report['counts']['decision_eligible_skus'],2)
            for row in report['groups']['overall']['candidates'].values():
                self.assertIsNotNone(row['inventory'])
                self.assertEqual(row['inventory']['inventory_cases'],2)
                self.assertEqual(row['inventory']['inventory_days'],184)
                self.assertFalse(row['numeric_gate'])

    def test_target_actuals_never_change_training_fit_or_class(self):
        data=self.fixture()
        config=json.loads(scorer.CONFIG.read_text())
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'synthetic.json';p.write_text(json.dumps(data))
            a,o,w,counts,_=scorer.load_rows(p,config)
            data['items'][0]['monthly_sales'][-1]=9999
            data['items'][1]['censored_months']=['2026-11']
            p.write_text(json.dumps(data))
            b,_,_,counts,_=scorer.load_rows(p,config)
            self.assertEqual(a[0]['observed'][:o],b[0]['observed'][:o])
            self.assertEqual(a[0]['process'],b[0]['process'])
            self.assertEqual(counts['excluded_censored_targets'],1)
            data['items'][2]['sku']=data['items'][0]['sku'];p.write_text(json.dumps(data))
            with self.assertRaises(ValueError):scorer.load_rows(p,config)
