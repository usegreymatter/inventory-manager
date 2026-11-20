# Third-party notices

The code in this repository is MIT-licensed ([LICENSE](LICENSE)). No third-party code is vendored. The Python engine uses only the standard library; the offline page has no runtime JavaScript dependencies. Development-only tools (Playwright, Chromium, esbuild) are not included.

## Embedded fonts

Only the `option-gm-c` variant embeds Poppins and Tajawal: `standalone/design/fonts-gm.css` contains subsets as base64 WOFF2, inlined into that variant's built HTML. The shipped Arctic (`option-gm-b`) page, its synthetic demos and all other variants use system fonts and do not embed these font files.

| Font | Copyright | License |
|---|---|---|
| Poppins (400, 600) | Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins) | SIL Open Font License 1.1 |
| Tajawal (400, 500) | (c) 2017 by Boutros International. All rights reserved. | SIL Open Font License 1.1 |

The full SIL Open Font License 1.1 is included locally in [LICENSES/OFL-1.1.txt](LICENSES/OFL-1.1.txt) (official reference: <https://openfontlicense.org/open-font-license-official-text/>). Copyright lines above match the embedded WOFF2 name-table metadata for both weights of each font. The fonts are renamed in CSS (`GM Poppins`, `GM Tajawal`) and subset; they are not sold separately. Every built HTML includes the MIT license and this notice. Only outputs embedding `@font-face` also carry the font copyright notice and full OFL text. Keep the OFL license and this notice alongside redistributed `option-gm-c` HTML or embedded font files; system-font outputs do not require the OFL license.

## Name and logo

The "by GreyMatter" wordmark, `standalone/design/logo-gm.svg` and its byte-identical README copy `docs/img/greymatter-logo.svg` are the maintainer's brand marks. They are not covered by the MIT license; forks should replace them.
