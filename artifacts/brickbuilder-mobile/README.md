# BrickBuilder Mobile

An independent, local-first, installable building PWA. The initial release
focused on mobile construction with three parametric brick shapes. This is
not a BrickLink Studio clone and does not use proprietary Studio resources.
The application interface is deliberately German; repository-facing material
is English.

For installation, tested tool versions, required variables and deployment,
see the [root README](../../README.md) and
[setup and hosting guide](../../docs/setup-and-hosting.md).

## Available foundation

- Responsive portrait/landscape UI with touch toolbar, brick selection,
  local search and color selection.
- Interactive Three.js scene with baseplate, grid, half-unit snapping and
  procedural 2×4, 2×2 and 1×2 bricks.
- Place, select, drag, rotate, delete, undo and redo.
- One-finger camera rotation; two-finger zoom, rotation and panning.
- InstancedMesh grouping by type/color in WebGL2 mode.
- 2D Canvas projection fallback when WebGL2 is unavailable.
- Local IndexedDB projects, autosave, recovery and project switching.
- Manifest and generated service worker for the bundled app after initial load;
  a model-analysis worker keeps metrics/overlap analysis off the UI thread.
- No accounts, required application server, external fonts or paid services.

## Verification and limits

```sh
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build
```

Tests cover grid/snapping, rotations, history, IndexedDB, parts installation,
format handling and import failures. Private-reference cases skip when their
local uploads are absent; synthetic regressions still run. The production
build generates `manifest.webmanifest` and `sw.js`; Three.js is a separate,
lazy-loaded chunk. Historical foundation measurements put that chunk near
536 kB uncompressed / 132 kB gzip; measure the current build for deployment.

Earlier previews were checked at 402×874 and 844×402. The preview environment
did not expose WebGL2, so it showed the Canvas fallback. No physical Android
device, physical WebGL2 acceptance or installed-browser airplane-mode test
has been completed. Generated offline assets/cache contents were checked,
not a full offline browser acceptance run.

## Model import and file formats

In the German UI, use **Projektmenü → Datei importieren / exportieren**
to select a local IO, LDR, MPD or JSON file. The preview shows instance,
part and color counts and issues. Only **Neues Projekt aus Import anlegen**
saves/opens a new project; the previous model is retained. Read/save failures
do not replace existing projects. A notice above the model opens the saved
import report.

The supplied private Studio reference demonstrated **429 instances, 74 distinct
external parts and eight effective colors**, submodels and full affine
transforms. All 74 original LDraw part geometries and their recursive
dependencies can be rendered. This evidence does not establish general Studio
compatibility.

LDraw and BrickLink color IDs/names are separate. Studio IDs and unconfirmed
BrickLink part IDs are not guessed. Missing geometry is reported by reference
and count; unknown colors use warning magenta. No silent substitute bricks.

Original upload bytes, submodel source, additional IO archive data, LDraw files,
credits and license texts remain in the local project. After successful
import, reopening needs no network. The extra reviewed geometry snapshot is
loaded on demand during import, not at startup, without changing the package
catalog system. Imported instances are read-only; builder bricks remain editable.

The earlier mobile browser flow with the real reference checked a visible
assembled car, persistence/reload, reopening without geometry downloads and an
unchanged previous project after import errors. Physical Android/airplane-mode
acceptance and comparison against Studio remain outstanding.

| Format | Import | Export / actual verification |
| --- | --- | --- |
| Internal JSON v1 | Structure validation; existing v1 projects remain valid | Full local backup including import data; roundtrip tested |
| LDR | Type-1 references and full matrices; missing resources reported | Resolved flat model; reference matrices/colors roundtrip tested |
| MPD | FILE submodels, names with spaces, color inheritance | Unchanged source for import-only models; otherwise flat main.ldr section |
| IO | Unencrypted ZIP32 and older Studio ZIP32 encryption with documented fixed format key; selected model.ldr read | Minimal new ZIP with model.ldr and .info; tested only in our importer, not claimed Studio export compatibility |

Container limits: 32 MiB upload/declared total uncompressed size, 16 MiB per
actually read ZIP entry, 128 entries, 1,024 submodels, 48 hierarchy levels and
10,000 instances. Multipart, AES/other encryption and ZIP64 are rejected.
Structure/path bounds are checked for every entry; actual decompressed sizes
and CRCs are checked for read payloads. Extra IO resources stay in the original
archive without decompression. Nothing is extracted into a filesystem.

Details: [IO reference analysis](docs/io-reference-analysis.md),
[geometry licensing](docs/import-geometry-licensing.md), and
[older encrypted IO reference](docs/legacy-io-reference.md).
The latter reference has significant missing-geometry limitations.

### Automatic missing geometry

Import exhausts model resources, installed packages, the verified IndexedDB cache
and the bundled snapshot before using the optional same-origin LDraw resolver.
The dialog shows progress, cancellation and retry. An open partial import can
be re-resolved without losing editable bricks or original source data. Only
complete, compiled dependency graphs are cached atomically, with original
headers, exact-byte SHA-256, source identity and legal texts. No automatic
snapshot updates or guessed BrickLink IDs are involved.

With the approved official archive, the encrypted 8,590-instance reference
resolved **487/517 references and 8,536/8,590 instances**; 30 references (54
instances) remain unavailable. This excludes inline flexible triangle sections
and does not establish complete Studio equivalence.
See [verification](docs/missing-geometry-verification.md) and
[free self-hosted resolver setup](../../docs/setup-and-hosting.md#optional-ldraw-resolver).
Without that optional service the offline editor and cached geometry still work.

## Not included

- Placing arbitrary LDraw parts or editing imported instances.
- A complete BrickLink part catalog, prices or availability.
- General Studio compatibility, textures, instructions, BFC/type-5 edges,
  physically accurate metallic/transparency rendering.
- Multiple selection, long-term measurements with thousands of bricks or cloud sync.
- Physical Android acceptance.

The internal JSON model is versioned (`schemaVersion: 1`) and supports metadata
for importers. LDraw/BrickLink numbers are not internal brick IDs.
See [architecture](docs/architecture.md) for format boundaries and historical
foundation decisions.

## Local parts library

In the brick drawer's **LDraw-Bibliothek**, **Steine** and **Platten** can
be installed independently, each containing six parts plus subparts/primitives.
Original files, search data, authors and license texts remain in IndexedDB.
Name, category and LDraw number can be searched offline. **Herkunft und Lizenz**
shows source/author/change information and installed legal documents.

These are unchanged, reviewed CC-BY-4.0 files from the official LDraw library;
see [parts licensing](docs/parts-licensing.md). This is a technical provenance/
license review, not legal advice. Network, checksum and storage errors are
shown; incomplete downloads never replace an installation. Database upgrades
preserve existing projects.

Tests cover snapshot hashes, recursive completeness, independent package
installation, offline search after reopening, cancellation/failure,
transaction rollback and existing-project migration.

## Development

```sh
# Replit supplies PORT and BASE_PATH through the managed workflow.
# For a local checkout:
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run dev
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
```
