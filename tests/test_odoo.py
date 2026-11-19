"""Fake ServerProxy only: this suite cannot connect to Odoo."""
from pathlib import Path
import sys
import types
from datetime import date
from xmlrpc.client import Fault
import pytest

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType('stock_runway')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', package)
from stock_runway.sources import ALLOWED_FIELDS, ALLOWED_METHODS, OdooReadOnly, SourceError, _odoo_dataset, _SafeTransport
from stock_runway.engine import forecast, inventory_history


@pytest.mark.parametrize('fallback', [False, True])
def test_move_dozens_convert_to_product_units(fallback):
    factory = FakeProxyFactory(fallback=fallback)
    factory.data['stock.move'] = [movement(2, 41, 90, product_uom=[2, 'Dozens']),
                                  movement(1, 70, 41, '2026-11-02', product_uom=[2, 'Dozens'])]
    result = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    assert result['items'][0]['monthly_sales'][-1] == 24
    assert result['items'][0]['on_hand'] == 88
    move_calls = [kwargs for model, _, _, kwargs in factory.calls if model == 'stock.move']
    assert all('product_uom' in kwargs['fields'] for kwargs in move_calls)
    assert any(model == 'uom.uom' for model, *_ in factory.calls)


@pytest.mark.parametrize('bad_uom', [None, {'id': 2, 'factor': 0, 'category_id': [10, 'Units']},
    {'id': 2, 'category_id': [10, 'Units']}, {'id': 2, 'factor': 1, 'category_id': [99, 'Weight']}])
def test_unconvertible_uom_holds_item(bad_uom):
    factory = FakeProxyFactory()
    factory.data['stock.move'] = [movement(2, 41, 90, product_uom=[2, 'Dozens'])]
    factory.data['uom.uom'] = factory.data['uom.uom'][:1] + ([bad_uom] if bad_uom else [])
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    result = forecast(data['items'][0], data['months'], data['as_of'])
    assert result['held'] is True
    assert result['reason'] == 'Some moves use a unit that cannot be converted.'


def test_fractional_unit_conversion_does_not_round_stock_down_early():
    factory = FakeProxyFactory()
    factory.data['uom.uom'][1]['factor'] = 1000
    factory.data['stock.quant'][0]['quantity'] = 0.2
    factory.data['stock.move'] = [movement(708, 41, 90, '2026-11-02', product_uom=[2, 'g']),
                                  movement(92, 41, 90, '2026-11-03', product_uom=[2, 'g'])]
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    assert data['items'][0]['on_hand'] == 1
    assert forecast(data['items'][0], data['months'], data['as_of'])['stock'] == 1


def test_fractional_unit_conversion_does_not_round_demand_up_early():
    factory = FakeProxyFactory()
    factory.data['uom.uom'][1]['factor'] = 1000
    factory.data['stock.move'] = [movement(100, 41, 90, product_uom=[2, 'g']) for _ in range(30)]
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    assert data['items'][0]['monthly_sales'][-1] == 3
    assert forecast(data['items'][0], data['months'], data['as_of'])['monthly_demand'] == .25


def test_duplicate_odoo_sku_refused():
    factory = FakeProxyFactory()
    factory.data['product.product'].append({**factory.data['product.product'][0], 'id': 2})
    with pytest.raises(SourceError, match='Duplicate Odoo SKU: FAKE-A'):
        adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))


@pytest.mark.parametrize('args,kwargs', [
    ([], {}), ([[], []], {}), ([('id', '=', 1)], {}),
    ([[('partner_id', '=', 1)]], {}),
    ([['|', ('id', '=', 1), ('partner_id', '=', 2)]], {}),
    ([[]], {'order': 'name'}), ([[]], {'lazy': False}),
])
def test_call_blocks_unsafe_domains_args_and_options_before_transport(args, kwargs):
    class NeverTransport:
        def __getattr__(self, name):
            raise AssertionError('transport must not be reached')
    with pytest.raises(SourceError, match='not allowed'):
        OdooReadOnly()._call(NeverTransport(), 'stock.move', 'search_read', args, {'fields': ['quantity'], **kwargs})


def test_only_search_read_is_allowed():
    assert ALLOWED_METHODS == {'search_read'}
    assert ALLOWED_FIELDS['uom.uom'] == {'id', 'factor', 'category_id', 'parent_path'}


def test_xmlrpc_socket_timeout_and_transport_injection():
    transport = _SafeTransport()
    assert transport.make_connection('example.invalid').timeout == 30
    factory = FakeProxyFactory()
    injected = object()
    instance = adapter(factory)
    instance.transport_factory = lambda: injected
    original = factory.__call__
    seen = []
    def proxy(url, **kwargs):
        seen.append(kwargs['transport'])
        return original(url, **kwargs)
    instance.server_proxy_factory = proxy
    instance.load(['FAKE-A'], today=date(2026, 11, 8))
    assert seen == [injected, injected]


def test_method_allowlist_refuses_writes_before_transport():
    class NeverTransport:
        def __getattr__(self, name):
            raise AssertionError('transport must not be reached')
    adapter = OdooReadOnly(lambda name: 'fake-key')
    for method in ('create', 'write', 'unlink', 'fields_get'):
        with pytest.raises(SourceError, match='not allowed'):
            adapter._call(NeverTransport(), 'stock.move', method, [], {'fields': ['quantity']})


def test_field_allowlist_rejects_customer_fields():
    with pytest.raises(SourceError, match='field'):
        OdooReadOnly()._call(None, 'stock.move', 'search_read', [], {'fields': ['partner_id']})
    with pytest.raises(TypeError):
        ALLOWED_FIELDS['stock.move'] = set()


def movement(qty, src, dst, day='2026-10-03', **extra):
    return dict(product_id=[1, 'Fake'], product_uom=extra.pop('product_uom', [1, 'ea']), product_uom_qty=999, quantity=qty, date=day + ' 10:00:00', state='done', location_id=[src, 'Fake'], location_dest_id=[dst, 'Fake'], **extra)


def records():
    return {
        'product.product': [dict(id=1, name='Fake product', default_code='FAKE-A', uom_id=[1, 'ea'], product_tmpl_id=[11, 'Fake'])],
        'stock.location': [dict(id=41, usage='internal'), dict(id=42, usage='internal'), dict(id=90, usage='customer')],
        'stock.quant': [dict(product_id=[1, 'Fake'], quantity=100, location_id=[41, 'Fake'])],
        'stock.move': [movement(20, 41, 90), movement(3, 90, 42), movement(8, 70, 41),
                       movement(15, 70, 41, '2026-11-02'), movement(7, 41, 90, '2026-11-03'),
                       movement(4, 90, 41, '2026-11-04'), movement(50, 41, 42, '2026-11-05')],
        'product.supplierinfo': [dict(product_tmpl_id=[11, 'Fake'], product_id=False, delay=6)],
        'uom.uom': [dict(id=1, factor=1, category_id=[10, 'Units']), dict(id=2, factor=1 / 12, category_id=[10, 'Units'])],
    }


class FakeProxyFactory:
    def __init__(self, fallback=False, error=None):
        self.calls = []
        self.urls = []
        self.fallback = fallback
        self.error = error
        self.data = records()

    def __call__(self, url, **kwargs):
        self.urls.append(url)
        return self

    def authenticate(self, *args):
        return 7

    def execute_kw(self, db, uid, key, model, method, args, kwargs):
        assert key == 'fake-key'
        self.calls.append((model, method, args, kwargs))
        if self.error:
            raise self.error
        if self.fallback and model == 'stock.move' and 'quantity' in kwargs['fields']:
            raise Fault(1, "Invalid field 'quantity' on model stock.move")
        rows = self.data[model]
        if self.fallback and model == 'stock.move':
            rows = [{k: v for k, v in m.items() if k != 'quantity'} | {'product_uom_qty': m['quantity']} for m in rows]
        return rows


class Odoo19ProxyFactory(FakeProxyFactory):
    def __init__(self, root='1', **kwargs):
        super().__init__(**kwargs)
        self.data['uom.uom'] = [dict(id=1, factor=1, parent_path='1/'),
                                dict(id=5, factor=12, parent_path=f'{root}/5/')]

    def execute_kw(self, db, uid, key, model, method, args, kwargs):
        if model == 'uom.uom':
            # Archived units are invisible unless explicitly requested.
            if kwargs.get('context') != {'active_test': False}:
                return []
            if 'category_id' in kwargs['fields']:
                self.calls.append((model, method, args, kwargs))
                raise Fault(1, "Invalid field 'category_id' on model 'uom.uom'")
        return super().execute_kw(db, uid, key, model, method, args, kwargs)


@pytest.mark.parametrize('fallback', [False, True])
def test_odoo19_conversion_retries_category_field_and_includes_archived_units(fallback):
    factory = Odoo19ProxyFactory(fallback=fallback)
    factory.data['stock.move'] = [movement(2, 41, 90, product_uom=[5, 'Dozen']),
                                  movement(1, 70, 41, '2026-11-02', product_uom=[5, 'Dozen'])]
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    item = data['items'][0]
    assert item['monthly_sales'][-1] == 24
    assert item['on_hand'] == 88
    assert 'hold_reason' not in item
    calls = [kwargs for model, _, _, kwargs in factory.calls if model == 'uom.uom']
    assert [kwargs['fields'] for kwargs in calls] == [
        ['id', 'factor', 'category_id'], ['id', 'factor', 'parent_path']]
    assert all(kwargs['context'] == {'active_test': False} for kwargs in calls)
    assert all('context' not in kwargs for model, _, _, kwargs in factory.calls if model != 'uom.uom')


def test_odoo19_conversion_to_nonreference_product_unit():
    factory = Odoo19ProxyFactory()
    factory.data['product.product'][0]['uom_id'] = [5, 'Dozen']
    factory.data['stock.move'] = [movement(24, 41, 90)]
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    assert data['items'][0]['monthly_sales'][-1] == 2
    assert 'hold_reason' not in data['items'][0]


@pytest.mark.parametrize('root', ['9', '', None])
def test_odoo19_incompatible_or_missing_root_holds_item(root):
    factory = Odoo19ProxyFactory(root=root)
    if root is None:
        factory.data['uom.uom'][1]['parent_path'] = False
    factory.data['stock.move'] = [movement(2, 41, 90, product_uom=[5, 'Dozen'])]
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    item = forecast(data['items'][0], data['months'], data['as_of'])
    assert item['held'] is True
    assert item['reason'] == 'Some moves use a unit that cannot be converted.'


@pytest.mark.parametrize('day,src,dst', [
    ('2026-10-03', 41, 42), ('2026-11-03', 41, 42),
    ('2026-10-03', 70, 41), ('2025-10-03', 41, 90),
    ('2026-11-03', 70, 90),
])
def test_irrelevant_move_in_odd_unit_does_not_hold_item(day, src, dst):
    factory = FakeProxyFactory()
    factory.data['stock.move'].append(movement(2, src, dst, day, product_uom=[99, 'Odd']))
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    item = forecast(data['items'][0], data['months'], data['as_of'])
    assert item['held'] is False
    assert data['items'][0]['on_hand'] == 88
    assert data['items'][0]['monthly_sales'][-1] == 17


@pytest.mark.parametrize('model,fields,context', [
    ('stock.move', ['quantity'], {'active_test': False}),
    ('product.product', ['id'], {'active_test': False}),
    ('uom.uom', ['id'], {'active_test': True}),
    ('uom.uom', ['id'], {'active_test': 0}),
    ('uom.uom', ['id'], {'active_test': False, 'sudo': True}),
    ('uom.uom', ['id'], {}),
])
def test_context_is_refused_except_exact_archived_uom_option(model, fields, context):
    class NeverTransport:
        def __getattr__(self, name):
            raise AssertionError('transport must not be reached')
    with pytest.raises(SourceError, match='not allowed'):
        OdooReadOnly()._call(NeverTransport(), model, 'search_read', [[]],
                             {'fields': fields, 'context': context})


@pytest.mark.parametrize('factory_type', [FakeProxyFactory, Odoo19ProxyFactory])
@pytest.mark.parametrize('day,src,dst', [
    ('2026-10-03', 90, 41), ('2026-11-03', 70, 41), ('2026-11-03', 41, 70),
])
def test_relevant_return_or_rollback_in_odd_unit_holds_item(factory_type, day, src, dst):
    factory = factory_type()
    factory.data['stock.move'] = [movement(2, src, dst, day, product_uom=[99, 'Odd'])]
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    item = forecast(data['items'][0], data['months'], data['as_of'])
    assert item['held'] is True
    assert item['reason'] == 'Some moves use a unit that cannot be converted.'


def test_non_field_uom_fault_does_not_select_odoo19_or_retry():
    class DeniedUnits(FakeProxyFactory):
        def execute_kw(self, db, uid, key, model, method, args, kwargs):
            if model == 'uom.uom':
                self.calls.append((model, method, args, kwargs))
                raise Fault(1, 'Access denied reading category_id')
            return super().execute_kw(db, uid, key, model, method, args, kwargs)
    factory = DeniedUnits()
    with pytest.raises(SourceError, match='could not return'):
        adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    assert sum(model == 'uom.uom' for model, *_ in factory.calls) == 1


def test_archived_uom_option_allowed_on_legacy_schema_only_for_units():
    factory = FakeProxyFactory()
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    assert data['items'][0]['monthly_sales'][-1] == 17
    calls = [kwargs for model, _, _, kwargs in factory.calls if model == 'uom.uom']
    assert len(calls) == 1
    assert calls[0]['fields'] == ['id', 'factor', 'category_id']
    assert calls[0]['context'] == {'active_test': False}


def adapter(factory, url='https://example.invalid'):
    values = dict(ODOO_URL=url, ODOO_DB='fake-db', ODOO_USER='fake-user', ODOO_API_KEY='fake-key')
    return OdooReadOnly(values.get, server_proxy_factory=factory)


def test_odo_dataset_derives_period_end_by_rolling_back_later_moves():
    d = records()
    result = _odoo_dataset(d['product.product'], d['stock.move'], d['stock.quant'], d['stock.location'], d['product.supplierinfo'], uoms=d['uom.uom'], today=date(2026, 11, 8))
    item = result['items'][0]
    assert result['as_of'] == '2026-10-31'
    assert item['monthly_sales'][-1] == 17  # 20 sales minus 3 returns; supplier receipt excluded
    assert item['on_hand'] == 88  # 100 - 15 + 7 - 4; internal transfer nets zero
    assert item['supplier_days'] == 6
    assert item['receipts'] == {}


@pytest.mark.parametrize('fallback', [False, True])
def test_odoo_load_uses_injected_proxy_and_safe_domains(fallback):
    factory = FakeProxyFactory(fallback=fallback)
    result = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    assert result['items'][0]['on_hand'] == 88
    assert result['items'][0]['monthly_sales'][-1] == 17
    assert len(factory.urls) == 2
    for model, method, args, kwargs in factory.calls:
        assert method == 'search_read'
        assert set(kwargs['fields']) <= ALLOWED_FIELDS[model]
        if model == 'product.product':
            assert ('default_code', 'in', ['FAKE-A']) in args[0]
        if model == 'stock.move':
            assert ('product_id', 'in', [1]) in args[0]
            assert ('date', '>=', '2025-11-01 00:00:00') in args[0]
    if fallback:
        assert sum(model == 'stock.move' for model, *_ in factory.calls) == 2


@pytest.mark.parametrize('skus', [None, [], ['X'] * 51, [None]])
def test_sku_bound_before_secrets_or_transport(skus):
    def never(*args, **kwargs):
        raise AssertionError('must not be reached')
    with pytest.raises(SourceError, match='1 to 50'):
        OdooReadOnly(never, never).load(skus)


@pytest.mark.parametrize('url', ['http://example.invalid', 'https://fake-user:fake-key@example.invalid', 'https://example.invalid?key=fake-key', 'https:///missing', 'https://example.invalid:bad'])
def test_https_only_before_transport(url):
    factory = FakeProxyFactory()
    with pytest.raises(SourceError, match='HTTPS'):
        adapter(factory, url).load(['FAKE-A'])
    assert factory.urls == []


def test_safe_errors_do_not_echo_url_or_records():
    factory = FakeProxyFactory(error=Fault(1, 'https://example.invalid private record fake-key'))
    with pytest.raises(SourceError) as exc:
        adapter(factory).load(['FAKE-A'])
    assert str(exc.value) == 'Odoo could not return the requested inventory data.'
    assert len(factory.calls) == 1  # arbitrary faults do not trigger fallback


def test_zero_supplier_days_unknown_and_negative_net_is_not_silently_filled():
    d = records()
    d['product.supplierinfo'][0]['delay'] = 0
    d['stock.move'].append(movement(40, 90, 41))
    result = _odoo_dataset(d['product.product'], d['stock.move'], d['stock.quant'], d['stock.location'], d['product.supplierinfo'], uoms=d['uom.uom'], today=date(2026, 11, 8))
    assert result['items'][0]['supplier_days'] is None
    assert result['items'][0]['monthly_sales'][-1] == -23


@pytest.mark.parametrize('version19', [False, True])
def test_incoming_history_category_and_sales_rollback_unchanged(version19):
    factory = FakeProxyFactory()
    factory.data['stock.location'].append(dict(id=70, usage='supplier'))
    factory.data['product.product'][0]['categ_id'] = [5, 'Synthetic / Underlay']
    factory.data['stock.move'] = [movement(2, 41, 90), movement(1, 90, 41),
        movement(2, 70, 41, product_uom=[2, 'Dozens']),
        movement(3, 70, 41, '2026-11-02'), movement(9, 70, 41, state_override='unused')]
    factory.data['stock.move'][-1]['state'] = 'draft'
    # Direct fake-data path covers both UoM conventions without transport/network.
    units = factory.data['uom.uom']
    if version19:
        units = [dict(id=1, factor=1, parent_path='1/'), dict(id=2, factor=12, parent_path='1/2/')]
    data = _odoo_dataset(factory.data['product.product'], factory.data['stock.move'], factory.data['stock.quant'],
        factory.data['stock.location'], uoms=units, uom19=version19, today=date(2026, 11, 8))
    item = data['items'][0]
    assert item['historical_receipts']['2026-10'] == 24
    assert sum(item['historical_receipts'].values()) == 24
    assert item['monthly_sales'][-1] == 1
    assert item['on_hand'] == 97
    assert item['category'] == 'Synthetic / Underlay'
    assert item['receipts'] == {}


@pytest.mark.parametrize('has_vendor', [False, True])
def test_receipt_coverage_requires_vendor_but_known_zero_deliveries_are_complete(has_vendor):
    factory = FakeProxyFactory()
    # Keep sales, returns and rollback; omit only the historical incoming move.
    factory.data['stock.move'].pop(2)
    baseline = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    if has_vendor:
        factory.data['stock.location'].append(dict(id=70, usage='supplier'))
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    item = data['items'][0]
    assert item['monthly_sales'][-1] == 17
    assert item['on_hand'] == 88
    assert forecast(item, data['months'], data['as_of']) == forecast(baseline['items'][0], baseline['months'], baseline['as_of'])
    if has_vendor:
        assert item['historical_receipts'] == dict.fromkeys(data['months'], 0)
        assert len(inventory_history(item, data['months'])['rows']) == 12
    else:
        assert 'historical_receipts' not in item
        assert inventory_history(item, data['months']) == {'rows': [], 'warning': 'Add delivery history to see past inventory.'}


@pytest.mark.parametrize('factory_type', [FakeProxyFactory, Odoo19ProxyFactory])
@pytest.mark.parametrize('bad_move', [
    movement(2, 70, 41, product_uom=[999, 'Unknown']),
    movement(-1, 70, 41), movement(float('nan'), 70, 41),
    movement(float('inf'), 70, 41), movement('invalid', 70, 41),
])
def test_bad_incoming_history_does_not_hold_forecast_and_bounded_fetch_has_category(factory_type, bad_move):
    factory = factory_type()
    factory.data['stock.location'].append(dict(id=70, usage='supplier'))
    baseline = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    # Include a valid receipt before and after the bad one: never publish a partial map.
    factory.data['stock.move'].extend([bad_move, movement(4, 70, 41)])
    data = adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
    item = data['items'][0]
    assert 'hold_reason' not in item
    assert 'historical_receipts' not in item
    assert item['monthly_sales'] == baseline['items'][0]['monthly_sales']
    assert item['on_hand'] == baseline['items'][0]['on_hand'] == 88
    actual = forecast(item, data['months'], data['as_of'])
    assert not actual['held']
    assert actual == forecast(baseline['items'][0], baseline['months'], baseline['as_of'])
    assert inventory_history(item, data['months']) == {'rows': [], 'warning': 'Add delivery history to see past inventory.'}
    assert all('categ_id' in kw['fields'] for model, _, _, kw in factory.calls if model == 'product.product')
    assert len([1 for model, *_ in factory.calls if model == 'stock.move']) == 2  # one per load


@pytest.mark.parametrize('day,src,dst', [
    ('2026-10-03', 41, 90), ('2026-10-03', 90, 41), ('2026-11-03', 70, 41),
])
@pytest.mark.parametrize('quantity', [-1, float('nan'), float('inf')])
def test_invalid_sales_returns_and_rollback_quantities_still_error(day, src, dst, quantity):
    factory = FakeProxyFactory()
    factory.data['stock.location'].append(dict(id=70, usage='supplier'))
    factory.data['stock.move'].append(movement(quantity, src, dst, day))
    with pytest.raises(SourceError, match='invalid move quantities'):
        adapter(factory).load(['FAKE-A'], today=date(2026, 11, 8))
