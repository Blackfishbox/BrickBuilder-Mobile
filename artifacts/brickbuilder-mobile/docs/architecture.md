# BrickBuilder Mobile — architecture and foundation

## Product boundary

BrickBuilder Mobile is an independent, offline-oriented PWA. The foundation
release is a local 3D editor with three simple brick types. No server, account
or paid runtime dependency is required. Foundation geometry is procedural, not
a replacement for the LDraw library.

This document retains the original foundation plan for context. Later
parts/import extensions are described below; future-tense foundation notes
are not a statement that those implemented extensions are absent.

## Component architecture

```text
React UI
  └─ EditorShell / mobile controls
      ├─ useBuilder (document, selection, tools, history, autosave)
      ├─ BuilderCanvas (Three.js, raycasting, camera, touch input)
      │   └─ InstancedMesh groups by brick type and color
      └─ Parts drawer / palette (builder bricks and packaged LDraw library)

Domain
  ├─ Versioned BuilderDocument
  ├─ Brick and BrickType models
  ├─ Grid/snap functions
  └─ History (undo/redo)

Persistence & offline
  ├─ Dexie / IndexedDB: projects, active project, recovery, parts packages
  ├─ Debounced autosave after local changes
  └─ Service worker: Vite app shell, static assets, navigation fallback

Worker
  └─ Model analysis and spatial metrics off the editor's main thread

Extension boundaries
  ├─ parts/: installed original LDraw files for geometry/format adapters
  ├─ catalog/bricklink: separate BrickLink IDs, colors, prices and availability
  └─ formats/{internal,ldr,mpd,io}: independent importers/exporters and roundtrips
```

## Original directory proposal

This is the foundation proposal, not an exact current directory listing.

```text
src/
  app/                 # PWA registration and application shell
  components/mobile/   # Touch-optimized controls
  features/editor/     # Document model, commands, history, React hook
  features/engine/     # Three.js scene, camera, raycasting, worker
  features/parts/      # Local foundation catalog and filters
  features/projects/   # Project list and recovery flow
  storage/             # IndexedDB schema and repository
  formats/internal/    # Internal JSON, versioning and migration
  formats/ldr/         # Separate LDR import/export
  formats/mpd/         # Separate MPD import/export
  formats/io/          # Isolated IO adapter, unknown metadata
  workers/             # Expensive model/catalog calculations
  test/                # Test setup and sample models
public/
  icons/               # Local PWA icons
```

These extension boundaries do not by themselves claim any feature or external
format compatibility.

## Data model (internal JSON v1)

- `BuilderDocument`: `schemaVersion`, `id`, `name`, `createdAt`, `updatedAt`,
  `bricks[]`, `metadata`.
- `Brick`: stable ID, internal brick type, color, `(x,y,z)` position in building
  units and Y rotation in quarter turns.
- `BrickType`: internal IDs `brick-2x4`, `brick-2x2`, `brick-1x2`, separate from
  LDraw and BrickLink part numbers.
- `metadata`: versionable object that can preserve unknown import metadata.
- Foundation colors are local hex colors, not an official LDraw/BrickLink mapping.

Horizontal studs use a one-unit grid; different footprints can put brick centers
on half units. Y snaps to brick height. The model uses units, not screen pixels.
The engine targets visual grid placement; this is not a mechanical connection
solver.

## Historical implementation plan

1. [x] Mobile editor shell and responsive portrait/landscape layout.
2. [x] Three.js baseplate, grid, parametric bricks, camera and raycasting.
3. [x] Place, select, move, rotate, delete and simple snaps.
4. [x] Undo/redo, local projects, autosave and IndexedDB recovery.
5. [x] PWA manifest, service worker and app-shell caching.
6. [x] Vitest coverage for snapping, history, documents and storage.
7. [ ] Implement and verify LDraw packages, BrickLink catalog data, import/export
       and larger performance runs separately from the foundation release.

Item 7 records the original scope separation, not current completion of every
extension. The implemented subsets below and in the README are authoritative.

## Offline strategy

The build includes editor components locally. The worker caches the app shell
and bundled assets; core operation needs no remote fonts, catalog APIs or image
CDNs. Projects/recovery points live in IndexedDB. Autosave runs after a short
delay, with explicit saving also available. Once initial loading/cache
population succeeds, the cached app can operate offline. New parts packages
require network access; they are not precached, but stored in IndexedDB after
an explicit package download.

### Local LDraw library

`features/parts/` contains a bundled catalog and atomic installer. Two small,
independently installable snapshots (bricks and plates) each contain six parts,
all recursive subparts/primitives and legal documents. SHA-256, byte length,
package version, license headers and dependencies are checked before writing.
IndexedDB schema v2 adds tables without rewriting existing projects.
Failures leave existing packages unchanged. Name, LDraw number and category
search uses local data only. Index data, original files and legal documents
survive browser restarts, but browser cleanup or storage eviction can remove them.

Internal catalog ID (`ldraw-bricks:3001`), LDraw ID (`3001`), editor type
(`brick-2x4`) and optional `brickLinkId` are separate fields. No BrickLink
equivalence is inferred. Only the three supported shapes are selectable for
placement; other entries are marked **Nur Katalog** in the German UI.
Original LDraw geometry rendering is a separate extension, not a silent
substitution with an unsuitable procedural shape.

See [parts licensing](parts-licensing.md) for sources, authors and obligations.

## IO compatibility and risks

IO is a separate adapter and must not be conflated with LDR/MPD or internal
JSON. Compatibility claims require self-authored, legally distributable IO
fixtures. Container structure, submodels and unknown metadata must be modeled
explicitly; import/export need separate tests including roundtrips.
This work was outside the foundation release.

Risks include WebGL performance/memory on older Android hardware, IndexedDB
quotas/eviction, touch-gesture conflicts with browser navigation and the greater
complexity of real LDraw geometry and IO containers. Desktop preview cannot
replace physical smartphone acceptance.

## Implemented format and geometry extension

The adapters originally described as future work now exist in
`features/formats/{internal,ldraw,mpd,io}`. Import/export remain separate.
A bounded ZIP32 reader checks IO containers; the LDraw parser retains submodel
source and affine matrices. An independent resolver uses installed catalog
files first and, when needed, an additional reviewed original-geometry snapshot,
without overwriting package catalogs or Studio source data.

Backward-compatible JSON v1 extension: optional `imported` data accompanies the
existing `bricks`. It contains original bytes, submodel sections, resolved
instances with 3×4 matrices in LDU, separate identifiers, issues, geometry
resources and legal documents. No IndexedDB schema migration is needed.
Historical v1 projects without that field remain valid. Imported instances
are initially read-only, outside the builder bricks' snapping/Y-quarter-turn
model.

The engine groups imported surfaces by part/color into InstancedMeshes,
triangulates original faces and also renders them in the Canvas fallback.
Display conversion uses 20 LDU per stud and an inverted Y axis; source matrices
are unchanged. Camera and display height adapt to the imported model.

Import preview writes nothing to the database. Confirmation saves the previous
project, new project and active-project pointer in **one** IndexedDB transaction.
Only then does the editor switch projects. Project data carries its resources
for offline reopening.

The README and [IO reference analysis](io-reference-analysis.md) document actual
compatibility, tests and unsupported features. The foundation and local package
library are implemented; only explicitly documented subsets of BrickLink data
and external formats are supported.
