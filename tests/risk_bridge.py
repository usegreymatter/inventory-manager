"""JSON oracle for the exact, complete Python/JavaScript risk API contract."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from risk import prediction_bands, simulate_risk


def evaluate(case):
    try:
        if case['api'] == 'bands':
            return prediction_bands(*case['args'])
        return simulate_risk(*case['args'])
    except (ValueError, TypeError, OverflowError):
        return {'error': 'invalid-input'}


if __name__ == '__main__':
    json.dump([evaluate(case) for case in json.load(sys.stdin)], sys.stdout, allow_nan=False)
