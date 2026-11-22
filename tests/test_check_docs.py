import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def test_checker_uses_extracted_root_and_rejects_empty_tree(tmp_path):
    outer = tmp_path / 'outer'
    inner = outer / 'extracted' / 'source'
    (inner / 'scripts').mkdir(parents=True)
    shutil.copy(ROOT / 'scripts/check_docs.py', inner / 'scripts/check_docs.py')
    (inner / 'README.md').write_text('[local](guide.md)\n', encoding='utf-8')
    (inner / 'guide.md').write_text('guide\n', encoding='utf-8')
    (inner / 'data.json').write_text('{"ok":true}\n', encoding='utf-8')
    subprocess.run(['git', 'init', '-q', str(outer)], check=True)
    env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1'}
    result = subprocess.run([sys.executable, str(inner / 'scripts/check_docs.py')], cwd=inner, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'checked 1 relative links, 1 JSON files: 0 problem(s)' in result.stdout

    for path in inner.rglob('*'):
        if path.is_file() and path.name != 'check_docs.py':
            path.unlink()
    empty = subprocess.run([sys.executable, str(inner / 'scripts/check_docs.py')], cwd=inner, env=env, capture_output=True, text=True)
    assert empty.returncode == 1
    assert 'checked 0 relative links, 0 JSON files' in empty.stdout
