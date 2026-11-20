"""Selection work is per SKU/snapshot, not per public API or shallow clone."""
from collections import Counter
from functools import wraps
import json

import pytest

from tests.test_cli import load_cli
from scripts.bench_scale import synthetic_data, synthetic_diary


@pytest.mark.parametrize('learning', [False, True])
def test_cli_selects_once_per_sku(tmp_path, monkeypatch, capsys, learning):
    cli = load_cli()
    engine, sources = cli._load_modules()
    data = synthetic_data(3)
    stock = tmp_path / 'synthetic.csv'
    stock.write_text('sku,name,unit,on_hand,supplier_days,2025-10,2025-11,2025-12\nA,Synthetic,ea,0,14,3,3,3\n')
    def load_csv(path, receipts, *, max_bytes):
        assert path == str(stock) and receipts is None
        assert max_bytes == sources.MAX_CSV_BYTES
        return data

    monkeypatch.setattr(sources, 'load_csv', load_csv)
    calls = Counter()
    original = engine.forecast_selection.__wrapped__

    @wraps(original)
    def counted(item, last, *args):
        calls[item['sku']] += 1
        return original(item, last, *args)

    monkeypatch.setattr(engine, 'forecast_selection', engine._memo_history(counted))
    args = [str(stock), '--all', '--today', '2026-01-01']
    if learning:
        diary = tmp_path / 'diary.jsonl'
        diary.write_text(''.join(json.dumps(r) + '\n' for r in synthetic_diary(data)))
        args += ['--forecast-diary', str(diary), '--learn']
    assert cli.main(args) == 0
    assert calls == Counter({item['sku']: 1 for item in data['items']})
    assert engine._EVALUATION.get() is None
    assert len(capsys.readouterr().out.splitlines()) == 4


def test_demand_keys_reuse_clones_but_invalidate_changed_learning_and_inputs():
    cli = load_cli()
    engine, _ = cli._load_modules()
    item = synthetic_data(1)['items'][0]

    @engine.evaluation_pass
    def check():
        first = engine.forecast_selection(item, '2025-12')
        assert engine.forecast_selection({**item, 'on_hand': 900}, '2025-12') is first
        manual = {**item, 'demand_change_pct': 15}
        assert engine.forecast_selection(manual, '2025-12') is not first
        learned = {**item, '_learning_context': {'enabled': False}}
        second = engine.forecast_selection(learned, '2025-12')
        learned['_learning_context']['enabled'] = True
        assert engine.forecast_selection(learned, '2025-12') is not second
        changed = {**item, 'monthly_sales': [*item['monthly_sales'][:-1], 10000]}
        assert engine.forecast_selection(changed, '2025-12') is not first
        assert engine.forecast_selection({**item, 'external_forecasts': None}, '2025-12') is not first
        return first

    assert check() is not check()
    assert engine._EVALUATION.get() is None


def test_failed_shared_pass_releases_memo():
    cli = load_cli()
    engine, _ = cli._load_modules()

    @engine.evaluation_pass
    def fail():
        raise ValueError('probe')

    with pytest.raises(ValueError, match='probe'):
        fail()
    assert engine._EVALUATION.get() is None


@pytest.mark.parametrize('record,field,expected', [
    ({'kind': 'correction_disabled', 'state': 'disabled'}, 'enabled', False),
    ({'kind': 'owner_decision', 'state': 'approved', 'proposal_kind': 'bias_correction',
      'proposal_id': 'p', 'factor': 1.15, 'requested_factor': 1.3, 'before': [100], 'after': [115]},
     'approved_bias', {'requested_factor': 1.3}),
    ({'kind': 'bias_correction', 'state': 'applied', 'factor': 1.1},
     'prior_correction', {'factor': 1.1}),
])
def test_shared_memo_invalidates_log_replayed_learning_inputs(record, field, expected):
    cli = load_cli()
    engine, _ = cli._load_modules()
    data = synthetic_data(1)
    diary, settings, log = synthetic_diary(data), {'learning_enabled': True}, []

    @engine.evaluation_pass
    def check():
        def item():
            restored = engine.learning_settings_from_log(data, settings, log)
            return engine.prepare_learning(data, diary, restored)['items'][0]
        first = engine.forecast_selection(item(), '2025-12')
        assert engine.forecast_selection(item(), '2025-12') is first
        log.append(dict(sku=data['items'][0]['sku'], when='2025-11-30', **record))
        learned = item()
        value = learned['_learning_context'][field]
        if isinstance(expected, dict):
            assert all(value[k] == v for k, v in expected.items())
        else:
            assert value is expected
        assert engine.forecast_selection(learned, '2025-12') is not first
    check()
    assert engine._EVALUATION.get() is None
