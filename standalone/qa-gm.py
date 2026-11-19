#!/usr/bin/env python3
"""Local screenshot colour/contrast evidence; requires existing Pillow, no installs."""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.scratch/brand'


def luminance(value):
    channels = [int(value[i:i+2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in channels]
    return .2126*r + .7152*g + .0722*b


def contrast(a, b):
    a, b = sorted([luminance(a), luminance(b)])
    return (b+.05)/(a+.05)


def main():
    OUT.mkdir(exist_ok=True)
    pairs = [('ink', '#070707'), ('secondary', '#5A5F68'), ('accent', '#3F5687'),
             ('order', '#B42318'), ('ok', '#2F7D6E'), ('watch', '#805B00')]
    results = [dict(name=name, foreground=colour, background=bg,
                    ratio=round(contrast(colour, bg), 3), aa=contrast(colour, bg) >= 4.5)
               for name, colour in pairs for bg in ['#FFFFFF', '#F5F6F8']]
    results.append(dict(name='primary button', foreground='#FFFFFF', background='#3F5687',
                        ratio=round(contrast('#FFFFFF', '#3F5687'), 3), aa=contrast('#FFFFFF', '#3F5687') >= 4.5))
    assert all(row['aa'] for row in results), results
    (OUT/'contrast.json').write_text(json.dumps(results, indent=2)+'\n')
    # Approximate deuteranopia channel matrix, applied to the actual screenshot.
    # Not a diagnostic simulation or a substitute for human colour-vision testing.
    matrix = (.625,.375,0,0, .7,.3,0,0, 0,.3,.7,0)
    simulations = []
    for size in ['1440x900', '390x844']:
        source = OUT/f'option-gm-b-{size}-en.png'
        target = OUT/f'option-gm-b-{size}-en-deuteranopia.png'
        Image.open(source).convert('RGB').convert('RGB', matrix).save(target)
        simulations.append(dict(source=str(source), output=str(target),
                                source_sha256=hashlib.sha256(source.read_bytes()).hexdigest()))
    overview = [('option-a3', 'Original A3'), ('option-gm-a', 'A · Quiet'),
                ('option-gm-b', 'B · Status-led'), ('option-gm-c', 'C · Brand type')]
    for size, tile in [('1440x900', (720,450)), ('390x844', (390,844))]:
        sheet = Image.new('RGB', (4*tile[0],tile[1]+40), '#FFFFFF')
        draw = ImageDraw.Draw(sheet)
        for i, (variant, title) in enumerate(overview):
            image = Image.open(OUT/f'{variant}-{size}-en.png').convert('RGB')
            image = image.resize(tile, Image.Resampling.LANCZOS)
            sheet.paste(image, (i*tile[0],40));draw.text((i*tile[0]+16,12),title,fill='#070707')
            draw.line([(i*tile[0],0),(i*tile[0],sheet.height)],fill='#E4E6EA')
        sheet.save(OUT/f'comparison-{size}-en.png')
    browser = json.loads((OUT/'brand-browser-report.json').read_text())
    canonical = []
    baseline = (OUT/'option-a3-calculated-numbers.json').read_bytes()
    for variant, _ in overview[1:]:
        after = (OUT/f'{variant}-calculated-numbers.json').read_bytes()
        assert baseline == after
        canonical.append(dict(variant=variant, changed_fields=0, sha256=hashlib.sha256(after).hexdigest()))
    evidence = dict(contrast=results, deuteranopia=dict(method='Simple approximate RGB channel matrix; shapes/words retain meaning', matrix=matrix, images=simulations),
                    numeric=dict(complete_calculated_rows=canonical, visible_number_dump_states=len(browser['numeric']),
                                 raw_visible_token_difference_states=len(browser['raw_number_differences']),
                                 qualification='Full-year/relative/date labels intentionally add displayed numeric tokens. Raw visible token lists are NOT byte-identical; complete guidance, every rendered stock/demand/receipt value and quantities are identical.'))
    (OUT/'brand-colour-numeric-report.json').write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
