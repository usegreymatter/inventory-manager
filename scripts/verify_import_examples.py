#!/usr/bin/env python3
"""Offline proof: every ERP example keeps its pre-import-change item records."""
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import subprocess
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from baseline import read_baseline


def historical(path, revision):
    return read_baseline(f'{revision}:{path}')


def verify(revision='af2b1c7'):
    package = types.ModuleType('import_example_proof')
    package.__path__ = [str(ROOT)]
    sys.modules[package.__name__] = package
    current = importlib.import_module(package.__name__ + '.sources')
    # Policy v2 changed the current engine separately from import. Load the
    # historical parser AND its engine in an isolated package, not current math.
    baseline = types.ModuleType('import_example_baseline')
    baseline.__path__ = [str(ROOT)]
    sys.modules[baseline.__name__] = baseline
    for name in ('engine', 'sources'):
        module = types.ModuleType(baseline.__name__ + '.' + name)
        module.__package__ = baseline.__name__
        module.__file__ = f'{revision}:{name}.py'
        sys.modules[module.__name__] = module
        exec(compile(historical(name + '.py', revision), module.__file__, 'exec'), module.__dict__)
    old = sys.modules[baseline.__name__ + '.sources']
    paths = sorted((ROOT / 'docs/erp-examples').glob('*.csv'))
    assert paths, 'No ERP examples found'
    results = []
    for path in paths:
        before = old.load_csv(str(path))
        after = current.load_csv(str(path))
        expected = [dict(item, sale_price=9.99) for item in before['items']] if path.name == 'quickbooks.csv' else before['items']
        # Owner-approved additive field only; every historical quantity stays exact.
        assert expected == after['items'], path.name
        assert before['months'] == after['months'], path.name
        assert before['as_of'] == after['as_of'], path.name
        results.append({'file': str(path.relative_to(ROOT)), 'items': len(after['items']),
                        'items_sha256': hashlib.sha256(json.dumps(after['items'], sort_keys=True,
                            ensure_ascii=False).encode()).hexdigest()})
    return {'status': 'PASS', 'baseline': revision, 'files': len(results),
            'item_records': sum(row['items'] for row in results), 'results': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', default='af2b1c7')
    args = parser.parse_args()
    print(json.dumps(verify(args.baseline), indent=2))


if __name__ == '__main__':
    main()
