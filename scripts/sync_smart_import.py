#!/usr/bin/env python3
"""Embed the dependency-free workbook reader and shared vocabulary in Desktop core."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
START = '// SMART_WORKBOOK_START'
END = '// SMART_WORKBOOK_END'


def generated():
    module = (ROOT / 'desktop/smart-import.js').read_text()
    module = re.sub(r'^export\s+', '', module, flags=re.M)
    vocabulary = json.dumps(json.loads((ROOT / 'smart-import-vocabulary.json').read_text()), ensure_ascii=True, separators=(',', ':'))
    return f'''{START}
const SMART_WORKBOOK = (() => {{
{module}
const vocabulary = {vocabulary}
const aliases = Object.fromEntries([...new Set([...Object.keys(ERP_ALIASES),...Object.keys(vocabulary)])].map(field=>[field,[...(ERP_ALIASES[field]||[]),...(vocabulary[field]||[])]]))
return {{readWorkbook,understandWorkbook:(sheets,sheet=null,overrides=null)=>understandWorkbook(sheets,sheet,overrides,aliases,PRODUCT_TYPE_ALIASES)}}
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = ROOT / 'desktop/plugin.js'
    source = target.read_text()
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
    if args.check:
        if updated != source:
            raise SystemExit('Smart workbook core is stale. Run scripts/sync_smart_import.py.')
        print('Smart workbook core and vocabulary are in sync.')
    else:
        target.write_text(updated)
        print('Synced smart workbook core and vocabulary.')


if __name__ == '__main__':
    main()
