"""Frozen feature-1 findings: NO_GO remains parent-owned until delta review."""
import json
import subprocess
import pytest
from test_phase2 import bundle, sources, tools, write_csv, TODAY, ROOT


def test_truncated_optional_numeric_rows_fail_closed(tmp_path):
    bundle(tmp_path)
    (tmp_path/'incoming_pos.csv').write_text('po_line_id,sku,warehouse,supplier,remaining_qty,due_date,status\nP,A,MAIN,S\n')
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert data['items'][0]['planning_facts']['incoming_pos'][0]['remaining_qty'] is None
    payload=json.loads(tools.make_handler()({'source':'csv','bundle_path':str(tmp_path)}))
    assert 'error' not in payload and payload['items'][0]['guidance']['status']=='needs-data'
    (tmp_path/'incoming_pos.csv').unlink()
    (tmp_path/'customer_orders.csv').write_text('order_line_id,sku,warehouse,quantity,delivery_date,status,forecast_included\nO,A,MAIN\n')
    assert sources.load_bundle(str(tmp_path),today=TODAY)['items'][0]['planning_facts']['customer_orders'][0]['quantity'] is None


def test_mixed_invalid_legacy_receipts_reject_entire_bundle(tmp_path):
    bundle(tmp_path);(tmp_path/'incoming_pos.csv').unlink()
    write_csv(tmp_path,'legacy_receipts.csv',[['sku','month','quantity'],['A','bad',10],['B','2026-11',100000]])
    with pytest.raises(sources.SourceError,match='legacy receipts'):
        sources.load_bundle(str(tmp_path),today=TODAY)


@pytest.mark.parametrize('alias',['direct','parent','symlink'])
def test_cli_never_writes_inside_bundle(tmp_path,alias):
    root=tmp_path/'bundle';root.mkdir();bundle(root)
    write_csv(root,'legacy_receipts.csv',[['sku','month','quantity'],['B','2026-11',10]])
    # Avoid overlap with A incoming; B's valid receipt must remain byte-identical.
    before={p.name:p.read_bytes() for p in root.iterdir()}
    target=root/'legacy_receipts.csv'
    if alias=='parent':target=root/'..'/'bundle'/'legacy_receipts.csv'
    if alias=='symlink':
        link=tmp_path/'alias';link.symlink_to(root,target_is_directory=True);target=link/'legacy_receipts.csv'
    p=subprocess.run(['/usr/bin/python3','stock_runway.py',str(root),'--bundle','--today',TODAY,'--all','-o',str(target)],cwd=ROOT,text=True,capture_output=True)
    assert p.returncode==2 and 'inside' in p.stderr
    assert before=={p.name:p.read_bytes() for p in root.iterdir()}
