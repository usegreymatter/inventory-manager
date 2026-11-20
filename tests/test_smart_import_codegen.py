"""Codegen separators must not depend on an authored file's EOF blank lines."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_workbook_codegen_normalizes_eof_without_changing_embedded_bytes(tmp_path):
    spec = importlib.util.spec_from_file_location('sync_workbook_eof', ROOT / 'scripts/sync_smart_import.py')
    assert spec is not None and spec.loader is not None
    sync = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sync)
    expected = sync.generated()
    source = (ROOT / 'desktop/smart-import.js').read_text()
    (tmp_path / 'desktop').mkdir()
    (tmp_path / 'smart-import-vocabulary.json').write_bytes((ROOT / 'smart-import-vocabulary.json').read_bytes())
    setattr(sync, 'ROOT', tmp_path)
    for suffix in ('\n', '\n\n', '\n\n\n'):
        (tmp_path / 'desktop/smart-import.js').write_text(source.rstrip('\n') + suffix)
        assert sync.generated() == expected
