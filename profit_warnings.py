"""Presentation-only caveats; never mutate or recompute profit/order quantities.

Mirrored by desktop/profit-warnings.js outside the protected planning core.
"""
import math

WEEKLY_WARNING = ('Profit suggestion is less reliable with weekly ordering or deliveries already on the way — '
                  'in tests it filled less demand. Use the standard amount if running out is costly.')


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def profit_suggestion_warning(item, guidance, review_days=30):
    """Warn only beside an available opt-in suggestion; use effective cadence."""
    suggestion = guidance.get('profit_suggestion')
    if not isinstance(suggestion, dict):
        return ''
    warnings = []
    incoming = item.get('on_order')
    if (_number(review_days) and review_days < 30) or (_number(incoming) and incoming > 0):
        warnings.append(WEEKLY_WARNING)
    return ' '.join(warnings)
