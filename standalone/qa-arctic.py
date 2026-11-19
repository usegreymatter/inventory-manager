#!/usr/bin/env python3
"""Lifecycle: living. WCAG evidence for Arctic; never misreport pale fill contrast."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.scratch/brand'


def luminance(value):
    channels = [int(value[i:i+2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in channels]
    return .2126*r + .7152*g + .0722*b


def contrast(a, b):
    a, b = sorted([luminance(a), luminance(b)])
    return (b+.05)/(a+.05)


def evidence() -> dict:
    pairs = [('ink', '#0B1020', 7), ('muted', '#5B6274', 4.5),
             ('accent', '#3F5687', 4.5), ('status red', '#B42318', 4.5),
             ('order number', '#8E1B13', 7), ('watch text', '#805B00', 4.5),
             ('OK marker (not text)', '#2F7D6E', 3), ('demand boundary', '#5B6274', 3)]
    rows = [dict(name=name, foreground=colour, background=bg, minimum=minimum,
                 ratio=round(contrast(colour, bg), 3), passed=contrast(colour, bg) >= minimum)
            for name, colour, minimum in pairs for bg in ['#F5F8FD', '#E6ECF7']]
    rows.append(dict(name='primary button text', foreground='#F5F8FD', background='#3F5687',
                     minimum=4.5, ratio=round(contrast('#F5F8FD', '#3F5687'), 3),
                     passed=contrast('#F5F8FD', '#3F5687') >= 4.5))
    return dict(checks=rows, qualification={
        'demand_fill': '#AEB8CA is 1.877:1 on #F5F8FD, NOT 3:1. Full-opacity #5B6274 outlines provide 5.728:1 meaningful boundaries; the approved fill remains exact.',
        'key_numbers': '#B42318 is 6.176:1 on Arctic, below 7:1. The large urgent quantity uses the scoped dark-red ink #8E1B13 (8.517:1; 7.644:1 on selection). Status red remains #B42318.',
        'ok': '#2F7D6E is used for graphical OK/receipt markers, never text on selection (4.137:1 there). All status words use ink.',
        'logo': 'Official source has 14 st0 shapes and no st1 shapes; cleaned logo is #0B1020. Brand/logotype is exempt, not counted as UI text.'})


def main():
    result = evidence()
    assert all(row['passed'] for row in result['checks']), result
    OUT.mkdir(exist_ok=True)
    (OUT/'arctic-contrast.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
