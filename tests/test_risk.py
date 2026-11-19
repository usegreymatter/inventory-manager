"""Offline display-risk contracts; generated process check is NOT a holdout."""
import copy
import sys
import unittest
from pathlib import Path
from datetime import date, timedelta
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # run from tests/ like sibling suites
import forecast_lab as lab
import risk


def spec(**patches) -> dict:
    return dict(dict(sku='RISK-1', as_of='2026-10', today='2026-11-01',
                     history=[30]*24, forecast=[30, 31, 31, 28, 31, 30],
                     on_hand=0, on_order=0, order_by='2026-11-01', lead_days=10,
                     cover_months=1, quantity=31, lead_multipliers=[1]), **patches)


class Bands(unittest.TestCase):
    def test_zero_variance_and_unchanged_predictions(self):
        ps = [12.123456789, 12, 12]
        before = ps[:]
        result = risk.prediction_bands([12]*24, ps)
        self.assertEqual(result['samples'], 21)
        self.assertFalse(result['thin_history'])
        self.assertEqual([b['p50'] for b in result['bands']], ps)
        for b in result['bands']:
            self.assertLessEqual(b['lo90'], b['lo50'])
            self.assertLessEqual(b['lo50'], b['p50'])
            self.assertLessEqual(b['p50'], b['hi50'])
            self.assertLessEqual(b['hi50'], b['hi90'])
        self.assertEqual(ps, before)
        self.assertEqual(result['bands'][1], dict(p50=12, lo50=12, hi50=12, lo90=12, hi90=12))

    def test_thin_width_and_nested_sqrt_horizon(self):
        result = risk.prediction_bands([10]*3, [10]*4)
        self.assertEqual(result['samples'], 0)
        self.assertTrue(result['thin_history'])
        self.assertEqual(result['bands'][0], dict(p50=10, lo50=5, hi50=15, lo90=0, hi90=25))
        self.assertEqual(result['bands'][3]['hi50'], 20)
        for b in result['bands']:
            self.assertLessEqual(b['lo90'], b['lo50'])
            self.assertLessEqual(b['lo50'], b['p50'])
            self.assertLessEqual(b['p50'], b['hi50'])
            self.assertLessEqual(b['hi50'], b['hi90'])
        self.assertTrue(risk.prediction_bands([1]*10, [1])['thin_history'])
        self.assertFalse(risk.prediction_bands([1]*11, [1])['thin_history'])

    def test_own_origins_only_use_prefix(self):
        original = lab.forecast
        seen = []
        def spy(values, horizon, method):
            seen.append(values[:])
            return original(values, horizon, method)
        with patch.object(risk.lab, 'forecast', spy):
            result = risk.prediction_bands(list(range(100)), [1])
        self.assertEqual(result['samples'], 60)
        self.assertEqual([len(p) for p in seen], list(range(40, 100)))
        self.assertEqual(seen[-1][-1], 98)

    def test_frozen_method_is_used(self):
        history = [10+i*2 for i in range(36)]
        self.assertNotEqual(risk.prediction_bands(history, [80], 'flat'),
                            risk.prediction_bands(history, [80], 'holt_damped'))
        self.assertEqual(risk.prediction_bands(history, [80], 'flat'),
                         risk.prediction_bands(history, [80], 'baseline'))
        self.assertTrue(risk.prediction_bands([1]*24, [1], 'seasonal')['thin_history'])

    def test_known_process_coverage_2000_histories(self):
        # Prespecified stationary iid uniform demand, independent future draw.
        # This is an implementation sanity check, NOT real-sales calibration.
        state, hits50, hits90 = 0x12345678, 0, 0
        for _ in range(2000):
            draws = []
            for _ in range(64):
                state = risk._next(state)
                draws.append(100 + 40*(state/4294967296-.5))
            history, actual = draws[:-1], draws[-1]
            center = lab.forecast(history)[0]
            b = risk.prediction_bands(history, [center])['bands'][0]
            hits50 += b['lo50'] <= actual <= b['hi50']
            hits90 += b['lo90'] <= actual <= b['hi90']
        coverage = (hits50/2000, hits90/2000)
        print('synthetic 2000-history coverage (50%,90%):', coverage)
        self.assertLessEqual(abs(coverage[0]-.5), .1)
        self.assertLessEqual(abs(coverage[1]-.9), .1)


class Simulation(unittest.TestCase):
    def test_deterministic_zero_variance_lost_sales_floor(self):
        value = risk.simulate_risk(spec())
        self.assertEqual(value['before'], 1)
        self.assertEqual(value['after'], 0)
        self.assertEqual(value['paths'], 1000)
        self.assertEqual(value, risk.simulate_risk(spec()))
        self.assertFalse(value['thin_history'])
        self.assertEqual(risk.simulate_risk(spec(), 0)['after'], 1)
        self.assertEqual(risk.simulate_risk(spec(on_hand=1e12))['before'], 0)

    def test_receipts_do_not_double_count_on_order(self):
        scheduled = spec(on_hand=10, on_order=100, quantity=0,
                         receipts=[dict(date='2026-11-11', quantity=5)])
        self.assertEqual(risk.simulate_risk(scheduled)['after'], 1)
        self.assertEqual(risk.simulate_risk(spec(on_hand=10, on_order=100, quantity=0))['after'], 0)
        self.assertEqual(risk.simulate_risk(spec(on_hand=10, on_order=100, quantity=0, receipts=[]))['after'], 1)

    def test_receipt_boundary_and_past_receipts(self):
        self.assertEqual(risk.simulate_risk(spec(on_hand=5, quantity=100,
            receipts=[dict(date='2026-11-06', quantity=100)]))['before'], 0)
        self.assertEqual(risk.simulate_risk(spec(on_hand=4.9, quantity=100,
            receipts=[dict(date='2026-11-06', quantity=100)]))['before'], 1)
        self.assertEqual(risk.simulate_risk(spec(receipts=[dict(date='2026-10-31', quantity=1000)]))['before'], 1)
        self.assertEqual(risk.simulate_risk(spec(receipts=[dict(date='2026-11-01', quantity=1000)]))['before'], 0)

    def test_order_date_not_today_controls_arrival(self):
        immediate = spec(on_hand=15, quantity=1000)
        self.assertEqual(risk.simulate_risk(immediate)['before'], 0)
        immediate['order_by'] = '2026-11-20'
        self.assertEqual(risk.simulate_risk(immediate)['before'], 1)
        immediate['order_by'] = '2026-10-01'
        self.assertEqual(risk.simulate_risk(immediate)['before'], 0)

    def test_calendar_leap_and_partial_cover(self):
        s = spec(as_of='2028-01', today='2028-02-01', order_by='2028-02-01',
                 forecast=[29,31], history=[29]*12, lead_days=0, quantity=30)
        self.assertEqual(risk.simulate_risk(s)['after'], 0)
        s['quantity'] = 29.99
        self.assertEqual(risk.simulate_risk(s)['after'], 1)
        s.update(quantity=15, cover_months=.5)
        self.assertEqual(risk.simulate_risk(s)['after'], 0)
        s.update(quantity=0, cover_months=0)
        self.assertEqual(risk.simulate_risk(s)['after'], 0)
        self.assertEqual(risk._cover_end(date(2028,1,31), 1), date(2028,3,1).toordinal())

    def test_pairing_monotonicity_and_immutable_inputs(self):
        s = spec(history=[0,20,80,0,5,60]*4, forecast=[30]*12, quantity=50,
                 lead_multipliers=risk.DEFAULT_LEADS)
        original = copy.deepcopy(s)
        values = [risk.simulate_risk(s, mult) for mult in [0,.5,1,2,10]]
        self.assertEqual(s, original)
        self.assertEqual(len({v['seed'] for v in values}), 1)
        self.assertEqual(len({v['before'] for v in values}), 1)
        self.assertEqual([v['after'] for v in values], sorted([v['after'] for v in values], reverse=True))
        self.assertNotEqual(values[2]['seed'], risk.simulate_risk(dict(s, sku='RISK-2'))['seed'])

    def test_empty_zero_and_thin_histories(self):
        for history in [[], [0]*12, [30]*3]:
            value = risk.simulate_risk(spec(history=history))
            self.assertEqual((value['before'], value['after']), (1,0))
            self.assertEqual(value['thin_history'], len(history)<8)
        self.assertEqual(risk.simulate_risk(spec(forecast=[0], quantity=0))['after'], 0)

    def test_event_integration_against_independent_daily_reference(self):
        # No bootstrap/lead noise: a per-day oracle verifies event timing/lost sales.
        for qty in [0,3,20,100]:
            s = spec(today='2026-11-17', order_by='2026-11-20', lead_days=20,
                     on_hand=5, quantity=qty, cover_months=1,
                     receipts=[dict(date='2026-11-22',quantity=15),dict(date='2026-12-20',quantity=4)])
            arrival, end = date(2026,12,10), date(2027,1,9)
            cursor, left, before, after = date(2026,11,17), 5, False, False
            supplies = {date(2026,11,22):15, date(2026,12,20):4, arrival:qty}
            while cursor < end:
                left += supplies.get(cursor, 0)
                if left < 1-1e-12:
                    before |= cursor < arrival
                    after |= cursor >= arrival
                left = max(0, left-1)
                cursor += timedelta(days=1)
            got = risk.simulate_risk(s)
            self.assertEqual((got['before'],got['after']), (float(before),float(after)))

    def test_30_day_cover_matches_perfect_forecast_suggested_supply(self):
        s = spec(on_hand=0, forecast=[30,31,31], history=[30]*24,
                 lead_days=30, cover_months=2, quantity=61)
        self.assertEqual(risk.simulate_risk(s)['after'], 0)

    def test_completed_supplier_lead_evidence(self):
        sample = spec(lead_days=10, on_hand=3)
        sample.pop('lead_multipliers', None)
        history = [dict(ordered_date='2026-09-01', received_date='2026-09-21')]*5
        self.assertEqual(risk.simulate_risk(dict(sample, receipt_history=history)),
                         risk.simulate_risk(dict(sample, lead_multipliers=[2]*5)))
        self.assertEqual(risk.simulate_risk(dict(sample, receipt_history=history[:4])),
                         risk.simulate_risk(sample))
        future = [dict(ordered_date='2026-11-01', received_date='2026-11-21')]*5
        self.assertEqual(risk.simulate_risk(dict(sample, receipt_history=future)),
                         risk.simulate_risk(sample))

    def test_prng_vectors_and_unicode_seed(self):
        state, actual = 1, []
        for _ in range(5):
            state = risk._next(state)
            actual.append(state)
        self.assertEqual(actual, [270369, 67634689, 2647435461, 307599695, 2398689233])
        self.assertEqual(risk._seed('PARITY', '2026-10'), 35072368)
        self.assertEqual(risk._seed('المخزن-😀', '2026-10'), 1280585968)

    def test_length_three_circular_blocks_and_mean_scaling(self):
        # Every 3-month circular block contains one spike, not iid monthly draws.
        for current_mean in [30, 60]:
            s = spec(as_of='2028-01',today='2028-02-01',order_by='2028-02-01',history=[0,0,90], forecast=[current_mean]*3, lead_days=0,
                     cover_months=3, quantity=current_mean*3)
            self.assertEqual(risk.simulate_risk(s)['after'], 0)
            s['quantity'] -= .01
            self.assertEqual(risk.simulate_risk(s)['after'], 1)

    def test_invalid_inputs_fail_closed(self):
        for field, value in [('forecast',[]), ('today','2026-02-30'), ('today','2026-10-31'),
                ('as_of','2026-13'), ('quantity',True), ('lead_days',float('nan')),
                ('cover_months',-1), ('receipts',None), ('lead_multipliers',[]),
                ('lead_multipliers',[11]), ('history',[float('inf')])]:
            with self.subTest(field=field, value=value), self.assertRaises((ValueError, TypeError)):
                risk.simulate_risk(spec(**{field:value}))
        for args in [([1],[1],'unknown'), ([1],[1],'similar'), ([True],[1]), ([1],[-1])]:
            with self.assertRaises(ValueError):
                risk.prediction_bands(*args)


if __name__ == '__main__':
    unittest.main()
