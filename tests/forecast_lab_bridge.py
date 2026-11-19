"""Offline stdlib-only JSON batch oracle for the frozen forecast laboratory."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import forecast_lab as lab

ALLOWED = {'forecast', 'eligible', 'backtest', 'clean_demand', 'analyze', 'analyze_sku', 'safety_stock', 'pattern', 'quantile'}


def decode(value):
    if isinstance(value, dict):
        if set(value) == {'__float__'}:
            return float(value['__float__'])
        return {key: decode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [decode(item) for item in value]
    return value


def run(operation):
    try:
        name = operation['op']
        if name not in ALLOWED:
            raise ValueError('Unknown operation')
        result = getattr(lab, name)(*decode(operation.get('args', [])), **decode(operation.get('options', {})))
        return {'result': result}
    except Exception as exc:
        return {'error': {'type': type(exc).__name__, 'message': str(exc)}}


def main():
    try:
        payload = json.load(sys.stdin)
        operations = payload if isinstance(payload, list) else payload['operations']
        if not isinstance(operations, list):
            raise ValueError('Operations must be a list')
        result = [run(operation) for operation in operations]
    except Exception as exc:
        result = {'error': {'type': type(exc).__name__, 'message': str(exc)}}
    json.dump(result, sys.stdout, allow_nan=False, separators=(',', ':'))
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
