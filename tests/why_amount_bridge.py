"""Offline Python oracle for the additive explanation text."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine


def run(case):
    raw, settings = case['item'], case.get('settings', {})
    item = {**raw, **engine.forecast(raw, case['months'], case['as_of'], 6, settings, case['today']),
            'on_hand': raw['on_hand'], 'monthly_sales': raw['monthly_sales'], 'as_of': case['as_of']}
    guidance = engine.order_guidance(item, case['today'], settings)
    return {'quantity': guidance.get('quantity'),
            'rows': engine.why_breakdown(item, case['today'], settings),
            'sentence': engine.why_this_amount(item, case['today'], settings)}


if __name__ == '__main__':
    print(json.dumps([run(case) for case in json.load(sys.stdin)], allow_nan=False))
