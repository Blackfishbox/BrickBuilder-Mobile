# Complete published mapping catalog

## Scope and evidence

BrickBuilder consumes **all rows** of the public Rebrickable `parts`, `colors`,
`part_mappings` and `color_mappings` CSV downloads, not a hand-picked list.
This means the complete published source snapshot, **not every part ever made,
not the entire BrickLink catalog, and not a guaranteed counterpart in LDraw**.
The source catalogs have different coverage, variants, assemblies and aliases.

Snapshot: `2026-11-01.1`, reviewed on 2026-11-01.

| Source | Complete source rows |
| --- | ---: |
| parts.csv | 64,914 |
| colors.csv | 275 |
| part_mappings.csv | 183,263 |
| color_mappings.csv | 846 |

All external systems and both direction flags remain in the snapshot and
catalog search, including records without LDraw or BrickLink counterparts.
Nothing is filled in by matching numeric identifiers, stripping variant suffixes
or borrowing a similar printed part.

### Directional resolution

A usable LDraw-to-BrickLink candidate requires:

1. An explicit `LD` mapping whose `is_import_id` is true.
2. The same **Rebrickable** parent identifier.
3. An explicit `BL` mapping whose `is_export_id` is true.

Import-only BL aliases are searchable evidence but are not selected as output
numbers. Output-only LD identifiers are not silently accepted as import aliases.
Names and RGB values never establish identifier equivalence.

Source-only coverage after those direction rules:

| LDraw import identifiers | Unique BL target | Multiple BL targets | No BL target | Total |
| --- | ---: | ---: | ---: | ---: |
| Parts | 14,401 | 0 | 193 | 14,594 |
| Colors | 206 | 3 | 8 | 217 |

These denominators are **source LDraw import IDs**, not all Rebrickable records
and not geometry-availability counts. Rebrickable records without an eligible
LD mapping remain searchable but cannot be made into LDraw geometry by this
catalog. The UI shows these actual counts and the source checksums.

Existing independently proven LDraw keywords, package evidence and saved
evidence are merged, not replaced. They can increase coverage or expose a
conflict beyond the source-only figures above. A single distinct target ID is
confirmed; several remain ambiguous and no target is selected; zero is unknown.
Evidence survives JSON validation even if property ordering changes.

## Licensing and provenance

Sources:

- https://rebrickable.com/downloads/
- https://rebrickable.com/terms/ (sections 5.1 and 5.3 reviewed 2026-11-01)

The downloads page permits personal and commercial catalog use with source
acknowledgment. The terms explicitly describe full catalog downloads and exempt
that downloads route from the scraping prohibition. This implementation uses
only those CSV downloads, not an API bulk crawl, MOC data, images, or proprietary
Studio resources. Attribution is displayed in the app and retained in projects.
This is a source-terms assessment, not legal advice or a claim that the CSV
catalog is CC BY licensed. `Rebrickable-Attribution` distinguishes its permission
from the separately licensed CC BY/CC0 LDraw geometry.

Each source has its exact compressed-byte SHA-256, decoded-byte SHA-256, row
count and columns pinned in the generated descriptors. The complete raw files
and compact derived snapshot are retained outside Git in existing App Storage;
the checked-in generator and small descriptors reproduce and audit them.

## Processing, offline storage and project safety

The 2,180,181-byte gzip payload is transported as `application/octet-stream`
without HTTP Content-Encoding. It is checked against a pinned SHA-256 before
decompression, schema/foreign-key/direction validation and indexing in a Web
Worker. The complete table search also runs in that worker. Only compact indexes
and bounded search results cross to the UI; large CSV parsing is not done on the
main thread.

Verified compressed bytes persist in IndexedDB. Later starts and local searches
need no catalog network request. Worker code is included in the PWA precache.
An unavailable or corrupt catalog never silently claims complete coverage:
the app shows an error and retry action while retaining older verified evidence.
Corrupt cached bytes are rejected and can be downloaded again. Quota failures
are explicit; no offline-ready state is announced before the cache is committed.

Imports wait for catalog initialization. Saved projects are re-enriched on
opening and when a catalog retry succeeds, including undo/redo snapshots.
Transforms, instance IDs, source sections and original archives are untouched.
Shared historical instances reuse derived metadata rather than duplicating the
complete model for each undo entry. Unknown and conflicting evidence persists.

The active palette uses LDraw appearances first, independently of BL evidence.
Additional explicit LD color references may use Rebrickable RGB; when only
`is_trans` exists, 128 alpha is an approximation and is labeled in provenance,
not a promise of Studio material fidelity. All 275 source color records are
searchable, including colors with no usable LDraw representation. Such entries
do not receive fabricated LDraw codes. Control codes 16/24 remain controls.

## Reproduce an explicitly reviewed update

From the repository root, using the tested Linux/Python gzip toolchain:

```sh
python scripts/build-mapping-catalog.py --download --version YYYY-MM-DD.N
# Review terms, schemas, full row counts, aliases/conflicts and reference imports.
python scripts/build-mapping-catalog.py --version YYYY-MM-DD.N --approve
python scripts/test_mapping_catalog.py
pnpm --filter @workspace/brickbuilder-mobile test
pnpm --filter @workspace/brickbuilder-mobile typecheck
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile build
```

The first command writes only under ignored `generated-artifacts/`; it does not
change approved application data. `--approve` deliberately updates both small
frontend/backend descriptors. Never run approval automatically during ordinary
app builds. Review and update the terms-review statement when conditions change.
Compression reproducibility assumes the same Python/zlib toolchain; semantic
data and original source hashes remain independently checkable.

To upload the approved payload and source files to the already configured
App Storage bucket using the existing service identity:

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/publish-catalog.ts
```

This verifies stored bytes and does **not deploy the application**. A hosting
operator can instead serve the binary as a static file at the exact URL in the
frontend manifest; see the hosting guide. No Rebrickable API key is needed.

## Verification

Tests cover all published rows, deterministic rebuilding from the four complete
files, foreign keys, direction flags, checksum, exact variants, retained prior
evidence, ambiguity, unknown mappings, palette appearance, internal JSON and
source-preserving enrichment of the locally supplied IO references. Private
fixtures are optional and never committed; download-dependent full-snapshot
tests skip explicitly when their generated input is absent. Ordinary synthetic
tests still run without network access.

Mobile browser verification covers actual worker loading, catalog search,
source-preserving import/reopen and cached-data operation. It is not physical
Android certification or a production airplane-mode claim.

### Recorded verification, 2026-11-01

- Frontend: 115 passing tests, two optional fixture tests explicitly skipped.
  Backend: eight passing tests. Generator: three passing tests against the full
  downloaded sources, including reproduction of the approved descriptor.
- Frontend/backend TypeScript checks and production frontend/API builds passed.
  The production service worker precaches the catalog worker along with the app.
- Actual same-origin preview delivery matched the exact pinned 2,180,181 bytes
  and SHA-256, not just the local generator output.
- At 402×874, the supplied 57-instance Studio model imported and reopened with
  57 confirmed mapping references and zero import warnings. White, Dark Green,
  Pearl Gold and Dark Grey remained distinct. The original 183,140 archive
  bytes compared byte-for-byte with the input in IndexedDB; 66 resources remained.
  Unit tests also compare original references, matrices and raw color codes.
- Reloading with the catalog endpoint blocked used the saved catalog with zero
  catalog network requests. Part and color searches still worked with the
  browser network set offline after loading.
- The verification browser lacked WebGL and used the existing compatibility
  renderer (11,367 of 13,426 triangles displayed). This verifies catalog and
  project persistence, **not full mobile GPU rendering or performance**.
