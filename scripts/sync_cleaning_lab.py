#!/usr/bin/env python3
"""Embed the exact existing JS lab in the SDK-free Desktop/standalone core.

No dependency install or separate formula: the guarded source is forecast_lab.js.
Run before standalone/build.py if that source changes.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
START = '/* STOCK_RUNWAY_CLEANING_LAB_START */\n'
END = '/* STOCK_RUNWAY_CLEANING_LAB_END */\n'


def block():
    return START + 'const STOCKOUT_LAB = (() => {\nconst module = {exports: {}};\n' + (ROOT/'forecast_lab.js').read_text() + '\nreturn module.exports\n})()\n' + END


def main():
    path=ROOT/'desktop/plugin.js';source=path.read_text()
    if START in source:
        a=source.index(START);b=source.index(END,a)+len(END)
        source=source[:a]+block()+source[b:]
    else:
        anchor='// Pure helpers are exercised directly by Node without a desktop runtime.'
        assert source.count(anchor)==1
        source=source.replace(anchor,block()+'\n'+anchor)
    path.write_text(source)


if __name__=='__main__':main()
