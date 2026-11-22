"""Synthetic-only picker cache cost and exact-result contracts; no wall-clock gate."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from typing import Iterator

import engine
import forecast_methods as fm

ROOT = Path(__file__).resolve().parents[1]
SEASONAL = [20, 30, 250, 40, 10, 100, 20, 20, 10, 50, 10, 20] * 3


def cases() -> Iterator[dict]:
    for xs in ([], [0] * 36, [12] * 19, [12] * 20, [12] * 21,
               SEASONAL, list(range(1, 49)), [0, 10, 4] * 20,
               [1e12] * 24 + [5e-324] * 3, list(range(1, 1201))):
        for previous in (None, *fm.RECOMMEND_CANDIDATES):
            for adjust in (False, True):
                yield dict(values=xs, previous=previous, stockout_adjust=adjust)


def normalized_digest(results):
    # JSON in both runtimes uses binary64 numbers; normalize integral floats.
    def normalize(x):
        if isinstance(x, float) and x.is_integer():
            return int(x)
        if isinstance(x, list):
            return [normalize(v) for v in x]
        if isinstance(x, dict):
            return {k: normalize(v) for k, v in x.items()}
        return x
    return hashlib.sha256(json.dumps(normalize(results), sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


class RecommendedCacheTests(unittest.TestCase):
    def test_reconstruction_fits_each_exact_candidate_prefix_only_once(self):
        with patch.object(fm, 'recommend_forecast', wraps=fm.recommend_forecast) as fit:
            result = fm.recommend(SEASONAL)
        keys = [(tuple(c.args[0]), *c.args[1:]) for c in fit.call_args_list]
        self.assertEqual(len(keys), len(set(keys)), 'prior/current folds must share fits')
        self.assertLessEqual(len(keys), 47, '9 unique origins x 5 methods + 2 final curves')
        self.assertEqual(result['method'], 'seasonal_naive')

    def test_complete_results_match_pre_optimization_fingerprint(self):
        self.assertEqual(normalized_digest([fm.recommend(**c) for c in cases()]),
                         '31c8e07bdc61ac7fcbe26a3589458512678e315aa4a4b844ae93843c11961c4b')

    def test_calls_do_not_retain_results_or_inputs_and_modes_recompute(self):
        for case in cases():
            with self.subTest(previous=case['previous'], mode=case['stockout_adjust'],
                              length=len(case['values'])):
                source = copy.deepcopy(case)
                expected = fm.recommend(**source)
                result = fm.recommend(**case)
                result['forecast'][0] = -999
                result['scores']['ses'] = -999
                if result['backtest']:
                    result['backtest'][0]['predictions']['ses'][0] = -999
                    result['backtest'][0]['actual'][0] = -999
                self.assertEqual(case, source)
                with patch.object(fm, 'recommend_forecast', wraps=fm.recommend_forecast) as fit:
                    self.assertEqual(fm.recommend(**case), expected)
                    self.assertGreater(fit.call_count, 0, 'memo must end with each recommendation')
        changed = SEASONAL.copy()
        changed[0] += 1
        self.assertNotEqual(fm.recommend(changed), fm.recommend(SEASONAL))

    def test_existing_evaluation_fit_cache_shares_exact_clones_and_invalidates_edits(self):
        item: dict = dict(sku='SYNTH-A', name='Synthetic', unit='u', on_hand=10,
                    supplier_days=14, monthly_sales=SEASONAL.copy())
        settings = dict(forecast_method='recommended')
        changed = copy.deepcopy(item)
        changed['monthly_sales'][-1] += 7
        variants = [(item, '2032-12', settings),
                    (dict(item, sku='SYNTH-B'), '2032-12', settings),
                    (changed, '2032-12', settings),
                    (item, '2033-01', settings),
                    (item, '2032-12', dict(settings, stockout_adjust=True)),
                    (dict(item, demand_change_pct=25), '2032-12', settings)]
        expected = [engine.method_item(*args) for args in variants]

        @engine.evaluation_pass
        def evaluate():
            with patch.object(fm, 'recommend', wraps=fm.recommend) as picker:
                first = [engine.method_item(*args) for args in variants]
                count = picker.call_count
                second = [engine.method_item(*args) for args in variants]
                self.assertEqual(picker.call_count, count, 'exact repeats hit pass cache')
                self.assertEqual(count, 5, 'only identical-value SKU clone can share fit')
                return first, second

        self.assertEqual(evaluate(), (expected, expected))
        self.assertIsNone(engine._EVALUATION.get(), 'pass cleanup must release the memo')

    def test_desktop_picker_prefix_cost_identity_and_mutation_isolation(self):
        script = r"""
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('desktop/plugin.js','utf8');
const core=source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle ='));
const instrumented=core.replace('function recommend_forecast(xs, horizon=12, method=\'current\') {',
 'function recommend_forecast(xs, horizon=12, method=\'current\') { globalThis.fitCalls++;');
assert.notEqual(instrumented,core,'real embedded picker must be instrumented');
const ctx=vm.createContext({TextEncoder,TextDecoder,atob,btoa,fitCalls:0});
vm.runInContext(instrumented.replaceAll('export ','')+'\nglobalThis.api=StockRunwayForecastMethods; globalThis.adapter={methodItem,withEvaluationPass};',ctx);
const input=JSON.parse(fs.readFileSync(0,'utf8')),plain=x=>JSON.parse(JSON.stringify(x));
const actual=[];
for(const c of input){
 const before=ctx.fitCalls,r=ctx.api.recommend(c.values,c.previous,c.stockout_adjust);
 assert.ok(ctx.fitCalls>before,'new public call must fit independently');
 actual.push(plain(r));
 if(c.values.length===36 && c.previous===null && c.values[2]===250)
   assert.ok(ctx.fitCalls-before<=47,'shared reconstruction must fit <=47 rather than 82 curves; got '+(ctx.fitCalls-before));
 r.forecast[0]=-999;r.scores.ses=-999;
 if(r.backtest.length){r.backtest[0].predictions.ses[0]=-999;r.backtest[0].actual[0]=-999;}
 assert.deepEqual(plain(ctx.api.recommend(c.values,c.previous,c.stockout_adjust)),actual.at(-1));
}
const sample=input.find(c=>c.values.length===36&&c.values[2]===250).values;
const item={sku:'SYNTH-A',name:'Synthetic',unit:'u',on_hand:10,supplier_days:14,monthly_sales:sample};
const settings={forecast_method:'recommended'},changed=plain(item);
changed.monthly_sales[changed.monthly_sales.length-1]+=7;
const variants=[[item,'2032-12',settings],[{...item,sku:'SYNTH-B'},'2032-12',settings],
 [changed,'2032-12',settings],[item,'2033-01',settings],
 [item,'2032-12',{...settings,stockout_adjust:true}],
 [{...item,demand_change_pct:25},'2032-12',settings]];
const expected=variants.map(args=>plain(ctx.adapter.methodItem(...args)));
ctx.adapter.withEvaluationPass(()=>{
 let before=ctx.fitCalls;
 const first=variants.map(args=>plain(ctx.adapter.methodItem(...args)));
 assert.deepEqual(first,expected,'complete adapter results must match uncached evaluation');
 assert.ok(ctx.fitCalls>before,'initial pass must fit');
 before=ctx.fitCalls;
 assert.deepEqual(variants.map(args=>plain(ctx.adapter.methodItem(...args))),expected);
 assert.equal(ctx.fitCalls,before,'exact repeats hit existing evaluation cache');
});
const before=ctx.fitCalls;ctx.adapter.methodItem(...variants[0]);
assert.ok(ctx.fitCalls>before,'evaluation cache must not leak into next call');
console.log(JSON.stringify(actual));
"""
        inputs = list(cases())
        run = subprocess.run(['node', '-e', script], input=json.dumps(inputs), text=True,
                             cwd=ROOT, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout), [fm.recommend(**c) for c in inputs])


if __name__ == '__main__':
    unittest.main()
