# BrickLink part numbers: evidence and licensing

## Separate dataset

`ldraw-explicit-bricklink`, version `2026-10-31.1`, is versioned independently
of app code and geometry. Its eight records are an edited selection of explicit
`0 !KEYWORDS BrickLink …` lines in official LDraw files, not a copy of the
BrickLink catalog or Studio database. Extraction, name whitespace normalization
and variant notes: BrickBuilder. Names are **LDraw descriptions**, not confirmed
BrickLink catalog names. No market prices or live availability are fetched.

The selection and derived descriptions are licensed under **CC BY 4.0**:
https://creativecommons.org/licenses/by/4.0/
This license covers the dataset, not automatically the app code.
Authors are retained per record. Complete original files with histories,
`CAreadme.txt` and `CAlicense4.txt` are in the shipped, hash-pinned import
geometry package. The import report stores authors, source URLs, verbatim
evidence lines, original-file SHA-256, license, dataset ID and version in the
project. URLs may change; the reviewed snapshot is authoritative.
No endorsement by LDraw, BrickLink or LEGO is claimed.

## Evidenced selection

| LDraw | BrickLink | LDraw description / variant |
| --- | --- | --- |
| 3023a | 3023old | Plate 1 x 2 with Flat Pin |
| 3023b | 3023 | Plate 1 x 2 |
| 3069b | 3069 | Tile 1 x 2 with Groove |
| 3070b | 3070 | Tile 1 x 1 with Groove |
| 4032a | 4032 | Plate 2 x 2 Round with Axlehole |
| 60897 | 4085d | Plate 1 x 1 with Clip Vertical (Thick C-Clip) |
| 6141 | 4073 | Plate 1 x 1 Round |
| 73587p01 | 4592c02 | Hinge Control Stick Base with Black Control Stick |

Each record links to
`https://library.ldraw.org/library/official/parts/<LDraw-ID>.dat`.
Hashes and authors are tested against the existing snapshot. This initial
dataset verifies **8 of 74** distinct reference parts; the remaining **66 stay
unconfirmed**, even if their numbers look identical. All Studio IDs remain
unconfirmed.

## Conflicts, packages and reopening

Only letter case and `.dat` are normalized; suffixes, assemblies, prints and
paths are not merged. Multiple records with the same BrickLink ID do not imply
ambiguity; different IDs for the exact same LDraw reference do. All candidates
stay visible without preferring the first source or installation order.
Geometry resolution and ID mapping are independent.

Installable library packages can use the existing `LibraryPart` interface's
optional `mappings` field. Validation requires the exact original keyword,
author, license, URL and source hash; old unsubstantiated `brickLinkId` fields
are not accepted as evidence. The dataset is bundled and needs no separate
network request.

JSON backup, autosave and reopening retain the evidence version and conflicts
offline. Existing projects are not retroactively rewritten with new mappings;
a new source import uses the current dataset.
