"""Executable sample/document parity checks, not an implementation of phase 4–6."""
import csv
from decimal import Decimal
import importlib.util
from pathlib import Path
import re
import statistics

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT/'docs'/'data'
SAMPLES = ROOT/'samples'/'synthetic'


def records(name):
    with (SAMPLES/name).open(newline='',encoding='utf-8') as handle:
        return list(csv.DictReader(handle))


def glossary_terms():
    glossary = (DOCS/'AR-GLOSSARY.md').read_text()
    return {line.split('|')[1].strip().casefold() for line in glossary.splitlines()
            if line.startswith('|') and len(line.split('|'))>=4}


def test_spec_chips_are_short_and_have_arabic_drafts():
    spec=(DOCS/'ORDER-BUILDING-SPEC.md').read_text()
    table=spec.split('| Feature | Hidden when | Locked chip; condition | On chip; condition |')[1].split('\n\n')[0]
    terms=glossary_terms()
    chips=[]
    for line in table.splitlines():
        if not line.startswith('|') or '---' in line:
            continue
        cells=[cell.strip() for cell in line.split('|')[1:-1]]
        for value in cells[2:4]:
            chip=value.split(';')[0]
            assert 1<=len(chip.split())<=3
            assert chip.casefold() in terms,chip
            chips.append(chip)
    assert len(chips)==34
    assert 'draft' in (DOCS/'AR-GLOSSARY.md').read_text().lower()
    assert 'not access control' in spec
    assert 'not an implemented engine' in spec


def test_all_validator_chips_have_glossary_entries():
    module_path=ROOT/'data_contract'/'validate.py'
    spec=importlib.util.spec_from_file_location('doc_contract',module_path)
    assert spec and spec.loader
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    report=module.validate_bundle(SAMPLES,today='2026-11-01')
    terms=glossary_terms()
    for value in report['features'].values():
        assert value['chip'].casefold() in terms,value['chip']


def test_contract_names_every_accepted_column():
    text=(DOCS/'CONTRACT.md').read_text()
    spec=importlib.util.spec_from_file_location('columns_contract',ROOT/'data_contract'/'validate.py')
    assert spec and spec.loader
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for filename,(_,allowed,_) in module.TABLES.items():
        assert filename in text
        for field in allowed.split():
            assert f'`{field}`' in text,field
    assert text.count('ASSUMED')>20
    assert 'https://www.odoo.com/documentation/20.0/' in text


def test_documented_sample_facts_and_worked_arithmetic():
    stock={r['sku']:r for r in records('stock.csv')}
    master={r['sku']:r for r in records('product_master.csv')}
    history=[h for h in next(iter(stock.values())) if re.fullmatch(r'\d{4}-\d{2}',h)]
    assert history==['2025-11','2025-12']+[f'2026-{m:02d}' for m in range(1,11)]
    values={sku:sum(Decimal(r[m]) for m in history)*Decimal(master[sku]['unit_cost']) for sku,r in stock.items()}
    assert values=={'TILE-SAND':Decimal(14400),'TILE-OLD':Decimal(2304),
                    'TILE-GREY':Decimal(8640),'ADH-20':Decimal(2160),
                    'GROUT-5':Decimal(720),'EDGE-NEW':Decimal(160)}
    assert sum(values.values())==Decimal(28384)
    assert master['GROUT-5']['critical']=='true'
    assert master['TILE-OLD']['replaced_by']=='TILE-SAND'
    assert [Decimal(stock['EDGE-NEW'][m]) for m in history]==[0]*8+[4,8,12,16]
    assert statistics.mean([4,8,12,16])==10
    assert Decimal('.5')*10+Decimal('.5')*12==11
    # The classification example explicitly disables correction/lifecycle.
    assert Decimal(stock['TILE-SAND'][history[0]])+Decimal(stock['TILE-OLD'][history[0]])==144
    costs={s:Decimal(master[s]['unit_cost']) for s in master}
    cbm={s:Decimal(master[s]['cbm']) for s in master}
    kg={s:Decimal(master[s]['weight_kg']) for s in master}
    for sand, expected in [(48,(768,Decimal('1.44'),1440)),(60,(888,Decimal('1.68'),1680)),(72,(1008,Decimal('1.92'),1920))]:
        quantities={'TILE-SAND':sand,'TILE-GREY':24}
        assert tuple(sum(quantities[s]*metric[s] for s in quantities) for metric in (costs,cbm,kg))==expected
    wh={(r['sku'],r['warehouse']):Decimal(r['on_hand']) for r in records('warehouse_stock.csv')}
    state=next(r for r in records('stock_states.csv') if r['sku']=='TILE-SAND' and r['warehouse']=='MAIN')
    usable=wh['TILE-SAND','MAIN']-sum(Decimal(state[k]) for k in ['damaged','reserved','quarantine','returns'])
    assert usable==12 and usable+(wh['TILE-SAND','EAST']-48)==48
    assert 72-48==24
    links={r['target_sku']:Decimal(r['ratio']) for r in records('relationships.csv') if r['source_sku']=='TILE-SAND'}
    assert links['ADH-20']*120==30 and links['GROUT-5']*120==15
    leads=[]
    from datetime import date
    for r in records('receipts.csv'):
        leads.append((date.fromisoformat(r['received_date'])-date.fromisoformat(r['po_date'])).days)
        assert r['po_complete']=='true'
    assert leads==[20,25,30,35,45]
    rule=next(r for r in records('reorder_rules.csv') if r['sku']=='TILE-SAND')
    assert Decimal(rule['min_qty'])==12 and Decimal(rule['max_qty'])==120
    assert 4*30+24-Decimal(rule['min_qty'])==132
    assert 4*60+24-Decimal(rule['max_qty'])==144
