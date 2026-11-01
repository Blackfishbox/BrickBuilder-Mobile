# LDraw packages: source and license review

Reviewed 2026-10-31. This documents a technical license review against original
sources, not legal advice or a warranty. Only official LDraw files with explicit
`CC BY 4.0` headers are used. No Studio/BrickLink resources, unofficial parts or
files with unclear/mixed licensing.

## Packages

| Package | Snapshot | LDraw part numbers | License |
| --- | --- | --- | --- |
| `ldraw-bricks` (German UI: Steine) | 2026-10-31 | 3001, 3002, 3003, 3004, 3005, 3006 | CC BY 4.0 |
| `ldraw-plates` (German UI: Platten) | 2026-10-31 | 3020, 3021, 3022, 3023, 3024, 3710 | CC BY 4.0 |

Source for each package: <https://library.ldraw.org/library/official/>.
Packages include the full recursive dependency closure of selected parts
(subparts and primitives). Shared primitives are intentionally included in each
package so that neither requires another package.

Bricks authors: James Jessiman; Niels Karsdorp [nielsk]; Steffen [Steffen];
Owen Burgoyne [C3POwen]; Tore Eriksson [Tore_Eriksson]; Willy Tschager [Holly-Wood].

Plates authors: James Jessiman; Orion Pobursky [OrionP]; Massimo Maso [Sirio];
Tore Eriksson [Tore_Eriksson]; Steffen [Steffen].

Each file also records its specific source URL, author, license identifier and
unchanged original content including `!HISTORY` credits. All original files
remain unchanged; only selection, JSON packaging and search metadata are by
BrickBuilder. No endorsement by LDraw.org, LEGO or BrickLink is claimed.
Trademark rights are not part of the CC license.

## Authoritative sources and obligations

- [Contributor Agreement](https://library.ldraw.org/documentation/licenses-and-legal/ldraworg-contributor-agreement):
  current submissions use CC BY 4.0 or optionally CC0. The individual file's
  header is still decisive, not this rule alone.
- [CAreadme.txt](https://library.ldraw.org/library/official/CAreadme.txt):
  requires author, work URL, license name/URL and identification of changes.
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):
  permits copying and redistribution, including commercial use, subject to
  attribution requirements and without additional restrictions.
- [Full license text](https://library.ldraw.org/library/official/CAlicense4.txt).

`CAreadme.txt` and `CAlicense4.txt` are embedded in every package and stored in
IndexedDB with the files, allowing offline reading after installation.
The UI shows authors, source/license links and change identification per package.

## Update procedure

`node artifacts/brickbuilder-mobile/scripts/build-parts-packages.mjs`
downloads official sources only and aborts on unknown license headers or
missing dependencies. It does **not** run automatically during app builds.
Before a new snapshot, adjust the version date, review licensing/credits and
commit generated packages together with `src/features/parts/catalog.json`.
All current files use CC BY 4.0. The validator also recognizes CC0 for future,
separately reviewed extensions, which must include appropriate legal documents.

SHA-256 and byte length in the bundled catalog pin the reviewed snapshot.
The client accepts only those exact bytes, validates metadata, license headers
and complete dependencies, then writes atomically to IndexedDB. Network,
checksum or quota failures leave any existing installation unchanged.
A failed package is not marked installed.
