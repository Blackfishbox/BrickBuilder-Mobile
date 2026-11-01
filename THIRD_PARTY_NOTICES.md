# Third-party notices and license boundaries

The root [MIT license](LICENSE) covers independently authored first-party
application code and documentation, **not all bytes in this repository or a
compiled application**. A generated `.ts` file or compressed JavaScript payload
can still contain separately licensed data. Preserve these notices and the
original resource-specific legal texts when distributing source or builds.

## LDraw

Original authors retain their rights. Reviewed parts packages use CC BY 4.0;
the import/reference snapshots additionally include explicitly declared CC0
files and files offering a CC BY 4.0 option. This is not a declaration that
every existing LDraw file has the same license. Inspect original headers.

Retain authors, copyright/license notices, source links, original history and
the supplied legal texts; identify adaptations. No endorsement or trademark
license is implied. Detailed authors, sources, integrity evidence and scope:

- [Parts packages](artifacts/brickbuilder-mobile/docs/parts-licensing.md)
- [Import geometry](artifacts/brickbuilder-mobile/docs/import-geometry-licensing.md)
- [Mapping evidence](artifacts/brickbuilder-mobile/docs/bricklink-mapping-licensing.md)
- [LDraw contributor agreement](https://library.ldraw.org/documentation/licenses-and-legal/ldraworg-contributor-agreement)
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [CC0](https://creativecommons.org/publicdomain/zero/1.0/)

Original legal files also travel inside geometry packages; preserve them, not
only this summary.

## LDCad Shadow Library

Roland Melkert and contributors; original source:
https://github.com/RolandMelkert/LDCadShadowLibrary

Shadow connection data and covered adaptations remain **CC BY-SA 4.0**, not
MIT. Retain attribution and legal notices, identify changes and apply the
required share-alike terms to covered adaptations. Unrelated first-party code
is not automatically relicensed merely by consuming this separate dataset.

The compressed data modules retain original texts and source hashes.
Full upstream license, attribution, modification/coverage reports and associated
LDraw reference-graph notices ship in
[`public/licenses/connections/`](artifacts/brickbuilder-mobile/public/licenses/connections/).
The graph's LDraw records retain their own CC BY/CC0 terms.
See [connection-data provenance](artifacts/brickbuilder-mobile/docs/connections.md).

## Rebrickable catalog

Catalog IDs, descriptions, colors and mappings come from the approved public
CSV downloads: https://rebrickable.com/downloads/

Permission is assessed under https://rebrickable.com/terms/ (particularly 5.1
and 5.3), **not an invented MIT or CC BY license**. Preserve attribution, source
manifests and integrity hashes, and recheck terms for your distribution.
No MOC content, catalog images or proprietary Studio resources are supplied.
The terms prohibit use of Rebrickable content for AI-model training.
See the [catalog source and review record](artifacts/brickbuilder-mobile/docs/complete-catalog.md).

## Software dependencies

Runtime and build dependencies keep their own licenses. React, Three.js,
Dexie, Vite and other packages are not relicensed by the root license. Preserve
each applicable copyright/license/NOTICE file, including transitive dependency
notices. Review the actual production dependency tree for each release;
this summary is not an exhaustive dependency-license audit or a substitute
for individual package texts.

## Imported models, branding and proprietary resources

Importing a model does not grant permission to publish it or its instructions,
images or other embedded resources. Private uploads must stay out of Git and
deployment assets. Do not copy proprietary Studio code/resources.

LEGO, BrickLink, Studio, LDraw, LDCad and Rebrickable are names belonging to
their respective owners. No affiliation, endorsement or trademark grant is
implied. This project is independently developed.

This inventory documents technical provenance, not legal advice or a warranty
of complete rights clearance.
