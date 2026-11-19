#!/usr/bin/env python3
"""Convert an explicitly selected canonical CSV directory to browser bridge JSON.

Stdlib only; writes JSON to stdout, never changes source files. Redirect to a new
local .json file and choose that file in Desktop or standalone's existing picker.
"""
import argparse
import json
from stock_runway import _load_modules


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('--today', required=True, help='local business date YYYY-MM-DD')
    args = parser.parse_args()
    _, sources = _load_modules()
    try:
        data = sources.load_bundle(args.directory, today=args.today)
        print(json.dumps(data, ensure_ascii=False, allow_nan=False))
    except (sources.SourceError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
