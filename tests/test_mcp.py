"""Synthetic, offline MCP contract tests (Lifecycle: living)."""
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('inventory_mcp', ROOT / 'mcp_server.py')
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)
META = {'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {}}

@pytest.fixture
def source(tmp_path):
    p = tmp_path / 'stock.csv'
    p.write_text('sku,name,unit,on_hand,supplier_days,on_order,2026-08,2026-09,2026-10\nA,Synthetic,ea,0,14,,30,30,30\nB,Covered,ea,300,14,0,30,30,30\n')
    return p

def request(method, params=None, modern=True, id=1):
    p = dict(params or {})
    if modern:
        p['_meta'] = {k: dict(v) if isinstance(v, dict) else v for k, v in META.items()}
    return dict(jsonrpc='2.0', id=id, method=method, params=p)

def run(source, messages):
    raw = b''.join((json.dumps(m).encode()+b'\n') if not isinstance(m, bytes) else m for m in messages)
    return subprocess.run([sys.executable, '-B', str(ROOT/'mcp_server.py'), '--csv', str(source), '--today', '2026-11-01', '--show-orders-anyway'], input=raw, capture_output=True)

def snapshot(source, *args):
    return server.Snapshot(server.parser().parse_args(['--csv', str(source), '--today', '2026-11-01', '--show-orders-anyway', *args]))

def test_modern_and_cli_parity(source):
    result = run(source, [request('server/discover'), request('tools/list'), request('tools/call', {'name':'list_reorders','arguments':{'status':'all'}})])
    assert result.returncode == 0 and result.stderr == b''
    discover, listing, call = map(json.loads, result.stdout.splitlines())
    assert discover['result']['supportedVersions'] == list(server.VERSIONS)
    assert len(listing['result']['tools']) == 3
    assert call['result']['resultType'] == 'complete'
    payload = call['result']['structuredContent']
    cli = subprocess.run([sys.executable,'-B',str(ROOT/'stock_runway.py'),str(source),'--today','2026-11-01','--all','--json','--show-orders-anyway'],capture_output=True,text=True)
    assert cli.returncode == 0
    assert payload['items'] == json.loads(cli.stdout)
    assert payload['planning_date'] == '2026-11-01'
    assert payload['items'][0]['on_order'] is None
    s = snapshot(source)
    assert s.call('explain_item', {'sku':'A'})['item'] == payload['items'][0]
    assert s.call('data_health', {})['health'] == s.health

def test_legacy(source):
    messages = [request('tools/list', modern=False), request('initialize', {'protocolVersion':'unknown','capabilities':{},'clientInfo':{}},False), dict(jsonrpc='2.0',method='notifications/initialized'),request('tools/list',modern=False),request('ping',modern=False)]
    out = [json.loads(x) for x in run(source,messages).stdout.splitlines()]
    assert len(out)==4 and 'error' in out[0]
    assert out[1]['result']['protocolVersion']=='2025-11-25'
    assert len(out[2]['result']['tools'])==3 and out[3]['result']=={}

@pytest.mark.parametrize('name,args', [('list_reorders',{'limit':True}),('list_reorders',{'limit':1.5}),('list_reorders',{'limit':201}),('list_reorders',{'status':'order'}),('list_reorders',{'path':'x'}),('explain_item',{'sku':' A'}),('explain_item',{'sku':'x'*129}),('explain_item',{'sku':'a'}),('data_health',{'x':1}),('draft_po',{})])
def test_arguments(source,name,args):
    with pytest.raises(ValueError): snapshot(source).call(name,args)

def test_metadata_and_notification_silence(source):
    bad=request('ping'); bad['params']['_meta']={'io.modelcontextprotocol/protocolVersion':'future','io.modelcontextprotocol/clientCapabilities':{}}
    missing=request('ping')
    missing['params']['_meta']={'io.modelcontextprotocol/protocolVersion':'2026-07-28'}
    note=request('tools/call',{'name':'draft_po'}); note.pop('id')
    out=[json.loads(x) for x in run(source,[bad,missing,note,{'jsonrpc':'2.0','id':2,'result':{}}]).stdout.splitlines()]
    assert [x['error']['code'] for x in out]==[-32022,-32602]

@pytest.mark.parametrize('raw',[b'[]\n',b'{\n',b'\xff\n',b'{"a":NaN}\n',b'{"a":Infinity}\n',b'{"a":1,"a":2}\n',b'['*2000+b']'*2000+b'\n', b'9'*5000+b'\n', b'x'*(1024*1024+1)+b'\n'], ids=['batch','syntax','utf8','nan','infinity','duplicate','deep','integer','oversized'])
def test_bad_frames_recover(source,raw):
    out=run(source,[raw,request('ping')])
    lines=[json.loads(x) for x in out.stdout.splitlines()]
    assert len(lines)==2 and 'error' in lines[0] and lines[1]['result']['resultType']=='complete'

def test_no_network_or_writes(source,monkeypatch):
    before=source.read_bytes()
    def deny(*a,**k): raise AssertionError('network')
    monkeypatch.setattr(socket,'socket',deny)
    s=snapshot(source)
    for name,args in [('list_reorders',{}),('explain_item',{'sku':'A'}),('data_health',{})]: s.call(name,args)
    assert source.read_bytes()==before

def test_caps(source):
    with source.open('a') as f:
        for i in range(210): f.write(f'X{i},Synthetic,ea,0,14,,30,30,30\n')
    s=snapshot(source)
    value=s.call('list_reorders',{'status':'all'})
    assert len(value['items'])==200 and value['total']==212 and value['truncated']
    def check(v):
        if isinstance(v,list):
            assert len(v)<=200
            for x in v: check(x)
        elif isinstance(v,dict):
            for x in v.values(): check(x)
    check(s.call('data_health',{}))

def test_risk_requires_ack(source):
    source.write_text(source.read_text().replace('2026-08,2026-09,2026-10', '2026-09,2026-10,2026-11'))
    with pytest.raises(ValueError): server.Snapshot(server.parser().parse_args(['--csv',str(source),'--today','2026-11-01']))
    assert snapshot(source).data['input_meaning']['requires_ack'] is True


def test_discover_requires_modern_metadata(source):
    result = run(source, [request('server/discover', modern=False)])
    assert json.loads(result.stdout)['error']['code'] == -32602


def test_bundle_settings_and_cli_parity(source, tmp_path):
    (tmp_path/'manifest.json').write_text('{"contract_version":"1.0","snapshot_date":"2026-10-31","currency":"KWD"}')
    (tmp_path/'incoming_pos.csv').write_text('po_line_id,sku,warehouse,supplier,remaining_qty,due_date,status\nSYN,UNKNOWN,MAIN,SYN,1,2026-11-10,confirmed\n')
    settings = tmp_path / 'settings.json'
    settings.write_text('{"months_of_cover":3,"show_costs":false}')
    args = server.parser().parse_args(['--bundle', str(tmp_path), '--settings',str(settings),'--today','2026-11-01'])
    s = server.Snapshot(args)
    cli = subprocess.run([sys.executable,'-B',str(ROOT/'stock_runway.py'),str(tmp_path),'--bundle','--settings',str(settings),'--today','2026-11-01','--all','--json'],capture_output=True,text=True)
    assert cli.returncode == 0, cli.stderr
    assert s.rows and s.call('list_reorders',{'status':'all'})['items'] == json.loads(cli.stdout)
    assert 'unknown_sku' in {d['code'] for d in s.call('data_health',{})['validator_diagnostics']}


@pytest.mark.parametrize('field,value', [('on_hand',''),('2026-09','invalid'),('on_order','invalid')])
def test_held_inputs(source,field,value):
    import csv
    with source.open() as f: rows=list(csv.DictReader(f)); fields=list(rows[0])
    assert snapshot(source).call('explain_item', {'sku':'A'})['item']['order_qty'] is not None
    rows[0][field]=value
    with source.open('w') as f:
        w=csv.DictWriter(f,fields); w.writeheader(); w.writerows(rows)
    s=snapshot(source)
    rows=s.call('list_reorders',{'status':'all'})['items']
    assert rows == cli_rows(source)
    selected = [row for row in rows if row['sku']=='A']
    if selected:
        assert len(selected) == 1 and selected[0]['order_qty'] is None
        assert selected[0]['status'] == 'needs-data'
    else:
        rejected = s.data['import_report']['rows_set_aside']
        assert len(rejected) == 1 and rejected[0]['row'] == 2
        assert rejected[0]['reason']
        assert s.call('data_health',{})['import_summary']['rows_set_aside'] == 1


def test_byte_cap_and_controls(source):
    import io
    output=io.BytesIO()
    server.emit({'id':1,'result':{'label':'x'*server.MAX_RESPONSE}},output)
    assert len(output.getvalue()) < server.MAX_RESPONSE
    assert 'error' in json.loads(output.getvalue())
    assert server.dumps({'label':'\u202e\u0000\u0085'}) == '{"label":"\\u202e\\u0000\\u0085"}'


@pytest.mark.parametrize('rpc_id',[None,True,{},[],1.5,'x'*129,2**54])
def test_invalid_ids(source,rpc_id):
    result=run(source,[request('ping',id=rpc_id)])
    assert json.loads(result.stdout)['error']['code']==-32600


@pytest.mark.parametrize('kind', ['csv','bundle','settings'])
def test_regular_only(source,tmp_path,kind):
    import os
    bundle_dir=tmp_path/'fifo-bundle'
    bundle_dir.mkdir()
    fifo=bundle_dir/'Stock.CSV' if kind == 'bundle' else tmp_path/'pipe.csv'
    os.mkfifo(fifo)
    args = ['--bundle',str(bundle_dir)] if kind == 'bundle' else ['--csv',str(fifo)] if kind == 'csv' else ['--csv',str(source),'--settings',str(fifo)]
    result=subprocess.run([sys.executable,str(ROOT/'mcp_server.py'),*args],input=b'',capture_output=True,timeout=5)
    assert result.returncode == 1 and result.stdout == b''


@pytest.mark.parametrize('version', server.LEGACY)
def test_exact_legacy_versions(source,version):
    msg=request('initialize',{'protocolVersion':version,'capabilities':{},'clientInfo':{}},False)
    result=run(source,[msg])
    assert json.loads(result.stdout)['result']['protocolVersion']==version


def test_modern_independent_of_legacy(source):
    result=run(source,[request('initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{}},False),request('tools/list')])
    out=[json.loads(x) for x in result.stdout.splitlines()]
    assert len(out[1]['result']['tools'])==3
    msg=request('ping')
    msg['params']['_meta']={**META,'io.modelcontextprotocol/protocolVersion':'future'}
    error=json.loads(run(source,[msg]).stdout)['error']
    assert error['data']=={'supported':list(server.VERSIONS),'requested':'future'}


def test_snapshot_does_not_reload(source):
    s=snapshot(source)
    before=s.call('list_reorders',{'status':'all'})
    source.write_text('invalid replacement')
    assert s.call('list_reorders',{'status':'all'})==before


def test_no_file_writes_during_startup_or_tools(source,monkeypatch):
    import builtins
    import io
    original=builtins.open
    original_io=io.open
    def guard(delegate):
        def opened(file,mode='r',*args,**kwargs):
            assert not any(c in mode for c in 'wax+'), 'write attempted'
            return delegate(file,mode,*args,**kwargs)
        return opened
    monkeypatch.setattr(builtins,'open',guard(original))
    monkeypatch.setattr(io,'open',guard(original_io))
    s=snapshot(source)
    for name,args in [('list_reorders',{}),('explain_item',{'sku':'A'}),('data_health',{})]: s.call(name,args)


def test_held_engine_rows_and_health(source,monkeypatch):
    engine,sources=server.cli._load_modules()
    data=sources.load_csv(str(source))
    data['items'][0]['on_hand']=None
    data['items'][1]['monthly_sales']=[None]*3
    monkeypatch.setattr(sources,'load_bundle',lambda *a,**k:data)
    s=server.Snapshot(server.parser().parse_args(['--bundle',str(source.parent),'--today','2026-11-01']))
    assert len(s.rows) == 2 and all(r['order_qty'] is None for r in s.rows)
    assert all(r['status'] == 'needs-data' for r in s.rows)
    assert s.health['warnings']


def test_unknown_methods_and_all_write_tools(source):
    names=['draft_po','approve_po','send_po','cancel_po','set_automation_level','edit_settings','apply_sync','write_erp_po']
    result=run(source,[request('unknown')]+[request('tools/call',{'name':n,'arguments':{}}) for n in names])
    out=[json.loads(x) for x in result.stdout.splitlines()]
    assert out[0]['error']['code']==-32601
    assert all(x['error']['code']==-32602 for x in out[1:])


def test_health_private_import_fields_excluded(source):
    s=snapshot(source)
    s.data['import_report']={'warnings':['PRIVATE-CELL'], 'path':'PRIVATE-PATH','total_rows':2,'accepted_rows':2}
    s.data['bundle_health']={'errors':[{'code':'missing','file':'PRIVATE-PATH','message':'PRIVATE-CELL','row':2}]}
    health=s.call('data_health',{})
    assert 'PRIVATE' not in server.dumps(health)
    assert health['import_warning_count']==1
    assert health['validator_diagnostics']==[{'code':'missing'}]


@pytest.mark.parametrize('message',[{}, {'jsonrpc':'2.0'}, {'jsonrpc':'2.0','method':3}])
def test_malformed_objects_are_not_notifications(source,message):
    response=json.loads(run(source,[message]).stdout)
    assert response['id'] is None and response['error']['code']==-32600


def cli_rows(source, bundle=False):
    result = subprocess.run([sys.executable,'-B',str(ROOT/'stock_runway.py'),str(source),*(['--bundle'] if bundle else []),'--today','2026-11-01','--all','--json','--show-orders-anyway'],capture_output=True,text=True,timeout=5)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_cli_import_collision(source,monkeypatch):
    import types
    package = types.ModuleType('stock_runway')
    package.__path__ = ['plugin-package']
    private = types.ModuleType('_inventory_mcp_cli')
    monkeypatch.setitem(sys.modules,'stock_runway',package)
    monkeypatch.setitem(sys.modules,'_inventory_mcp_cli',private)
    spec=importlib.util.spec_from_file_location('collision_mcp',ROOT/'mcp_server.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    s=module.Snapshot(module.parser().parse_args(['--csv',str(source),'--today','2026-11-01','--show-orders-anyway']))
    assert s.rows and s.rows == cli_rows(source)
    assert sys.modules['stock_runway'] is package
    assert package.__path__ == ['plugin-package']
    assert sys.modules['_inventory_mcp_cli'] is private


@pytest.mark.parametrize('bundle',[False,True])
def test_lot_ack_cli_parity(source,bundle,monkeypatch):
    import csv
    with source.open() as f:
        reader=csv.DictReader(f); fields=reader.fieldnames[:6]+['lots']+reader.fieldnames[6:]; rows=list(reader)
    rows[0]['on_hand']='10'
    rows[0]['lots']=json.dumps([dict(lot='SYN',expiry='2026-12-01',qty=10,expiry_acknowledged=False)])
    with source.open('w') as f:
        writer=csv.DictWriter(f,fields); writer.writeheader(); writer.writerows(rows)
    if bundle:
        (source.parent/'manifest.json').write_text('{"contract_version":"1.0","snapshot_date":"2026-10-31","currency":"KWD"}')
    if bundle:
        # Canonical bundle validation excludes lot columns. Exercise the bundle
        # acknowledgment seam with a synthetic loader, alongside real bundle parity.
        data=server.cli._load_modules()[1].load_csv(str(source))
        source.write_text('sku,name,unit,on_hand,supplier_days,on_order,2026-08,2026-09,2026-10\nA,Synthetic,ea,10,14,0,30,30,30\n')
        monkeypatch.setattr(server.cli._load_modules()[1],'load_bundle',lambda *a,**k:data)
    args=['--bundle',str(source.parent)] if bundle else ['--csv',str(source)]
    s=server.Snapshot(server.parser().parse_args([*args,'--today','2026-11-01','--show-orders-anyway']))
    assert s.data['items'][0]['lots'][0]['expiry_acknowledged'] is True
    if bundle:
        # Execute the actual CLI with the identical synthetic bundle snapshot.
        script = '''
import json, runpy, sys
from pathlib import Path
import mcp_server
_, sources = mcp_server.cli._load_modules()
data = json.loads(sys.argv[1])
sources.load_bundle = lambda *a, **k: data
sys.argv = ['stock_runway.py', sys.argv[2], '--bundle', '--today', '2026-11-01', '--all', '--json', '--show-orders-anyway']
runpy.run_path('stock_runway.py', run_name='__main__')
'''
        # Restore the false bit so both entry points must acknowledge it.
        data['items'][0]['lots'][0]['expiry_acknowledged']=False
        result=subprocess.run([sys.executable,'-B','-c',script,json.dumps(data),str(source.parent)],cwd=ROOT,capture_output=True,text=True,timeout=5)
        assert result.returncode == 0, result.stderr
        expected=json.loads(result.stdout)
    else:
        expected=cli_rows(source)
    assert s.rows and s.rows == expected


def test_published_argument_keys(source):
    assert {t['name']:set(t['inputSchema']['properties']) for t in server.TOOLS} == {'list_reorders':{'status','limit'},'explain_item':{'sku'},'data_health':set()}
    with pytest.raises(ValueError): snapshot(source).call('list_reorders',{'supplier_id':'SYN'})


def test_initialized_request_and_legacy_meta(source):
    s=server.Server(snapshot(source))
    assert s.handle(request('notifications/initialized',modern=False))['error']['code']==-32600
    assert s.handle(request('ping',{'_meta':{server.PREFIX+'related-task':{}}},False))['result']=={}
    msg=request('ping'); msg['params']['_meta']={server.PREFIX+'clientCapabilities':{}}
    assert s.handle(msg)['error']['code']==-32602


def test_serialization_failure_is_internal(source,monkeypatch):
    s=snapshot(source)
    monkeypatch.setattr(s,'call',lambda *a: {'invalid':float('nan')})
    assert server.Server(s).handle(request('tools/call',{'name':'data_health'}))['error']['code']==-32603


def test_real_import_counts(source):
    with source.open('a') as f: f.write('BAD,Rejected,ea,invalid,14,0,30,30,30\n')
    s=snapshot(source)
    summary=s.call('data_health',{})['import_summary']
    assert summary == dict(rows_imported=2,products_ready=2,rows_set_aside=1,ignored=0,accepted_rows=2)
    assert 'BAD' not in {r['sku'] for r in s.rows}


def test_advertised_startup_does_not_cache_siblings(source,tmp_path):
    import os
    cache=tmp_path/'bytecode'
    result=subprocess.run([sys.executable,str(ROOT/'mcp_server.py'),'--csv',str(source),'--today','2026-11-01','--show-orders-anyway'],input=b'',capture_output=True,timeout=5,env={**os.environ,'PYTHONPYCACHEPREFIX':str(cache)})
    assert result.returncode == 0 and result.stderr == b''
    assert not list((cache/ROOT.relative_to(ROOT.anchor)).glob('*.pyc'))


def test_ignored_import_columns_count(source):
    import csv
    with source.open() as f:
        reader=csv.DictReader(f); fields=reader.fieldnames+['private_unused']; rows=list(reader)
    for row in rows: row['private_unused']='PRIVATE-CELL'
    with source.open('w') as f:
        writer=csv.DictWriter(f,fields); writer.writeheader(); writer.writerows(rows)
    health=snapshot(source).call('data_health',{})
    assert health['import_summary']['ignored'] == 1
    assert 'PRIVATE' not in server.dumps(health)


def test_name_generated_codes_are_visible_without_ambiguous_rows(tmp_path):
    file=tmp_path/'private-source.csv'
    file.write_text('name,on_hand,2026-08,2026-09,2026-10\nWidget,5,1,1,1\nOther,5,1,1,1\nTotal,10,2,2,2\n')
    result=run(file,[request('tools/call',{'name':'list_reorders','arguments':{'status':'all'}},id=1),request('tools/call',{'name':'data_health','arguments':{}},id=2)])
    assert result.returncode==0 and result.stderr==b''
    rows,health=[json.loads(line)['result']['structuredContent'] for line in result.stdout.splitlines()]
    note='No product code column found — codes were made from product names.'
    assert rows['input_notes']==health['input_notes']==[note]
    assert len(rows['items'])==2 and any(i['sku']=='widget-c07f0119e3154625' for i in rows['items'])
    assert health['import_summary']['rows_set_aside']==1
    assert 'private-source' not in server.dumps(rows)+server.dumps(health)


def test_name_generated_duplicate_fails_closed_in_mcp(tmp_path):
    file=tmp_path/'ambiguous.csv'
    file.write_text('name,on_hand,Warehouse,2026-08,2026-09,2026-10\nWidget,5,East,1,1,1\nWidget,5,West,1,1,1\n')
    result=run(file,[request('tools/call',{'name':'list_reorders','arguments':{'status':'all'}},id=1)])
    assert result.returncode != 0
    assert result.stdout == b''
    assert result.stderr, 'startup rejects ambiguous source before serving tools'


def test_demo_without_file_and_mutually_exclusive_sources():
    args = server.parser().parse_args(['--demo'])
    s = server.Snapshot(args)
    assert s.today == '2026-11-01'
    assert s.meta['source_kind'] == 'bundled_synthetic_sample'
    assert s.data['as_of'] == '2026-10-31'
    assert len(s.call('list_reorders', {'status':'all'})['items']) > 0
    for other in ('--csv', '--bundle'):
        with pytest.raises(SystemExit):
            server.parser().parse_args(['--demo', other, '/private/not-opened'])
    messages = [request('initialize', {'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{}}, False),
                dict(jsonrpc='2.0',method='notifications/initialized'), request('tools/list',modern=False),
                *[request('tools/call', {'name':name, 'arguments':args}, False, id=i+3)
                  for i,(name,args) in enumerate([('list_reorders', {'status':'all'}), ('explain_item', {'sku':s.rows[0]['sku']}), ('data_health', {})])]]
    result = subprocess.run([sys.executable,'-B',str(ROOT/'mcp_server.py'),'--demo'],
                            input=''.join(json.dumps(m)+'\n' for m in messages),capture_output=True,text=True)
    assert result.returncode == 0 and result.stderr == ''
    output = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(output) == 5 and all('error' not in response for response in output)
    assert output[0]['result']['serverInfo']['version'] == '1.3.0-beta'
    assert len(output[1]['result']['tools']) == 3
    for response in output[2:]:
        assert response['result']['structuredContent']['source_kind'] == 'bundled_synthetic_sample'


def test_risk_startup_names_incomplete_month_and_missing_incoming(tmp_path):
    path = tmp_path/'private-file.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,2026-09,2026-10,2026-11\nA,Synthetic,pieces,0,14,30,30,12\n')
    result = subprocess.run([sys.executable,'-B',str(ROOT/'mcp_server.py'),'--csv',str(path),'--today','2026-11-24'],capture_output=True,text=True)
    assert result.returncode == 1 and result.stdout == ''
    assert 'Latest month (2026-11) is still in progress' in result.stderr
    assert 'Incoming orders column missing or incomplete' in result.stderr
    assert '--show-orders-anyway' in result.stderr
    assert str(tmp_path) not in result.stderr and path.name not in result.stderr


def test_duplicate_startup_names_bounded_examples_and_escapes_paths(tmp_path):
    path = tmp_path/'private-file.csv'
    header = 'name,unit,on_hand,supplier_days,on_order,2026-08,2026-09,2026-10\n'
    path.write_text(header+''.join(f'{name},pieces,0,14,0,30,30,30\n' for name in ['Bolt M8','Bolt M8','Nut M8','Nut M8']))
    result = subprocess.run([sys.executable,'-B',str(ROOT/'mcp_server.py'),'--csv',str(path)],capture_output=True,text=True)
    assert result.returncode == 1 and result.stdout == ''
    assert 'Duplicate product names: "Bolt M8", "Nut M8"' in result.stderr
    assert str(tmp_path) not in result.stderr
    error = ValueError('Two rows share the name "/private/secret" and there is no product code column')
    assert '/private' not in server.safe_source_reason(error)
    error = ValueError('Two rows share the name "Bolt\x1b[31m" and there is no product code column')
    assert '\x1b' not in server.safe_source_reason(error)
    assert str(tmp_path) not in server.safe_source_reason(OSError(str(tmp_path)))
