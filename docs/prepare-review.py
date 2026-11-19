"""Lifecycle: living. Local diff-only review payload; never sends anything."""
import ast
import difflib
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
paths = ['__init__.py', 'engine.py', 'sources.py', 'tools.py', 'plugin.yaml',
         'desktop/plugin.js', *[str(p.relative_to(ROOT)) for p in sorted((ROOT / 'tests').glob('test_*.py'))],
         'tests/desktop.test.mjs']
parts = ['Review candidate against empty Git HEAD. Sample data and sample-specific assertions omitted.\n']
for relative in paths:
    content = (ROOT / relative).read_text()
    if relative == 'desktop/plugin.js':
        content = re.sub(r'^const SAMPLE = .*$', '// Embedded dataset omitted from local review payload.', content, flags=re.M)
    if relative == 'tests/desktop.test.mjs':
        content = re.sub(r"test\('(embedded sample|JS engine independently).*?\n\}\)\n", '// Sample-specific test omitted.\n', content, flags=re.S)
    if relative in ('tests/test_engine.py', 'tests/test_tool.py'):
        lines = content.splitlines(keepends=True)
        for node in reversed(ast.parse(content).body):
            if isinstance(node, ast.FunctionDef) and node.name in ('test_sample_oracle_independently_recomputed', 'test_tool_returns_json_compact_lines_and_disclosure'):
                lines[node.lineno - 1:node.end_lineno] = ['# Sample-specific test omitted.\n']
        content = ''.join(lines)
    parts.extend(difflib.unified_diff([], content.splitlines(keepends=True), fromfile='/dev/null', tofile=relative))
output = ROOT / '.scratch/review-payload.diff'
output.write_text(''.join(parts))
assert not re.search(r'^\+const SAMPLE =', output.read_text(), flags=re.M)
print('Prepared local payload; dataset and sample-specific assertions excluded; no transmission.')
