"""Regression tests for the Phase 3b review fixes (offline only)."""
import copy
import json
from types import SimpleNamespace
import pytest
import engine
import learning
from tests.test_phase3b import dataset, raw, diary_rows


def test_latest_correction_toggle_persists_per_sku():
    data=dataset(); settings={'learning_enabled':True}
    disabled=dict(sku='BIAS',kind='correction_disabled',state='disabled',when=data['as_of'])
    result=engine.learning_settings_from_log(data,settings,[disabled])
    assert result['learning_disabled_skus']==['BIAS']
    assert not engine.prepare_learning(data,diary_rows(data),result)['items'][0]['_learning_context']['enabled']
    enabled=dict(disabled,kind='correction_enabled',state='enabled')
    assert engine.learning_settings_from_log(data,result,[disabled,enabled])['learning_disabled_skus']==[]


def test_cli_undo_survives_next_invocation_until_explicit_enable(tmp_path,monkeypatch):
    from tests.test_cli import load_cli
    cli=load_cli(); loaded,_=cli._load_modules()
    data=dataset(raw([100*1.01**i for i in range(48)]))
    archive=tmp_path/'diary.jsonl'; log=tmp_path/'learning.jsonl';stock=tmp_path/'stock.csv';stock.write_text('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nA,Synthetic,ea,0,14,3,3,3\n')
    learning.append_jsonl(archive,diary_rows(data,120))
    def load_csv(path, receipts, *, max_bytes):
        assert path == str(stock) and receipts is None
        assert max_bytes == cli._parser().get_default('max_bytes')
        return copy.deepcopy(data)
    monkeypatch.setattr(cli,'_load_modules',lambda:(loaded,SimpleNamespace(load_csv=load_csv)))
    args=[str(stock),'--learn','--forecast-diary',str(archive),'--learning-log',str(log),'--today','2026-11-12']
    assert cli.main(args)==0
    assert cli.main(args+['--no-correction','BIAS'])==0
    assert cli.main(args)==0
    settings=loaded.learning_settings_from_log(data,{'learning_enabled':True},learning.read_jsonl(log))
    assert settings['learning_disabled_skus']==['BIAS']
    assert cli.main(args+['--enable-correction','BIAS'])==0
    assert loaded.learning_settings_from_log(data,settings,learning.read_jsonl(log))['learning_disabled_skus']==[]
    assert cli.main(args+['--no-correction','BIAS'])==0
    assert loaded.learning_settings_from_log(data,settings,learning.read_jsonl(log))['learning_disabled_skus']==['BIAS']


def test_owner_decisions_survive_snapshot_until_material_factor_change():
    data=dataset(raw([100]*48)); diary=diary_rows(data,70); settings={'learning_enabled':True}
    proposal=next(p for p in engine.learning_report(data,diary,settings)['pending'] if p['kind']=='bias_correction')
    for action in ('approve','dismiss'):
        decision=engine.learning_decision(data,diary,settings,[],proposal['id'],action)
        newer=dataset(raw([101]*49),'2026-11'); newer_diary=diary_rows(newer,70)
        restored=engine.learning_settings_from_log(newer,settings,decision['events'])
        assert not engine.learning_report(newer,newer_diary,restored,decision['events'])['pending']
        material=diary_rows(newer,50)
        assert any(p['kind']=='bias_correction' for p in engine.learning_report(newer,material,restored,decision['events'])['pending'])
        if action=='approve':
            selection=engine.forecast_selection(engine.prepare_learning(newer,newer_diary,restored)['items'][0],'2026-11')
            assert selection['learning']['reason']=='Approved, not tested'


def test_torn_final_jsonl_is_quarantined_but_midfile_damage_is_refused(tmp_path):
    path=tmp_path/'diary.jsonl'; good=b'{"id":"keep"}\n';torn=b'{"id":"torn\xe2\x82'
    path.write_bytes(good+torn)
    with pytest.warns(RuntimeWarning,match='quarantined'):
        assert learning.read_jsonl(path)==[{'id':'keep'}]
    assert path.read_bytes()==good
    assert path.with_name(path.name+'.quarantine').read_bytes()==torn
    assert learning.append_jsonl(path,[{'id':'next'}])==1
    assert learning.read_jsonl(path)==[{'id':'keep'},{'id':'next'}]
    bad=good+b'{torn\n'+b'{"id":"later"}\n';path.write_bytes(bad)
    with pytest.raises(ValueError):learning.append_jsonl(path,[{'id':'never'}])
    assert path.read_bytes()==bad


def test_jsonl_appends_lock_sync_and_separate_unterminated_valid_row(tmp_path,monkeypatch):
    import fcntl
    import os
    path=tmp_path/'log.jsonl';path.write_text('{"id":"keep"}')
    locks=[];syncs=[]; flock=fcntl.flock;fsync=os.fsync
    def locked(fd,mode):locks.append(mode);return flock(fd,mode)
    def synced(fd):syncs.append(fd);return fsync(fd)
    monkeypatch.setattr(fcntl,'flock',locked);monkeypatch.setattr(os,'fsync',synced)
    assert learning.append_jsonl(path,[{'id':'next'}])==1
    assert fcntl.LOCK_EX in locks and syncs
    assert learning.read_jsonl(path)==[{'id':'keep'},{'id':'next'}]


def test_concurrent_jsonl_appends_deduplicate_under_file_lock(tmp_path):
    import subprocess
    import sys
    path=tmp_path/'concurrent.jsonl'
    script='import learning,sys; learning.append_jsonl(sys.argv[1],[dict(id=str(i),value=i) for i in range(80)])'
    workers=[subprocess.Popen([sys.executable,'-c',script,str(path)]) for _ in range(8)]
    assert all(worker.wait(timeout=20)==0 for worker in workers)
    assert len(learning.read_jsonl(path))==80


@pytest.mark.parametrize('shift',[.8,.9,1.08,1.12,1.25,1.5])
@pytest.mark.parametrize('seed',range(6))
def test_monthly_simulation_has_no_one_month_apply_withdraw_churn(shift,seed):
    from tests.learning_review_sim import run
    trace,log=run(shift,seed)
    churn=[(a['month'],b['month']) for i,(a,b) in enumerate(zip(trace,trace[1:]))
           if a['state']=='applied' and (i==0 or trace[i-1]['state']!='applied')
           and any(e['sku']=='S1' and e['kind']=='correction_withdrawn' for e in b['events'])]
    assert not churn,(shift,seed,churn)
    assert all(abs(e['factor']-1)<=.15+1e-12 for e in log if 'factor' in e)


def test_hysteresis_keeps_borderline_correction_but_withdraws_clear_failure():
    sales=[100,110]*24
    rows=[dict(month=f'2026-{m:02d}',prediction=100,actual=105,error=5,scale=10) for m in range(5,11)]
    folds=[dict(origin=o,actual=[105]*3,prediction=[100]*3,errors=[5]*3) for o in range(12,20)]
    selected=dict(forecast=[100]*12,folds=folds,method='champion',adopted=False,candidates={})
    item=raw(sales);item['_learning_context']=dict(entries=rows,enabled=True,prior_correction=dict(state='applied',factor=1.1))
    result=learning.bias_correction(item,selected,sales,folds,folds)
    assert result['learning']['state']=='applied' and result['learning']['factor']==1.1
    perfect=[dict(r,prediction=r['actual'],errors=[0]*3) for r in folds]
    failed=learning.bias_correction(item,dict(selected,folds=perfect),sales,perfect,perfect)
    assert failed['learning']['state']=='rejected' and failed['forecast']==selected['forecast']
    item['_learning_context'].pop('prior_correction')
    first=learning.bias_correction(item,selected,sales,folds,folds)
    assert first['learning']['factor']==1.05  # New adoption still uses requested factor.
