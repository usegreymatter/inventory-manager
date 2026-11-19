"""Versioned, deterministic learning records. Local archives are explicit opt-in.

Scores use only horizon one, once per SKU/month, on completed actual months.
Upper quantile coverage is one-sided; unavailable tails remain null.
"""
import json
import math
from pathlib import Path
import re

VERSION = 1


def number(x):
    return isinstance(x, (float, int)) and not isinstance(x, bool) and math.isfinite(x) and 0 <= x <= 1e12


def month(x):
    return isinstance(x, str) and re.fullmatch(r'[0-9]{4}-(0[1-9]|1[0-2])', x) is not None and x[:4] != '0000'


def matured_entries(diary, data):
    if not isinstance(diary, list) or not isinstance(data, dict):
        return []
    months = data.get('months', [])
    last = str(data.get('as_of', ''))[:7]
    # Fail closed on incomplete terminal months, including non-month-end snapshots.
    import calendar
    try:
        from datetime import date
        snapshot = date.fromisoformat(data['as_of'])
        complete = snapshot.day == calendar.monthrange(snapshot.year, snapshot.month)[1]
    except (ValueError, TypeError, KeyError):
        return []
    actuals = {(i.get('sku'), m): v for i in data.get('items', []) if isinstance(i, dict)
               for m, v in zip(months, i.get('monthly_sales', [])) if number(v) and month(m) and m <= last
               and not (m == last and (not complete or data.get('partial_last_month') is True))}
    seen, rows = set(), []
    for entry in diary:
        if not isinstance(entry, dict) or entry.get('version') != VERSION or not month(entry.get('as_of')):
            continue
        fs = entry.get('forecast')
        if not isinstance(fs, list) or len(fs) != 3 or not all(isinstance(f, dict) for f in fs):
            continue
        f = fs[0]
        origin = entry['as_of']
        y, m = map(int, origin.split('-'))
        target = f'{y+(m==12):04d}-{m%12+1:02d}'
        if not isinstance(entry.get('sku'), str) or not entry['sku']:
            continue
        key = (entry['sku'], target)
        if f.get('month') != target or key not in actuals or key in seen or not number(f.get('p50')):
            continue
        if not all(f.get(k) is None or number(f[k]) and f[k] >= f['p50'] for k in ('p80', 'p95')):
            continue
        if f.get('p80') is not None and f.get('p95') is not None and f['p95'] < f['p80']:
            continue
        seen.add(key)
        actual = actuals[key]
        baseline = f.get('base_p50') if number(f.get('base_p50')) else f['p50']
        rows.append(dict(sku=key[0], month=target, as_of=origin, method=entry.get('method'), actual=actual,
                         prediction=f['p50'], error=actual-f['p50'], bias_prediction=baseline, bias_error=actual-baseline, scale=entry.get('scale') if number(entry.get('scale')) else None,
                         p50=f['p50'], p80=f.get('p80'), p95=f.get('p95')))
    return sorted(rows, key=lambda r: (r['sku'], r['month']))


def metrics(rows):
    n = len(rows)
    total = sum(r['actual'] for r in rows)
    ae = sum(abs(r['error']) for r in rows)
    scaled = [abs(r['error'])/r['scale'] for r in rows if r['scale'] is not None and r['scale'] > 0]
    return dict(count=n, mase=sum(scaled)/len(scaled) if scaled else None,
                bias=sum(r['error'] for r in rows)/n if n else None,
                cfe=sum(r['error'] for r in rows), wape=ae/total if total else None,
                accuracy=1-ae/total if total else None,
                coverage={k: sum(r['actual'] <= r[k] for r in rows if r[k] is not None)/sum(r[k] is not None for r in rows)
                          if any(r[k] is not None for r in rows) else None for k in ('p50', 'p80', 'p95')})


def score_diary(diary, data):
    rows = matured_entries(diary, data)
    by_sku = {}
    for row in rows:
        by_sku.setdefault(row['sku'], []).append(row)
    return dict(overall=metrics(rows), items={s: metrics(by_sku[s]) for s in sorted(by_sku)}, entries=rows)


def pattern_changed(entries):
    """Six-month centered scaled CUSUM: reference 3, monitor 3, threshold 5."""
    rows = entries[-6:]
    if len(rows) < 6:
        return False
    indices = [int(r['month'][:4])*12+int(r['month'][5:]) for r in rows]
    if any(b-a != 1 for a,b in zip(indices, indices[1:])):
        return False
    center = sum(r['error'] for r in rows[:3])/3
    positive = negative = 0
    for row in rows[3:]:
        scale = max(row.get('scale') or 0, row['prediction']*.1, 1)
        z = (row['error']-center)/scale
        positive = max(0, positive+z-.5)
        negative = min(0, negative+z+.5)
    return positive >= 5 or negative <= -5


def approval_matches(approval, record):
    if not isinstance(approval, dict):
        return False
    def same(a,b):
        if isinstance(a,(int,float)) and isinstance(b,(int,float)):
            return math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-9)
        if isinstance(a,list) and isinstance(b,list):
            return len(a)==len(b) and all(same(x,y) for x,y in zip(a,b))
        return a==b
    return all(same(approval.get(k),record.get(k)) for k in ('before','after','factor','requested_factor','method_before','method_after'))


def decision_matches(approval, record):
    """An owner decision survives until >5pp bias change or a new method pair."""
    if not isinstance(approval, dict):
        return False
    if approval.get('kind') != 'owner_decision':
        return approval_matches(approval, record)
    if approval.get('proposal_kind') == 'bias_correction':
        a, b = approval.get('requested_factor'), record.get('requested_factor')
        return (isinstance(a, (int,float)) and isinstance(b, (int,float))
                and math.isfinite(a) and math.isfinite(b) and (a-1)*(b-1)>0 and abs(a-b)<=.05+1e-12)
    return all(approval.get(k)==record.get(k) for k in ('method_before','method_after'))


def prepare_learning(data, diary, settings=None):
    if not diary:
        return data
    settings = settings or {}
    entries = matured_entries(diary, data)
    try:
        from . import forecast_lab as lab
    except ImportError:
        import forecast_lab as lab
    classes = lab.inventory_classes(data.get('items', []))
    by_sku, last_method = {}, {}
    for row in entries:
        by_sku.setdefault(row['sku'], []).append(row)
        last_method[row['sku']] = row['method']
    return {**data, 'items': [{**item, '_learning_context': dict(
        entries=by_sku.get(item.get('sku'), []),
        abc=classes.get(item.get('sku'), {}).get('abc'),
        prior_correction=settings.get('learning_prior_corrections', {}).get(item.get('sku')),
        approved_bias=settings.get('learning_approved_bias', {}).get(item.get('sku')),
        approved_method=settings.get('learning_approved_methods', {}).get(item.get('sku')),
        prior_method=settings.get('learning_prior_methods', {}).get(item.get('sku')) or last_method.get(item.get('sku')),
        enabled=settings.get('learning_enabled') is True and item.get('sku') not in settings.get('learning_disabled_skus', []))}
        for item in data.get('items', [])]}


def retention_gate(candidate, baseline):
    """Keep an adopted factor unless >15% worse on error/bias, or coverage <60%."""
    pairs = [(candidate.get(k), baseline.get(k)) for k in ('mase','rmsse','scaled_cfe')]
    coverage = candidate.get('coverage', {}).get('0.8', {})
    return (all(a is not None and b is not None and abs(a)<=1.15*abs(b)+1e-12 for a,b in pairs)
            and coverage.get('samples',0)>=4 and coverage.get('rate') is not None and coverage['rate']>=.6)


def bias_correction(item, selected, sales, champion, flat, score=None):
    """Absolute multiplier, never compounded; 4/6 persistent misses + same gate."""
    ctx = item.get('_learning_context', {})
    if ctx.get('enabled') is not True:
        return selected
    prior = ctx.get('prior_correction') or {}
    continuing = prior.get('state')=='applied' and number(prior.get('factor')) and .85<=prior['factor']<=1.15
    rows = ctx.get('entries', [])[-6:]
    if len(rows) < 6:
        return selected
    cfe = sum(r.get('bias_error',r['error']) for r in rows)
    total = sum(r.get('bias_prediction',r['prediction']) for r in rows)
    sign = 1 if cfe > 0 else -1
    if total <= 0 or (not continuing and (abs(cfe)/total < .05 or sum(r.get('bias_error',r['error'])*sign > 0 for r in rows) < 4)):
        return selected
    requested = 1+cfe/total
    factor = prior['factor'] if continuing else min(1.15, max(.85, requested))
    before = selected['forecast']
    record = dict(kind='bias_correction', state='proposal' if abs(requested-1) > .15+1e-12 else 'rejected',
                  factor=factor, requested_factor=requested, reason='Persistent bias', before=before,
                  after=[v*factor for v in before])
    result = {**selected, 'learning': record}
    if continuing:
        record.update(state='rejected', reason='Gate rechecked')
    elif record['state'] == 'proposal':
        if not decision_matches(ctx.get('approved_bias'), record):
            return result
        record.update(state='approved_not_tested', reason='Approved, not tested')
    try:
        from . import forecast_lab as lab
    except ImportError:
        import forecast_lab as lab
    corrected = [{**r, 'prediction': [v*factor for v in r['prediction']],
                  'errors': [a-p*factor for a,p in zip(r['actual'],r['prediction'])]} for r in selected['folds']]
    # Reuse the selector's snapshot-bound metrics, never bypass its gates.
    score = score or (lambda rows: lab.score_folds(sales, rows))
    metric = score(corrected)
    comparisons = [selected['folds'], champion, flat]
    gate = retention_gate if continuing else lab.adoption_gate
    if not corrected or not all(gate(metric, score(rs)) for rs in comparisons):
        return result
    record['state'] = 'applied'
    result.update(forecast=record['after'], adopted=True, folds=corrected, errors=[r['errors'][0] for r in corrected], accuracy=metric)
    return result


def learning_event(when, sku, record, log):
    """Idempotent state events, but do not collapse disable/re-enable transitions."""
    correction = ('bias_correction','correction_disabled','correction_enabled','correction_withdrawn')
    prior = next((r for r in reversed(log) if r.get('sku')==sku and
                  (r.get('kind') in correction if record['kind'] in correction else r.get('kind')==record['kind'])), None)
    def same(a,b):
        if isinstance(a,(int,float)) and isinstance(b,(int,float)):
            return abs(a-b) <= 1e-9*max(1,abs(a),abs(b))
        if isinstance(a,list) and isinstance(b,list):
            return len(a)==len(b) and all(same(x,y) for x,y in zip(a,b))
        return a==b
    if prior and prior.get('when')==when and all(same(prior.get(k),record.get(k)) for k in ('kind','state','before','after','factor','method_before','method_after')):
        return None
    sequence = 1+sum(r.get('when')==when and r.get('sku')==sku and r.get('kind')==record['kind'] and r.get('state')==record['state'] for r in log)
    return dict(version=1,id=json.dumps([when,sku,record['kind'],record['state'],str(sequence)],ensure_ascii=False,separators=(',',':')),
                when=when,sku=sku,owner_approval=record['state']=='proposal',**record)


def _read_jsonl_locked(handle, path):
    """Caller holds the source lock through validation, recovery and append."""
    import os
    import warnings
    handle.seek(0)
    raw = handle.read()
    lines = raw.splitlines(keepends=True)
    rows, offset = [], 0
    for index, line in enumerate(lines):
        if not line.strip():
            offset += len(line)
            continue
        try:
            row = json.loads(line.decode('utf-8'))
        except (ValueError, UnicodeError):
            # Only an unterminated final fragment can be a torn append. A bad
            # completed line (including a last line with newline) fails closed.
            if index != len(lines)-1 or line.endswith((b'\n', b'\r')):
                raise ValueError('Learning archive needs checking.') from None
            quarantine = Path(str(path)+'.quarantine')
            with quarantine.open('ab') as saved:
                saved.write(line)
                saved.flush()
                os.fsync(saved.fileno())
            handle.truncate(offset)
            handle.flush()
            os.fsync(handle.fileno())
            warnings.warn('Torn learning line quarantined: '+str(quarantine), RuntimeWarning, stacklevel=3)
            break
        if not isinstance(row, dict):
            raise ValueError('Learning archive needs checking.')
        rows.append(row)
        offset += len(line)
    return rows


def read_jsonl(path):
    import fcntl
    path = Path(path)
    try:
        handle = path.open('r+b')
    except FileNotFoundError:
        return []
    with handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        return _read_jsonl_locked(handle, path)


def append_jsonl(path, rows):
    """Locked read/dedupe/append; fsync before success, preserve valid history."""
    import fcntl
    import os
    path = Path(path)
    with path.open('a+b') as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        existing = _read_jsonl_locked(handle, path)
        key = lambda r: r.get('id') or json.dumps([r.get('version'),r.get('sku'),r.get('as_of')],ensure_ascii=False,separators=(',',':'))
        seen = {key(row) for row in existing}
        fresh = []
        for row in rows:
            encoded = key(row)
            if encoded not in seen:
                fresh.append(json.dumps(row, sort_keys=True, allow_nan=False, separators=(',', ':')))
                seen.add(encoded)
        if fresh:
            end = handle.seek(0, 2)
            separator = b''
            if end:
                handle.seek(-1, 2)
                if handle.read(1) not in (b'\n', b'\r'):
                    separator = b'\n'
            handle.write(separator+('\n'.join(fresh)+'\n').encode('utf-8'))
            handle.flush()
            os.fsync(handle.fileno())
        return len(fresh)
