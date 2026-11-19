#!/usr/bin/env python3
"""Approved-protocol November checkpoint scaffold. Local export only; never activates a model."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import random
import re
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine
import forecast_methods
from forecast_lab.equal_budget import prepare, replay, match_budget

CONFIG = ROOT/'docs/history/changes/nov-2026-candidates.json'
PREREG = ROOT/'docs/history/changes/nov-2026-preregistration.md'


def load_rows(path, config):
    path = Path(path).resolve()
    if any('live-pilot' in part for part in path.parts):
        raise ValueError('Live pilot input is forbidden')
    if path.stat().st_size > 10_000_000:
        raise ValueError('Export exceeds 10 MB scaffold cap')
    raw = path.read_bytes()
    data = json.loads(raw)
    months = data['months']
    if (not isinstance(months, list) or not months or any(not isinstance(m,str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',m) for m in months)
            or any(b != engine.month_after(a,1) for a,b in zip(months,months[1:]))):
        raise ValueError('Consecutive monthly dates required')
    if config['fit_through'] not in months or config['checkpoint'] not in months:
        raise ValueError('Complete October training and November actuals required')
    origin = months.index(config['fit_through'])+1
    window = max(1,math.ceil(config['lead_days']/30))
    if months[origin] != config['checkpoint'] or len(months) < origin+window or origin < 3:
        raise ValueError('Incomplete target window or history')
    decision_window = math.ceil((config['lead_days']+config['cover_months']*30)/30)
    decision_ready = len(months) >= origin+decision_window
    rows, seen, excluded = [], set(), 0
    for item in data['items']:
        sku, ys = item['sku'], item['monthly_sales']
        if not isinstance(sku,str) or not sku or sku in seen:
            raise ValueError('Unique nonempty string SKU required')
        seen.add(sku)
        if not isinstance(ys,list) or len(ys)!=len(months) or any(not engine.quantity(v) for v in ys):
            raise ValueError('Complete finite nonnegative observations required')
        censored = item.get('censored_months',[])
        if not isinstance(censored,list) or any(m not in months for m in censored):
            raise ValueError('Invalid censored-month list')
        if any(m in censored for m in months[origin:origin+window]):
            excluded += 1
            continue
        kind = forecast_methods.classify(ys[:origin])['class']
        # No observations after the complete checkpoint window enter this row.
        rows.append(dict(sku=sku,process=kind,observed=ys[:origin+decision_window],
                         latent=ys[:origin+decision_window],months=months[:origin+decision_window],
                         decision_eligible=decision_ready and not any(m in censored for m in months[origin:origin+decision_window])))
    if not rows:
        raise ValueError('No eligible uncensored targets')
    return rows, origin, window, dict(input_skus=len(seen),eligible_skus=len(rows),excluded_censored_targets=excluded, decision_ready=decision_ready, decision_window_months=decision_window, decision_eligible_skus=sum(r['decision_eligible'] for r in rows), excluded_censored_decision_skus=sum(not r['decision_eligible'] for r in rows) if decision_ready else 0), hashlib.sha256(raw).hexdigest()


def accuracy(cases, method, window):
    scaled, signed, actual, by_sku = [], 0.0, 0.0, {}
    for c in cases:
        ys = c['values']
        totals = [engine.planning_sum(ys[i:i+window]) for i in range(len(ys)-window+1)]
        lag = 12 if len(ys)>=24 else 1
        diffs = [(totals[i]-totals[i-lag])**2 for i in range(lag,len(totals))]
        scale = engine.planning_sum(diffs)/len(diffs) if diffs else 0
        if scale==0 and lag==12:
            diffs = [(totals[i]-totals[i-1])**2 for i in range(1,len(totals))]
            scale = engine.planning_sum(diffs)/len(diffs) if diffs else 0
        truth = engine.planning_sum(c['truth'][:window])
        err = engine.planning_sum(c['curves'][method][:window])-truth
        signed += err
        actual += truth
        if scale>0:
            scaled.append((err*err/scale,err/math.sqrt(scale)))
            by_sku[c['sku']] = dict(square=err*err/scale,bias=err/math.sqrt(scale))
    n=len(scaled)
    return dict(rmsse=math.sqrt(sum(x[0] for x in scaled)/n) if n else None,
                scaled_bias=sum(x[1] for x in scaled)/n if n else None,
                bias_units=signed,bias_pct=100*signed/actual if actual else None,
                scaled_skus=n,unavailable_scale_skus=len(cases)-n,by_sku=by_sku)


def bootstrap_fill(current, candidate, config):
    keys=sorted(current)
    rng=random.Random(config['bootstrap_seed'])
    deltas=[]
    for _ in range(config['bootstrap_repetitions']):
        sampled=[keys[rng.randrange(len(keys))] for _ in keys]
        demand=sum(current[k]['sold']+current[k]['lost'] for k in sampled)
        if demand:
            deltas.append(sum(candidate[k]['sold']-current[k]['sold'] for k in sampled)/demand)
    deltas.sort()
    if not deltas:
        return dict(interval_90=None,valid_resamples=0)
    return dict(interval_90=[deltas[math.floor(.05*(len(deltas)-1))],deltas[math.ceil(.95*(len(deltas)-1))]],valid_resamples=len(deltas))


def score(path):
    config=json.loads(CONFIG.read_text())
    if (config['lead_days'],config['review_days'],config['cover_months'],config['service_target'],config['budget_multiplier_max']) != (14,30,2,.95,128):
        raise ValueError('Scaffold policy constants changed: review adapter before scoring')
    rows,origin,window,counts,input_hash=load_rows(path,config)
    cases=prepare(rows,len(rows),config['methods'],lambda _: [origin],counts['decision_window_months'] if counts['decision_ready'] else window)
    decision_skus={r['sku'] for r in rows if r['decision_eligible']}
    groups={'overall':cases}
    groups.update({k:[c for c in cases if c['process']==k] for k in sorted({c['process'] for c in cases})})
    report={}
    for group, selected in groups.items():
        decision_cases=[c for c in selected if c['sku'] in decision_skus]
        baseline=replay(decision_cases,'current','sales_variation',1,details=True) if decision_cases else None
        base_accuracy=accuracy(selected,'current',window)
        entries={}
        for method in config['methods']:
            acc=accuracy(selected,method,window)
            for basis in config['safety_stock_bases']:
                if baseline is None:
                    entries[method+'+'+basis]=dict(accuracy=acc,inventory=None,decision_status='PENDING_COMPLETE_THREE_MONTH_ACTUALS',numeric_gate=False,promotion='KEEP_CURRENT')
                    continue
                matched=match_budget(lambda m:replay(decision_cases,method,basis,m),baseline['average_inventory_value'],config['budget_tolerance_fraction'],config['budget_bisection_iterations'])
                detail=replay(decision_cases,method,basis,matched['safety_multiplier'],details=True)
                boot=bootstrap_fill(baseline['by_sku'],detail['by_sku'],config)
                delta=detail['fill_rate']-baseline['fill_rate'] if detail['fill_rate'] is not None and baseline['fill_rate'] is not None else None
                ci=boot['interval_90']
                numeric_pass=bool(len(decision_cases)>=config['minimum_skus'] and acc['scaled_skus']>=config['minimum_skus'] and matched['matched'] and delta is not None and delta>=config['fill_improvement_points']/100 and ci and ci[0]>0 and detail['stockout_days_per_case']<=baseline['stockout_days_per_case'] and acc['rmsse'] is not None and base_accuracy['rmsse'] is not None and acc['rmsse']<=base_accuracy['rmsse'] and abs(acc['scaled_bias'])<=abs(base_accuracy['scaled_bias']))
                entries[method+'+'+basis]=dict(accuracy=acc,inventory=matched,fill_improvement=delta,bootstrap=boot,numeric_gate=numeric_pass,promotion='KEEP_CURRENT_ACTUAL_REPLAY_REVIEW_REQUIRED')
        report[group]=dict(skus=len(selected),candidates=entries)
    paths=[PREREG,CONFIG,ROOT/'engine.py',ROOT/'forecast_methods.py',ROOT/'forecast_methods.js',ROOT/'docs/forecast-methods-spec.md',ROOT/'forecast_lab/__init__.py',ROOT/'forecast_lab/equal_budget.py',ROOT/'forecast_lab/benchmark_methods.py',Path(__file__).resolve()]
    return dict(status=config['status'],note='Synthetic-policy scenario scaffold; no actual supply/cost reconstruction or default activation. One month is a checkpoint, not proof.',
                hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},input_sha256=input_hash,
                counts=counts,fit_through=config['fit_through'],checkpoint=config['checkpoint'],lead_window_months=window,groups=report)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(argv)
    try:
        result=score(args.export)
        if args.output.resolve()==args.export.resolve():
            raise ValueError('Output cannot overwrite input')
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
        print(json.dumps(dict(status=result['status'],counts=result['counts'],output=str(args.output))))
    except (ValueError,KeyError,TypeError,OSError,IndexError) as error:
        parser.exit(2,str(error)+'\n')


if __name__=='__main__':
    main()
