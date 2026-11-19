"""Lifecycle: living. Isolated CLI evidence; never reads a live auth store."""
import os
from pathlib import Path
import subprocess
import sys
import json

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / '.scratch'
ENV = {**os.environ, 'HERMES_HOME': str(SCRATCH / 'home'), 'TMPDIR': str(SCRATCH / 'tmp'),
       'PYTHONDONTWRITEBYTECODE': '1', 'HERMES_ENABLE_PROJECT_PLUGINS': '0'}
ENV.pop('PYTHONPATH', None)
# Interpreter must be the existing Hermes runtime; no dependencies are installed here.
cli = [sys.executable, '-m', 'hermes_cli.main']
checks = [
    ('launcher-validate', ['hermes', 'plugins', 'validate', str(ROOT), '--install-deps']),
    ('launcher-doctor', ['hermes', 'plugins', 'doctor', str(ROOT), '--ci']),
    ('runtime-validate', cli + ['plugins', 'validate', str(ROOT)]),
    ('runtime-doctor', cli + ['plugins', 'doctor', str(ROOT), '--ci']),
]
results = []
for name, command in checks:
    result = subprocess.run(command, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=90)
    (SCRATCH / f'{name}.log').write_text(result.stdout + result.stderr)
    results.append({'name': name, 'command': command, 'exit_code': result.returncode,
                    'log': f'.scratch/{name}.log'})
(ROOT / 'docs' / 'gate-results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
