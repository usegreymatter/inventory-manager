"""Hand-calculated scale-free selection metrics."""
import math
import pytest
import forecast_lab as lab


def test_fixed_number_scaled_metrics_and_pinball():
    # Training [1,3,5]: naive |d| scale=2, squared d scale=4.
    # Actual [7,9], predictions [6,11], errors [1,-2].
    # MASE=(1+2)/2/2=.75; RMSSE=sqrt((1+4)/2/4)=sqrt(.625).
    # CFE=-1; inventory=-CFE=1. One origin's PIS=-1 (first error).
    # Point pinball: q=.5 => (.5+1)/2/2=.375;
    # q=.8 => (.8+.4)/2/2=.3; q=.95 => (.95+.1)/2/2=.2625.
    folds=[dict(origin=3,actual=[7,9],prediction=[6,11],errors=[1,-2])]
    r=lab.score_folds([1,3,5,7,9],folds)
    assert r['mase'] == .75
    assert r['rmsse'] == pytest.approx(math.sqrt(.625))
    assert r['cfe'] == -1 and r['pis'] == -1
    assert r['scaled_pinball']['0.5'] == .375
    assert r['scaled_pinball']['0.8'] == pytest.approx(.3)
    assert r['scaled_pinball']['0.95'] == pytest.approx(.2625)
    assert r['coverage']['0.95']['samples'] == 0


def test_scales_use_training_only_and_scale_invariance():
    ys=[1,3,5,7,9]
    f=[dict(origin=3,actual=[7,9],prediction=[6,11],errors=[1,-2])]
    a=lab.score_folds(ys,f)
    b=lab.score_folds([x*100 for x in ys],[dict(origin=3,actual=[700,900],prediction=[600,1100],errors=[100,-200])])
    for k in ('mase','rmsse','scaled_cfe','scaled_pis','scaled_pinball'):
        assert a[k] == b[k]
    assert lab.score_folds([1,3,5,999,888],f)['mase'] == a['mase']
    # Degenerate constant scale: do not turn it into a unit-dependent epsilon.
    assert lab.score_folds([2]*5,f)['mase'] is None


def test_adoption_gate_checks_error_bias_and_coverage():
    baseline=dict(mase=1,rmsse=1,scaled_cfe=2)
    candidate=dict(mase=.9,rmsse=.9,scaled_cfe=1,coverage={'0.8':{'rate':.8,'samples':5}})
    assert lab.adoption_gate(candidate,baseline)
    assert not lab.adoption_gate({**candidate,'mase':.91},baseline)
    assert not lab.adoption_gate({**candidate,'rmsse':1.01},baseline)
    assert not lab.adoption_gate({**candidate,'scaled_cfe':3},baseline)
    assert not lab.adoption_gate({**candidate,'coverage':{'0.8':{'rate':.5,'samples':5}}},baseline)
    assert not lab.adoption_gate({**candidate,'coverage':{'0.8':{'rate':None,'samples':0}}},baseline)
