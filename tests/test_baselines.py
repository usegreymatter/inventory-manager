"""Offline baseline provenance and fixture-first regression checks."""
import hashlib
import json
import unittest
from unittest import mock
from baseline import FIXTURES, read_baseline

class BaselineTests(unittest.TestCase):
    def test_all_vendored_bytes_match_manifest_without_git(self):
        manifest = json.loads((FIXTURES / 'manifest.json').read_text())
        self.assertEqual(len(manifest), 34)
        with mock.patch('baseline.subprocess.check_output', side_effect=AssertionError('git must not run')):
            for spec, expected in manifest.items():
                with self.subTest(spec=spec):
                    self.assertEqual(hashlib.sha256(read_baseline(spec)).hexdigest(), expected)
                    self.assertEqual(read_baseline(spec, text=True).encode(), read_baseline(spec))

    def test_unvendored_revision_falls_back_to_exact_git_spec(self):
        with mock.patch('baseline.subprocess.check_output', return_value=b'historical') as show:
            self.assertEqual(read_baseline('unvendored:engine.py'), b'historical')
            self.assertEqual(show.call_args.args[0], ['git', 'show', 'unvendored:engine.py'])

    def test_invalid_paths_are_rejected(self):
        for spec in ('../bad:engine.py', 'abc:../engine.py', 'abc:/engine.py'):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                read_baseline(spec)
