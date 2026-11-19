"""Lifecycle: living. Registered-handler smoke, not a model-backed chat."""
from datetime import date
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import sys

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / '.scratch' / 'home'
os.environ['HERMES_HOME'] = str(HOME)
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
PACKAGE = HOME / 'plugins' / 'stock-runway'
PACKAGE.mkdir(parents=True, exist_ok=True)
# Copy the complete local runtime dependency closure, not a stale subset.
# No installed Hermes package, credentials or external data are consulted.
relatives = [p.name for p in ROOT.glob('*.py')]
relatives += [str(p.relative_to(ROOT)) for p in (ROOT / 'forecast_lab').glob('*.py')]
relatives += ['plugin.yaml', 'data/sample.json', 'skills/stock-runway/SKILL.md',
              'desktop/plugin.js']
for relative in relatives:
    target = PACKAGE / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / relative, target)

def denied(*args, **kwargs):
    raise AssertionError('Network is forbidden in this smoke harness.')

socket.create_connection = denied
socket.socket.connect = denied
spec = importlib.util.spec_from_file_location('stock_runway_smoke', PACKAGE / '__init__.py', submodule_search_locations=[str(PACKAGE)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class Context:
    tools = {}
    skills = {}
    commands = {}

    def register_command(self, name, handler, **metadata):
        self.commands[name] = {'handler': handler, **metadata}

    def register_tool(self, **entry):
        self.tools[entry['name']] = entry

    def register_skill(self, name, path):
        self.skills[name] = path

ctx = Context()
# Fixed demonstration date makes the checked-in evidence reproducible.
factory = module.make_handler
module.make_handler = lambda: factory(today=date(2026, 11, 12))
module.register(ctx)
assert set(ctx.tools) == {'stock_runway'}
assert set(ctx.commands) == {'stock'}
assert 'stock-runway' in ctx.skills
result = json.loads(ctx.tools['stock_runway']['handler']({'source': 'sample'}))
assert len(result['items']) == 5 and all(not item['held'] for item in result['items'])
text = ('Registered-handler harness, NOT a model-backed Hermes chat.\n'
        'Scratch package: .scratch/home/plugins/stock-runway\n'
        'No auth stores accessed; network denied; register(ctx) and registered stock_runway handler called.\n'
        + json.dumps(result, indent=2) + '\n')
(ROOT / 'docs' / 'smoke-chat.txt').write_text(text)
print('\n'.join(result['summary']))
print('Registered-handler smoke: 1 tool and 1 skill registered, 5 sample items returned. PASS')
