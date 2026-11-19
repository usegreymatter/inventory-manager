"""Sample + synthetic golden quantities, dates and display statuses on all surfaces."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("golden_diff", ROOT / "scripts/golden_diff.py")


def test_all_golden_surfaces_match_reviewed_fixture():
    import json
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    inputs = json.loads((ROOT / "tests/golden/inputs.json").read_text())
    assert len(inputs["cases"]) == 11
    assert {c["item"]["sku"] for c in inputs["cases"]} >= {i["sku"] for i in json.loads((ROOT / "data/sample.json").read_text())["items"]}
    actual = module.collect(inputs)
    assert actual == json.loads((ROOT / "tests/golden/numbers.json").read_text())
    for row in actual:
        assert row["js"] == row["python"] == row["cli"], row["sku"]


def test_real_cli_process_matches_golden_for_all_flag_representable_inputs(tmp_path):
    import csv, io, json, subprocess, sys
    inputs = json.loads((ROOT / 'tests/golden/inputs.json').read_text())
    golden = {r['sku']:r['cli'] for r in json.loads((ROOT / 'tests/golden/numbers.json').read_text())}
    checked = []
    for case in inputs['cases']:
        raw = case['item']
        # Settings JSON is the real CLI boundary for per-product constraints.
        # Dated open receipts need the separate bundle test below, rather than
        # silently discarding their day when writing a monthly CSV.
        if raw.get('open_receipts'):
            continue
        settings = json.loads(json.dumps(case.get('settings', {})))
        constraints = {k: raw[k] for k in ('minimum_order', 'pack_size') if k in raw}
        if constraints:
            settings.setdefault('product_overrides', {}).setdefault(raw['sku'], {}).update(constraints)
        settings_path = tmp_path / (raw['sku'] + '-settings.json')
        settings_path.write_text(json.dumps(settings))
        source = tmp_path / (raw['sku'] + '.csv')
        headers = ['sku','name','unit','on_hand','supplier_days']
        if 'on_order' in raw:
            headers.append('on_order')
        headers += case['months']
        with source.open('w', newline='') as handle:
            writer = csv.DictWriter(handle, headers)
            writer.writeheader()
            writer.writerow({**{k:raw.get(k) for k in headers if k not in case['months']},
                             **dict(zip(case['months'],raw['monthly_sales']))})
        child = subprocess.run([sys.executable,str(ROOT/'stock_runway.py'),str(source),
                                '--today',inputs['today'],'--all','--settings',str(settings_path)], text=True,capture_output=True)
        assert child.returncode == 0, child.stderr
        row, = csv.DictReader(io.StringIO(child.stdout))
        actual = {key:row[key] or None for key in ('order_by','run_out','status')}
        actual['order_qty'] = float(row['order_qty']) if row['order_qty'] else None
        assert actual == golden[raw['sku']]
        checked.append(raw['sku'])
    assert len(checked) == 10
    assert checked == ['SEAL-CLR-300', 'UL-FOAM-GRN', 'GRT-GRY-5', 'SEAL-WHT-300',
                       'ZERO-HISTORY', 'INTERMITTENT', 'HUGE-MOQ', 'PACK-SIZE',
                       'OVERSTOCK-FUTURE', 'UNDATED-INCOMING']


def test_real_cli_bundle_preserves_exact_dated_sample_receipt(tmp_path):
    import csv, io, json, subprocess, sys
    inputs = json.loads((ROOT / 'tests/golden/inputs.json').read_text())
    cases = [c for c in inputs['cases'] if c['item'].get('open_receipts')]
    assert len(cases) == 1
    case, = cases
    raw = case['item']
    bundle = tmp_path / 'dated-bundle'
    bundle.mkdir()
    def emit(name, headers, rows):
        with (bundle / name).open('w', newline='') as handle:
            writer = csv.writer(handle)
            writer.writerow(headers)
            writer.writerows(rows)
    (bundle / 'manifest.json').write_text(json.dumps({
        'contract_version': '1.0', 'snapshot_date': inputs['as_of'],
        'currency': 'KWD', 'synthetic': True}))
    emit('stock.csv', ['sku','name','unit','on_hand','supplier_days'] + case['months'],
         [[raw[k] for k in ('sku','name','unit','on_hand','supplier_days')] + raw['monthly_sales']])
    emit('warehouses.csv', ['warehouse','name'], [['MAIN','Synthetic warehouse']])
    emit('incoming_pos.csv',
         ['po_line_id','sku','warehouse','supplier','remaining_qty','due_date','status'],
         [[f'SYN-{index}',raw['sku'],'MAIN',raw['supplier'],r['qty'],r['date'],'confirmed']
          for index,r in enumerate(raw['open_receipts'])])
    child = subprocess.run([sys.executable,str(ROOT/'stock_runway.py'),str(bundle),
                            '--bundle','--today',inputs['today'],'--all'],
                           text=True,capture_output=True)
    assert child.returncode == 0, child.stderr
    row, = csv.DictReader(io.StringIO(child.stdout))
    actual = {key:row[key] or None for key in ('order_by','run_out','status')}
    actual['order_qty'] = float(row['order_qty']) if row['order_qty'] else None
    golden = {r['sku']:r['cli'] for r in json.loads((ROOT/'tests/golden/numbers.json').read_text())}
    assert actual == golden[raw['sku']]
    # This healthy product has no supply-gap row, so the gap-specific exported
    # delivery cell is empty. Inspect the real import bridge to prove day-level
    # receipt evidence survived, in addition to the full golden comparison.
    assert row['next_confirmed_delivery'] == ''
    bridge = subprocess.run([sys.executable,str(ROOT/'bundle_import.py'),str(bundle),
                             '--today',inputs['today']],text=True,capture_output=True)
    assert bridge.returncode == 0, bridge.stderr
    imported, = json.loads(bridge.stdout)['items']
    receipt, = imported['planning_facts']['incoming_pos']
    assert receipt['due_date'] == raw['open_receipts'][0]['date']
    assert receipt['remaining_qty'] == raw['open_receipts'][0]['qty']
