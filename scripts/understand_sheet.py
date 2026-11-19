#!/usr/bin/env python3
"""Inspect a local XLSX/CSV, suggest mappings, and validate with existing preflight.

Standard library only. No forecast/order math, network, ERP calls, or implicit writes.
"""
from __future__ import annotations

import argparse
import csv
import importlib
import io
import json
from pathlib import Path
import re
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
# The checkout name may contain hyphens; do not import the plugin __init__ (Hermes).
PACKAGE = '_stock_sheet_cli'
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE, package)
core = importlib.import_module(PACKAGE + '.smart_import')
csv_import = importlib.import_module(PACKAGE + '.csv_import')
sources = importlib.import_module(PACKAGE + '.sources')
MAPPING_LIMIT = 2 * 1024 * 1024
MONTH = re.compile(r'(?:rcv:)?[1-9][0-9]{3}-(?:0[1-9]|1[0-2])\Z')


def canonical_text(rows):
    """Serialize the core proposal without changing identifiers or quantities."""
    output = io.StringIO(newline='')
    csv.writer(output, lineterminator='\n').writerows(rows)
    return output.getvalue()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Mapping JSON has duplicate keys; keep each key unique.')
        result[key] = value
    return result


def check_override(key, field, analyses):
    if not isinstance(key, str) or ':' not in key:
        raise ValueError('Mapping keys must use exact SheetName:zero-based-column-index.')
    name, index = key.rsplit(':', 1)
    if name not in analyses or not re.fullmatch(r'0|[1-9][0-9]{0,4}', index) or int(index) >= len(analyses[name]['mapping']):
        raise ValueError('Mapping refers to an unknown sheet or column: ' + key)
    allowed = set(sources.ERP_ALIASES) | set(core.FIXED) | set(core.OPTIONAL) | {'date', 'quantity', ''}
    if not isinstance(field, str) or field not in allowed and not MONTH.fullmatch(field):
        raise ValueError('Unknown mapping target for ' + key + '; use a canonical field, YYYY-MM, rcv:YYYY-MM, or an empty string to ignore.')


def read_mapping(path, report):
    path = Path(path).expanduser()
    if path.stat().st_size > MAPPING_LIMIT:
        raise ValueError('Mapping file must be no larger than 2 MiB.')
    with path.open('rb') as handle:
        raw = handle.read(MAPPING_LIMIT + 1)
    if len(raw) > MAPPING_LIMIT:
        raise ValueError('Mapping file must be no larger than 2 MiB.')
    try:
        data = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=unique_object)
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError('Could not read mapping JSON; save a UTF-8 JSON object.') from None
    if not isinstance(data, dict):
        raise ValueError('Mapping must be a JSON object.')
    analyses = {sheet['name']: sheet for sheet in report['sheets']}
    if 'mapping_version' not in data:
        overrides = data
    else:
        root_keys = {'mapping_version', 'connector', 'description', 'timezone', 'currency', 'secrets', 'streams', 'unit_conversions'}
        if set(data) - root_keys or data['mapping_version'] != '1' or not isinstance(data.get('connector'), str) or not re.fullmatch(r'[a-z0-9_-]{1,40}', data['connector']):
            raise ValueError('Unsupported mapping envelope; expected mapping_version "1" and a connector name.')
        # Conversion references and secrets belong to connectors, never this local CLI.
        if data.get('unit_conversions') or data.get('secrets'):
            raise ValueError('Mapping secrets and unit conversions are not supported by this local CLI.')
        streams = data.get('streams')
        if not isinstance(streams, dict) or len(streams) > 10:
            raise ValueError('Mapping streams must be an object with at most 10 sheets.')
        overrides = {}
        for stream_name, stream in streams.items():
            if not isinstance(stream, dict) or set(stream) - {'source', 'fields', 'verified'}:
                raise ValueError('Mapping streams support only source, fields and verified; filters/cursors are not executed.')
            name = stream.get('source', stream_name)
            if not isinstance(name, str) or name not in analyses or len(name) > 120:
                raise ValueError('Mapping source must name an exact worksheet (up to 120 characters).')
            fields = stream.get('fields')
            if not isinstance(fields, dict) or len(fields) > 40:
                raise ValueError('Mapping fields must be an object with at most 40 fields per sheet.')
            for field, source in fields.items():
                if isinstance(source, dict):
                    if set(source) != {'from'}:
                        raise ValueError('Mapping supports only {"from": source}; transforms/constants/defaults are not executed.')
                    source = source['from']
                if not isinstance(source, str) or len(source) > 120:
                    raise ValueError('Mapping source fields must be strings up to 120 characters.')
                if source.startswith('column:'):
                    index = source[7:]
                else:
                    matches = [str(m['index']) for m in analyses[name]['mapping'] if m['source'] == source]
                    if len(matches) != 1:
                        raise ValueError('Mapping header is missing or ambiguous; use column:N: ' + source)
                    index = matches[0]
                key = name + ':' + index
                if key in overrides:
                    raise ValueError('Mapping assigns more than one target to ' + key)
                overrides[key] = field
    for key, field in overrides.items():
        check_override(key, field, analyses)
    # Redundant overrides flatten header scores in the core, allowing a data row
    # containing an alias (e.g. "units") to outrank the real header. Preserve the
    # original detection when a reviewed rule already agrees with it.
    detected = {sheet['name'] + ':' + str(entry['index']): entry['field'] or ''
                for sheet in report['sheets'] for entry in sheet['mapping']}
    return {key: field for key, field in overrides.items() if not field or field != detected[key]}


def mapping_document(report):
    """Emit the supported subset of connect-design's mapping.schema.json."""
    if len(report['sheets']) > 10:
        raise ValueError('Mapping export supports at most 10 sheets (schema limit); inspection is still available.')
    streams = {}
    for sheet in report['sheets']:
        if len(sheet['name']) > 120:
            raise ValueError('Mapping export requires sheet names no longer than 120 characters.')
        fields = {}
        for entry in sheet['mapping']:
            field = entry['field']
            if not field:
                continue
            if field in fields:
                raise ValueError('Mapping export cannot represent duplicate targets in one sheet; use raw SheetName:index overrides for duplicate month columns.')
            fields[field] = {'from': 'column:' + str(entry['index'])}
        if len(fields) > 40:
            raise ValueError('Mapping export supports at most 40 mapped fields per sheet (schema limit); inspection is still available.')
        streams[sheet['name']] = {'source': sheet['name'], 'fields': fields, 'verified': False}
    return {'mapping_version': '1', 'connector': 'spreadsheet',
            'description': 'Review required. Per-sheet canonical fields use zero-based column:N references. Recheck headers and layout before reuse; not a verified live connector mapping.',
            'streams': streams}


def output_paths(args):
    """Never overwrite inputs, existing files, or another requested output."""
    targets = {}
    inputs = [Path(args.path).expanduser().resolve()]
    if args.mapping:
        inputs.append(Path(args.mapping).expanduser().resolve())
    for key, value in (('mapping', args.mapping_out), ('csv', args.to_csv)):
        if not value:
            continue
        path = Path(value).expanduser().resolve()
        if path in inputs or path in targets.values() or path.exists() or path.is_symlink():
            raise ValueError('Output paths must be distinct new files; refusing to overwrite: ' + str(path))
        if not path.parent.is_dir():
            raise ValueError('Output folder does not exist: ' + str(path.parent))
        targets[key] = path
    return targets


def print_report(report):
    print('Sheet: ' + report['sheet_used'])
    print('Header row: ' + str(report['header_row']))
    print('Layout: ' + report['layout'])
    for sheet in report['sheets']:
        print('\nDetected columns — ' + sheet['name'] + ' (header row ' + str(sheet['header_row']) + '):')
        for entry in sheet['mapping']:
            print('  [{index}] {source} -> {field} [{confidence}] — {reason}'.format(**{**entry, 'field': entry['field'] or '(ignored)'}))
    print('\nReview required: suggestions are not proof of the meaning of arbitrary input.')
    if report['missing']:
        print('Missing: ' + ', '.join(report['missing']))
    validation = report['validation']
    print('Validation: ' + ('passed' if validation['ok'] else 'failed — ' + validation['error']))
    preflight = validation.get('import_report') or {}
    if preflight:
        print('Products ready: ' + str(preflight['products_ready']))
        print('Rows set aside: ' + str(len(preflight['rows_set_aside'])))
        for row in preflight['rows_set_aside']:
            print('  Canonical CSV row {row}: {reason}'.format(**row))
    for warning in report['warnings'] + preflight.get('warnings', []):
        print('Warning: ' + warning)
    for kind, path in report['outputs'].items():
        print('Wrote ' + kind + ': ' + path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', metavar='<xlsx|csv>', help='explicit local .xlsx or .csv file')
    parser.add_argument('--sheet', help='exact base worksheet name; other sheets may still join by SKU')
    parser.add_argument('--json', action='store_true', help='one JSON report on stdout, including errors')
    parser.add_argument('--mapping', help='reviewed mapping JSON or raw SheetName:index override object')
    parser.add_argument('--mapping-out', help='write a suggested mapping to a NEW JSON file')
    parser.add_argument('--to-csv', help='write the canonical proposal to a NEW CSV if preflight has no set-aside rows')
    args = parser.parse_args(argv)
    report = {}
    error = None
    try:
        targets = output_paths(args)
        path = Path(args.path).expanduser()
        if path.suffix.lower() not in ('.xlsx', '.csv', '.xls', '.xlsb'):
            raise ValueError('Choose a local .xlsx or .csv file; other formats are not supported.')
        sheets = core.read_workbook(path)
        report = core.understand_workbook(sheets, args.sheet)
        if args.mapping:
            mapped = core.understand_workbook(sheets, args.sheet, read_mapping(args.mapping, report))
            if [s['header_row'] for s in mapped['sheets']] != [s['header_row'] for s in report['sheets']]:
                raise ValueError('Mapping changed the detected header row; use unambiguous canonical headers and re-export before retrying.')
            report = mapped
        report.update(review_required=True, outputs={})
        text = canonical_text(report['canonical_rows'])
        try:
            validated = csv_import.preflight_csv(text)
            validation = {'ok': not report['missing'], 'import_report': validated['import_report']}
            if report['missing']:
                validation['error'] = 'Still needed: ' + ', '.join(report['missing'])
        except sources.SourceError as failure:
            validation = {'ok': False, 'error': str(failure), 'import_report': getattr(failure, 'import_report', None)}
        report['validation'] = validation
        # Prepare mapping before writes, so representational limits cannot produce a partial CSV.
        mapping = mapping_document(report) if 'mapping' in targets else None
        if mapping is not None:
            with targets['mapping'].open('x', encoding='utf-8', newline='') as handle:
                handle.write(json.dumps(mapping, ensure_ascii=False, indent=2) + '\n')
            report['outputs']['mapping'] = str(targets['mapping'])
        if 'csv' in targets:
            if len(text.encode('utf-8-sig')) > sources.MAX_CSV_BYTES:
                raise ValueError('CSV export exceeds the existing loader limit of 2 MiB; split into smaller files.')
            if not validation['ok'] or validation['import_report']['rows_set_aside'] or any('row omitted' in warning for warning in report['warnings']):
                raise ValueError('CSV export blocked: fix preflight errors and set-aside rows, then review and rerun.')
            # Canonical interchange, not an Excel display export: keep exact source
            # text (including formula-like identifiers), never open it unreviewed.
            with targets['csv'].open('x', encoding='utf-8-sig', newline='') as handle:
                handle.write(text)
            report['outputs']['csv'] = str(targets['csv'])
    except OSError:
        error = 'Could not read or write the local file; check its path, permissions and available space.'
    except (ValueError, csv.Error, RecursionError) as failure:
        error = str(failure) if not isinstance(failure, RecursionError) else 'Mapping JSON is nested too deeply.'
    if error:
        if report is None or 'validation' not in report:
            report = {'error': error, 'review_required': True, 'outputs': {}}
        else:
            report['error'] = error
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        if 'validation' in report:
            print_report(report)
        if error:
            print('Error: ' + error, file=sys.stderr)
    return 2 if error or not report.get('validation', {}).get('ok', False) else 0


if __name__ == '__main__':
    sys.exit(main())
