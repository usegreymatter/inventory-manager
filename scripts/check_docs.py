#!/usr/bin/env python3
"""Check docs: every relative Markdown link resolves and every JSON file parses.

Standard library only. Run from anywhere: python3 scripts/check_docs.py
Exit code 0 = clean, 1 = problems (listed).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r'\]\(([^)\s]+)\)')
SKIP_DIRS = ('docs/history/',)  # historical notes may cite ignored local evidence


def tracked():
    try:
        out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        return [ROOT / f for f in out.splitlines() if f]
    except (OSError, subprocess.CalledProcessError):
        return [p for p in ROOT.rglob('*') if p.is_file() and '.git' not in p.parts and '.scratch' not in p.parts]


def main():
    problems, links, jsons = [], 0, 0
    for path in tracked():
        rel = path.relative_to(ROOT).as_posix()
        if path.suffix == '.json':
            jsons += 1
            try:
                json.loads(path.read_text(encoding='utf-8'))
            except ValueError as exc:
                problems.append(f'{rel}: invalid JSON ({exc})')
        if path.suffix not in ('.md', '.txt') or rel.startswith(SKIP_DIRS):
            continue
        for lineno, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            for target in LINK.findall(line):
                if re.match(r'^[a-z][a-z0-9+.-]*:', target) or target.startswith('#'):
                    continue
                target = target.split('#', 1)[0]
                if not target:
                    continue
                links += 1
                if not (path.parent / target).resolve().exists():
                    problems.append(f'{rel}:{lineno}: broken link {target}')
    for p in problems:
        print(p)
    print(f'checked {links} relative links, {jsons} JSON files: {len(problems)} problem(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
