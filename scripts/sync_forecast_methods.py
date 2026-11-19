#!/usr/bin/env python3
"""Refresh the dependency-free method twin embedded in the Desktop pure core."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
START = '// FORECAST_METHOD_LIBRARY_START\n'
END = '// FORECAST_METHOD_LIBRARY_END\n'


def embedded():
    source = (ROOT / 'forecast_methods.js').read_text()
    return (START + 'const StockRunwayForecastMethods = (() => {\nconst module = {exports:{}};\n' + source +
            '\nreturn module.exports\n})();\nglobalThis.StockRunwayForecastMethods = StockRunwayForecastMethods;\n' + END)


def main():
    path = ROOT / 'desktop/plugin.js'
    source = path.read_text()
    if START in source:
        before, rest = source.split(START)
        _, after = rest.split(END)
        source = before + embedded() + after
    else:
        source = source.replace('export function demandModel', embedded() + '\nexport function demandModel', 1)
    path.write_text(source)
    print('Embedded exact forecast_methods.js in Desktop core')


if __name__ == '__main__':
    main()
