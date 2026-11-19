"""Offline learning contracts: actuals, never self-modifying code."""
import copy
import json
import pytest
import engine


def raw(sales=None, sku='BIAS'):
    return dict(sku=sku, name='Synthetic', unit='box', on_hand=0, supplier_days=14,
                monthly_sales=sales or [80, 100, 90, 110]*12, receipts={})


def dataset(item=None, last='2026-10'):
    item = item or raw()
    n = len(item['monthly_sales'])
    months = [engine.month_after(last, i-n+1) for i in range(n)]
    import calendar
    return dict(items=[item], months=months, as_of=last+'-'+str(calendar.monthrange(int(last[:4]),int(last[5:]))[1]))


def diary_rows(data, prediction=80):
    return [dict(version=1, sku=data['items'][0]['sku'], as_of=engine.month_after(m,-1), method='champion', scale=10,
                 forecast=[dict(month=engine.month_after(m,h), p50=prediction, p80=prediction+20, p95=prediction+30) for h in range(3)])
            for m in data['months'][-6:]]


def test_diary_records_three_future_months_without_mutation():
    data=dataset(); before=copy.deepcopy(data)
    rows=engine.forecast_diary(data)
    assert data==before
    assert len(rows)==1 and rows[0]['version']==1
    assert rows[0]['as_of']=='2026-10'
    assert [x['month'] for x in rows[0]['forecast']]==['2026-11','2026-12','2027-01']
    assert all(x['p50']>=0 for x in rows[0]['forecast'])
    assert engine.forecast_diary(dict(items=[],months=[],as_of=''))==[]


def test_matured_scores_ignore_future_duplicates_and_invalid_entries():
    data=dataset(raw([100]*48)); rows=diary_rows(data)
    score=engine.score_diary(rows+rows+[{},dict(rows[-1],as_of='2099-01')],data)
    assert score['overall']['count']==6
    assert score['overall']['mase']==2
    assert score['overall']['bias']==20
    assert score['overall']['accuracy']==.8
    assert score['overall']['coverage']=={'p50':0,'p80':1,'p95':1}
    assert engine.score_diary([],data)['overall']['accuracy'] is None
    assert engine.score_diary(rows,dict(data,partial_last_month=True))['overall']['count']==5


def test_bias_is_capped_gated_optional_and_reversible():
    import learning
    sales=[100+i%2*10 for i in range(48)]
    rows=[dict(sku='BIAS',month=f'2026-{m:02d}',prediction=100,actual=110,error=10,scale=10) for m in range(5,11)]
    folds=[dict(origin=o,actual=[110,110,110],prediction=[100,100,100],errors=[10,10,10]) for o in range(12,20)]
    selected=dict(forecast=[100]*12,folds=folds,method='champion',adopted=False,candidates={})
    item=raw(sales); item['_learning_context']=dict(entries=rows,enabled=True)
    changed=learning.bias_correction(item,selected,sales,folds,folds)
    assert changed['forecast']==pytest.approx([110]*12)
    assert changed['learning']['state']=='applied' and changed['learning']['factor']==pytest.approx(1.1)
    assert learning.bias_correction(raw(sales),selected,sales,folds,folds)==selected
    item['_learning_context']['enabled']=False
    assert learning.bias_correction(item,selected,sales,folds,folds)==selected
    item['_learning_context']['enabled']=True
    item['_learning_context']['entries']=[dict(r,error=100,actual=200) for r in rows]
    proposed=learning.bias_correction(item,selected,sales,folds,folds)
    assert proposed['forecast']==selected['forecast'] and proposed['learning']['state']=='proposal'
    assert abs(proposed['learning']['factor']-1)<=.15+1e-12
    item['_learning_context']['entries']=rows
    perfect=[dict(r,prediction=r['actual'],errors=[0,0,0]) for r in folds]
    rejected=learning.bias_correction(item,dict(selected,folds=perfect),sales,perfect,perfect)
    assert rejected['forecast']==selected['forecast'] and rejected['learning']['state']=='rejected'


def test_prepare_learning_is_noop_without_diary_and_undo_is_per_sku():
    data=dataset(); rows=diary_rows(data)
    assert engine.prepare_learning(data,[],dict(learning_enabled=True)) is data
    learned=engine.prepare_learning(data,rows,dict(learning_enabled=True,learning_disabled_skus=['BIAS']))
    assert learned['items'][0]['_learning_context']['enabled'] is False
    assert '_learning_context' not in data['items'][0]


def test_pattern_change_warns_and_reselects_without_quantity_change():
    import learning
    from health import data_health
    data=dataset(raw([100,110]*24)); rows=diary_rows(data, prediction=100)
    # A measured break in forecast misses, not just a large isolated spike.
    data['items'][0]['monthly_sales'][-6:]=[100,100,100,180,180,180]
    prepared=engine.prepare_learning(data,rows,dict(learning_enabled=False))
    ctx=prepared['items'][0]['_learning_context']
    assert learning.pattern_changed(ctx['entries']) is True
    health=data_health(prepared)
    assert any(w['code']=='pattern_changed' and w['short_label']=='Pattern changed' for w in health['warnings'])
    assert health['features']['learning']['state']=='on'
    assert engine.forecast_selection(prepared['items'][0],'2026-10')['reselection_requested'] is True
    assert engine.forecast(prepared['items'][0],data['months'],data['as_of'])==engine.forecast(data['items'][0],data['months'],data['as_of'])
    assert not learning.pattern_changed([dict(r,error=0) for r in ctx['entries']])


def test_report_card_accuracy_delta_methods_and_absent_identity():
    data=dataset(raw([100]*48)); rows=diary_rows(data,80)
    report=engine.learning_report(data,rows)
    assert report['accuracy']==.8 and report['change']==0
    assert report['count']==6 and sum(report['methods'].values())==1
    assert report['state']=='on'
    assert engine.learning_report(data,[])['state']=='hidden'
    assert report['changes']==[]


def test_a_class_method_switch_is_proposal_and_logs_are_append_only(tmp_path):
    import learning
    data=dataset(raw([100+i*10 for i in range(60)]))
    rows=diary_rows(data, prediction=600)
    prepared=engine.prepare_learning(data,rows,dict(learning_enabled=True))
    selected=engine.forecast_selection(prepared['items'][0],'2026-10')
    assert prepared['items'][0]['_learning_context']['abc']=='A'
    # Force a previously used different method; no owner authorization is inferred.
    item=prepared['items'][0];item['_learning_context']['prior_method']='seasonal_naive'
    proposed=engine.forecast_selection(item,'2026-10')
    assert proposed['method']=='champion'  # Failed prior challenger is withdrawn safely.
    assert proposed['learning']['kind']=='method_switch' and proposed['learning']['state']=='proposal'
    events=engine.learning_events(prepared,rows,dict(learning_enabled=True))
    for e in events:
        assert e['version']==1 and e['when']==data['as_of'] and 'before' in e and 'after' in e
        assert e['owner_approval'] is (e['state']=='proposal')
    path=tmp_path/'learning.jsonl'
    assert learning.append_jsonl(path,events)==len(events)
    old=path.read_bytes()
    assert learning.append_jsonl(path,events)==0 and path.read_bytes()==old


def test_twelve_month_replay_bias_break_and_logged_undo():
    diary=[]; log=[]; states=[]; alerts=[]; snapshot=None
    for t in range(12):
        last=engine.month_after('2026-01',t)
        # Keep this correction replay irregular under the owner-fixed classifier.
        a=raw([10000]+[100*1.01**i for i in range(1,36+t)])
        b=raw([100,110]*18+[105]*min(t,6)+[300]*max(0,t-6), 'BREAK')
        data=dataset(a,last); data['items'].append(b)
        # BREAK has a planted step after six stable replay months.
        prepared=engine.prepare_learning(data,diary,dict(learning_enabled=True))
        selections=[engine.forecast_selection(x,last) for x in prepared['items']]
        states.extend(s.get('learning',{}).get('state') for s in selections)
        alerts.extend(s.get('reselection_requested',False) for s in selections)
        events=engine.learning_events(data,diary,dict(learning_enabled=True),log)
        log.extend(e for e in events if e['id'] not in {x['id'] for x in log})
        if any(s.get('learning',{}).get('state')=='applied' for s in selections):snapshot=(data,list(diary),list(log))
        diary.extend(engine.forecast_diary(prepared))
    assert 'applied' in states and any(alerts)
    assert all(abs(e['factor']-1)<=.15+1e-12 for e in log if 'factor' in e)
    assert snapshot is not None
    data,diary,log=snapshot
    off=engine.learning_events(data,diary,dict(learning_enabled=True,learning_disabled_skus=['BIAS']),log)
    assert any(e['kind']=='correction_disabled' and e['sku']=='BIAS' for e in off)


def test_correction_does_not_feed_back_or_lose_reenable_log():
    diary=[]; log=[]; states=[]; snap=None
    for t in range(20):
        data=dataset(raw([10000]+[100*1.01**i for i in range(1,36+t)]),engine.month_after('2026-01',t))
        prepared=engine.prepare_learning(data,diary,dict(learning_enabled=True))
        selection=engine.forecast_selection(prepared['items'][0],data['as_of'][:7])
        state=selection.get('learning',{}).get('state');states.append(state)
        if state=='applied': snap=(data,list(diary))
        diary.extend(engine.forecast_diary(prepared))
    assert states[6:12] == ['applied']*6
    # Longer irregular prefixes can propose a better method; owner approval
    # still gates it rather than silently treating the proposal as correction.
    assert all(s in ('applied', 'proposal') for s in states[12:])
    data,diary=snap
    for settings in [dict(learning_enabled=True),dict(learning_enabled=False),dict(learning_enabled=True)]:
        log.extend(engine.learning_events(data,diary,settings,log))
    assert [e['state'] for e in log if e['kind'] in ('bias_correction','correction_disabled')]==['applied','disabled','applied']
    assert len({e['id'] for e in log})==len(log)


def test_owner_approval_and_dismissal_are_durable_logged_decisions():
    data=dataset(raw([100+i*10 for i in range(60)])); diary=diary_rows(data,600)
    settings=dict(learning_enabled=True)
    log=engine.learning_events(data,diary,settings)
    pending=engine.learning_report(data,diary,settings,log)['pending']
    assert pending and pending[0]['kind']=='method_switch'
    proposal=pending[0]
    approved=engine.learning_decision(data,diary,settings,log,proposal['id'],'approve')
    decided=log+approved['events']
    assert approved['events'][-1]['state']=='approved'
    assert approved['events'][-1]['proposal_id']==proposal['id']
    selected=engine.forecast_selection(engine.prepare_learning(data,diary,approved['settings'])['items'][0],'2026-10')
    assert selected['method']==proposal['method_after']
    changed=copy.deepcopy(data);changed['items'][0]['monthly_sales'][-1]+=100
    stale=engine.forecast_selection(engine.prepare_learning(changed,diary,approved['settings'])['items'][0],'2026-10')
    assert stale.get('method_change',{}).get('reason')=='Owner approved'  # Same method pair remains authorized; gate reruns.
    assert selected['method_change']['reason']=='Owner approved'
    assert engine.learning_settings_from_log(data,settings,decided)==approved['settings']
    assert not engine.learning_report(data,diary,approved['settings'],decided)['pending']
    dismissed=engine.learning_decision(data,diary,settings,log,proposal['id'],'dismiss')
    assert not engine.learning_report(data,diary,settings,log+dismissed['events'])['pending']
    assert dismissed['settings']==settings
    for bad_id in ('missing',proposal['id']):
        with pytest.raises(ValueError): engine.learning_decision(data,diary,settings,decided,bad_id,'approve')
    newer=dataset(raw([100+i*10 for i in range(61)]),'2026-11')
    assert engine.learning_settings_from_log(newer,settings,decided)['learning_prior_methods']['BIAS']==proposal['method_after']
    with pytest.raises(ValueError): engine.learning_decision(newer,diary,settings,log,proposal['id'],'approve')


def test_approved_bias_stays_capped_and_must_pass_gate():
    import learning
    sales=[100,110]*24
    rows=[dict(sku='BIAS',month=f'2026-{m:02d}',prediction=100,actual=130,error=30,scale=10) for m in range(5,11)]
    folds=[dict(origin=o,actual=[130]*3,prediction=[100]*3,errors=[30]*3) for o in range(12,20)]
    selected=dict(forecast=[100]*12,folds=folds,method='champion',adopted=False,candidates={})
    item=raw(sales);item['_learning_context']=dict(entries=rows,enabled=True,approved_bias=dict(before=[100]*12,after=[115]*12,factor=1.15,requested_factor=1.3))
    result=learning.bias_correction(item,selected,sales,folds,folds)
    assert result['learning']['state']=='applied' and result['forecast']==pytest.approx([115]*12)
    perfect=[dict(r,prediction=r['actual'],errors=[0]*3) for r in folds]
    result=learning.bias_correction(item,dict(selected,folds=perfect),sales,perfect,perfect)
    assert result['learning']['state']=='approved_not_tested' and result['learning']['reason']=='Approved, not tested' and result['forecast']==selected['forecast']


def test_cli_owner_decisions_persist_and_reject_unknown(tmp_path, monkeypatch, capsys):
    import learning
    from tests.test_cli import load_cli
    from types import SimpleNamespace
    cli=load_cli(); loaded_engine,_=cli._load_modules()
    data=dataset(raw([100+i*10 for i in range(60)])); diary=diary_rows(data,600)
    stock=tmp_path/'stock.csv';stock.write_text('synthetic')
    archive=tmp_path/'diary.jsonl'; log_path=tmp_path/'log.jsonl'
    learning.append_jsonl(archive,diary)
    def load_csv(path, receipts, *, max_bytes):
        assert path == str(stock) and receipts is None
        assert max_bytes == cli._parser().get_default('max_bytes')
        return copy.deepcopy(data)
    monkeypatch.setattr(cli,'_load_modules',lambda:(loaded_engine,SimpleNamespace(load_csv=load_csv)))
    args=[str(stock),'--learn','--forecast-diary',str(archive),'--learning-log',str(log_path),'--today','2026-11-12']
    assert cli.main(args)==0
    log=learning.read_jsonl(log_path); proposal=next(e for e in log if e['state']=='proposal')
    assert proposal['id'] in capsys.readouterr().err
    assert cli.main(args+['--approve',proposal['id']])==0
    log=learning.read_jsonl(log_path)
    assert any(e['kind']=='owner_decision' and e['state']=='approved' for e in log)
    before=log_path.read_bytes()
    assert cli.main(args+['--dismiss','missing'])==2
    assert log_path.read_bytes()==before
    assert 'no longer pending' in capsys.readouterr().err


def test_prior_baseline_passes_its_gate_and_failed_method_is_logged_separately():
    data=dataset(raw([10000]+[100+i+5*(i%12<6) for i in range(1,48)])); diary=diary_rows(data)
    item=engine.prepare_learning(data,diary,dict(learning_enabled=True))['items'][0]
    item['_learning_context']['prior_method']='baseline'
    selected=engine.forecast_selection(item,'2026-10')
    assert selected['method']=='baseline'
    assert selected['learning']['method_before']=='baseline'
    assert 'method_withdrawal' not in selected
    failed=dataset(raw([100+i*10 for i in range(60)])); rows=[dict(r,method='seasonal_naive') for r in diary_rows(failed,600)]
    events=engine.learning_events(failed,rows,dict(learning_enabled=True))
    assert any(e['kind']=='method_withdrawn' and e['method_before']=='seasonal_naive' for e in events)
    assert any(e['kind']=='method_switch' and e['state']=='proposal' for e in events)


def test_diary_archive_append_is_idempotent(tmp_path):
    from learning import append_jsonl, read_jsonl
    path=tmp_path/'diary.jsonl'; rows=engine.forecast_diary(dataset())
    assert append_jsonl(path,rows)==1
    original=path.read_bytes()
    assert append_jsonl(path,rows)==0 and path.read_bytes()==original
    assert read_jsonl(path)==rows
    path.write_text('{broken}\n')
    with pytest.raises(ValueError): read_jsonl(path)
