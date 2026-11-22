"""Shelf settings are inert ordinary settings until the shelf-cap lane integrates."""
import unittest
import engine


class PresetStorageTests(unittest.TestCase):
    def test_optional_shelf_fields_round_trip_without_adding_defaults(self):
        shelf = dict(shelf_life_days=14, arrival_age_days=2, min_remaining_life_days=2)
        defaults = engine.normalize_order_settings({})
        for key in shelf:
            self.assertNotIn(key, defaults)
        result = engine.validate_order_settings(shelf)
        for key, value in shelf.items():
            self.assertEqual(result[key], value)
        self.assertEqual(engine.validate_order_settings(result), result)

    def test_invalid_shelf_fields_fail_closed(self):
        for settings in [dict(shelf_life_days=0), dict(arrival_age_days=-1),
                         dict(min_remaining_life_days=1.5), dict(shelf_life_days=True)]:
            with self.assertRaises(ValueError):
                engine.validate_order_settings(settings)
