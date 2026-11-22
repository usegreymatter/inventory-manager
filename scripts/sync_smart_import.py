#!/usr/bin/env python3
"""Embed the dependency-free workbook reader and shared vocabulary in Desktop core."""
import argparse
import ast
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
START = '// SMART_WORKBOOK_START'
END = '// SMART_WORKBOOK_END'


def generated():
    module = (ROOT / 'desktop/smart-import.js').read_text()
    # Keep a stable blank-line separator independent of authored EOF formatting.
    module = re.sub(r'^export\s+', '', module, flags=re.M).rstrip('\n') + '\n\n'
    vocabulary = json.dumps(json.loads((ROOT / 'smart-import-vocabulary.json').read_text()), ensure_ascii=True, separators=(',', ':'))
    price_aliases = json.dumps(json.loads(vocabulary)['sale_price'])
    return f'''{START}
// Add import-only metadata here so every protected forecasting byte stays frozen.
ERP_ALIASES.sale_price = {price_aliases}
ERP_ALIASES.sale_price.forEach((name,rank) => ERP_LOOKUP.set(name, ['sale_price',rank]))
if (!IMPORT_PER_ITEM.includes('sale_price')) IMPORT_PER_ITEM.push('sale_price')
const SMART_WORKBOOK = (() => {{
{module}
const vocabulary = {vocabulary}
const aliases = Object.fromEntries([...new Set([...Object.keys(ERP_ALIASES),...Object.keys(vocabulary)])].map(field=>[field,[...(ERP_ALIASES[field]||[]),...(vocabulary[field]||[])]]))
return {{readWorkbook,contributorMetadata,reviewField:source=>Object.entries(REVIEW_ALIASES).find(([,labels])=>labels.includes(key(source)))?.[0]||null,understandWorkbook:(sheets,sheet=null,overrides=null)=>understandWorkbook(sheets,sheet,overrides,aliases,PRODUCT_TYPE_ALIASES)}}
}})()
export async function readSmartWorkbook(file) {{
  try {{
    if(file.size>20*1024*1024)throw new CsvError('File must be no larger than 20 MiB.')
    return await SMART_WORKBOOK.readWorkbook(await file.arrayBuffer(),file.name)
  }} catch(error) {{throw error instanceof CsvError?error:new CsvError(error.message||'Could not read this workbook.')}}
}}
export function understandStockWorkbook(sheets,sheet=null,overrides=null) {{
  try {{return SMART_WORKBOOK.understandWorkbook(sheets,sheet,overrides)}}
  catch(error) {{throw error instanceof CsvError?error:new CsvError(error.message||'Could not understand this workbook.')}}
}}
{END}
'''


def _literal(path, name):
    """Read shared import metadata without importing the application package."""
    nodes = [node.value for node in ast.parse(path.read_text()).body
             if isinstance(node, ast.Assign)
             and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    if len(nodes) != 1:
        raise SystemExit(f'{name} source assignment is ambiguous.')
    return ast.literal_eval(nodes[0])


def synchronized_source(source):
    """Return the complete importer mirror, without writing its target."""
    block = generated()
    if START in source:
        if source.count(START) != 1 or source.count(END) != 1:
            raise SystemExit('Workbook sync markers are ambiguous.')
        old = source[source.index(START):source.index(END)+len(END)]
        updated = source.replace(old, block.rstrip('\n'), 1)
    else:
        anchor = 'export async function readStockFile(file) {'
        if source.count(anchor) != 1:
            raise SystemExit('readStockFile anchor changed.')
        updated = source.replace(anchor, block + anchor, 1)
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = ROOT / 'desktop/plugin.js'
    source = target.read_text()
    updated = synchronized_source(source)
    if args.check:
        if updated != source:
            raise SystemExit('Smart workbook core or import metadata is stale. Run scripts/sync_smart_import.py.')
        print('Smart workbook core, vocabulary and import metadata are in sync.')
    else:
        target.write_text(updated)
        print('Synced smart workbook core, vocabulary and import metadata.')


if __name__ == '__main__':
    main()
