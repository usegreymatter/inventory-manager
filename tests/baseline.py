"""Immutable local baselines; git is only a fallback for unvendored revisions."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures/baselines'


def read_baseline(spec, *, text=False):
    revision, path = spec.split(':', 1)
    if not revision or any(part in ('', '.', '..') for part in revision.split('/')) or '/' in revision:
        raise ValueError('Invalid baseline revision')
    relative = Path(path)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Invalid baseline path')
    fixture = FIXTURES / revision / relative
    raw = fixture.read_bytes() if fixture.is_file() else subprocess.check_output(
        ['git', 'show', spec], cwd=ROOT)
    return raw.decode('utf-8') if text else raw
