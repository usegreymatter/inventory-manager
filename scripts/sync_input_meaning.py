#!/usr/bin/env python3
"""Synchronize the pure input-meaning mirror into Desktop/standalone core."""
from pathlib import Path
import json
import re
ROOT = Path(__file__).resolve().parents[1]
START, END = '// INPUT_MEANING_START\n', '// INPUT_MEANING_END\n'
path = ROOT / 'desktop/plugin.js'
text = path.read_text()
mirror = ROOT / 'desktop/input-meaning.js'
source = mirror.read_text()
order = json.loads((ROOT / 'input-meaning-warning-order.json').read_text())
source, count = re.subn(r'export const INPUT_WARNING_PREFIXES = [^\n]*', 'export const INPUT_WARNING_PREFIXES = ' + json.dumps(order, ensure_ascii=False), source)
assert count == 1, 'warning-order mirror anchor must be unique'
mirror.write_text(source)
block = START + source + END
if START in text:
    a = text.index(START)
    b = text.index(END, a) + len(END)
    text = text[:a] + block + text[b:]
else:
    text = text.replace('// SMART_WORKBOOK_END\n', '// SMART_WORKBOOK_END\n' + block, 1)
path.write_text(text)
print('Input-meaning core synchronized')
