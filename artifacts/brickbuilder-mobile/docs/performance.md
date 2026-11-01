# Large-model rendering

## Construction height and automatic stacking

- For parts without reviewed connectors, moving an LDraw part checks its translated world-space bounding box against
  cached bounds of other resolved parts. Overlaps raise the drag preview onto
  the intersected stack; moving away recomputes from the initial drag height.
  The lifted position is committed once on release through the normal undo path.
- New catalog and inventory placements use the same construction rules. Inventory
  allocation and the adjusted transform remain a single document commit.
- Selection actions expose **Höher** / **Tiefer**, in increments of one plate
  (8 LDU / 0.4 studs). Explicit height edits deliberately bypass automatic
  lifting, including downward movement; undo/redo and autosave remain available.
- Fallback collision volumes are conservative axis-aligned bounds, not exact solid-body
  or connector geometry. Studs, hollow parts, slopes and rotated pieces may leave
  clearance or trigger a lift without a true surface intersection. Unresolved
  geometry cannot provide collision bounds; existing import warnings still apply.
- Bounds are cached per immutable model/instance; an established drag does not
  recompile geometry. Each pointer update scans cached boxes, so this is not a
  spatial-tree collision engine or a physical Android frame-rate guarantee.

## Reviewed standard stud snapping

The first supported connection family is an upright standard stud-to-underside
connection. Explicit, first-party descriptions use 20 LDU stud spacing, a top
body plane at local Y=0, and bottom planes at Y=24 for bricks / Y=8 for plates.
They are checked against unchanged original geometry in the bundled LDraw
packages, including actual stud primitive centers and body dimensions.

Supported LDraw IDs:

- Bricks: `3001`, `3002`, `3003`, `3004`, `3005`, `3006`.
- Plates: `3020`, `3021`, `3022`, `3023` (the official redirect to `3023b`),
  `3023b`, `3024`, `3710`.

This is twelve bundled part types plus the explicit current `3023b` reference.
These IDs are LDraw identifiers, not inferred BrickLink mappings. Printed,
modified and other suffix variants do not automatically inherit this metadata.

### Interaction and validation

- Drag close to a compatible stud (capture radius 0.36 studs). The selected
  underside socket and target stud centers align in X/Z, with the underside at
  the target's actual body plane rather than at the stud tip. Bricks therefore
  stack at 24 LDU and plates at 8 LDU, without a 4 LDU stud-envelope gap.
- Four upright quarter-turns are supported. Tilt, shear, scale and reflections
  deliberately use conservative fallback placement, not guessed connectors.
- A local spatial hash checks nearby bodies and sockets. Candidates intersecting
  occupied bodies or incompatible studs are rejected. Known studs near underside
  edges and slightly mismatched support heights are also checked. Compatible
  bridges and partial attachment are allowed; this is not a stability simulator.
- A colliding stack can raise the selected part to its free top layer.
  Unrelated overhead models do not attract it. Moving away releases the
  temporary connection and recomputes from the user's starting height.
- Searches and visual previews run at most once per drawing frame, plus a final
  resolution when releasing before the next frame. They do not change inventory,
  autosave or history until the single release callback.
- Catalog and inventory placement use the same resolver. Exact imported
  connection coordinates survive commit, undo/redo, internal JSON and local
  storage instead of being rounded back onto the global half-stud grid.
- Explicit **Höher** / **Tiefer** edits bypass the magnet and preserve X/Z.
  No network requests or new stored connection schema are required.

### Verification and boundaries

The automated tests cover source-geometry agreement for every listed ID,
brick/plate heights, rotation, off-grid imported coordinates, occupied layers,
compatible/incompatible bridges, non-coplanar studs, unknown obstruction geometry,
release/cancellation, frame coalescing, inventory allocation, undo/redo and
IndexedDB persistence. A warmed Node run on a 3,000-part synthetic arrangement
completed 100 local searches in 9.4 ms without compiling geometry again.
That measures the search only, not GPU rendering, cold setup or physical Android FPS.

Unknown parts keep the earlier conservative fallback. Connector descriptions
are not yet available for arbitrary LDraw parts, Technic, clips, hinges or
sideways/upside-down building. This is not a complete LEGO connection or
continuous collision/physics engine; the drag path itself is not collision-swept.
The spatial index is cached per immutable model and rebuilt on changed documents.

## Implemented safeguards

- Compile each normalized LDraw reference once, independently of its inherited
  color. Positions, flat normals and explicit edges use typed buffers.
- Share geometry attributes across color variants. Inherited colors use instance
  colors; fixed painted surfaces are batched by opacity with vertex colors.
  Transparent and opaque source colors remain separate.
- Carry immutable compiled buffers across instance-edit snapshots when the
  verified source resources are unchanged. Editing one part does not recompile
  geometry or deep-copy the original archive. A persistent ID/slot index updates
  only affected face matrices, edge rows and inherited colors. Ordinary moves
  and recolors do not restart the preparation worker.
- Migrate inherited-opacity slots without changing fixed printed colors or
  unrelated batches. Swap-delete slots with stable external IDs; reserve capacity
  before insertion, growing only full batches by 1.5x (minimum four slots).
  Replaced instancing buffers are disposed; geometry/materials remain shared.
  Empty batches retain their bounded capacity for undo and repeated placements.
- Coalesce snapped drag previews into the next drawing frame. Pointer release
  invokes the existing editor callback once; previews never enter history,
  autosave or inventory accounting. Cancellation, lost capture, window blur,
  project changes and multi-touch camera takeover restore committed transforms.
- Keep the last valid scene visible during replacement preparation. Abort stale
  work; install new scenes only on success. Additive source enrichment and
  undo/redo use the same incremental path. Actual source changes and explicit
  retries may still require full replacement.
- Draw explicit edges with one instanced line object per part type, rather than
  one scene object per brick. Conditional type-5 edges remain unsupported.
- Prepare cold geometry in a Web Worker. Only shared resource files and unique
  references cross the worker boundary, never the original IO byte array, project
  history or complete instance metadata. Typed results are transferred back.
- Build the scene cooperatively between part types, with progress, cancellation
  and retry. A single unusually complex part can still exceed one timeslice.
- Render on demand. While the camera moves, temporarily hide imported edges and
  reduce pixel ratio; restore both after input settles. The vertical camera axis
  remains inverted.
- Fit and resize using cached model bounds rather than repeatedly traversing
  every imported object. Preserve the initial ground offset across edits.
  Cached per-ID bounds narrow exact triangle picking; an established drag uses
  its cached pivot/plane and never repeats scene picking on pointer movement.
  Batch sorting bounds expand conservatively on edits, rather than being
  nulled: Three.js would otherwise recalculate every instance's sphere during
  render sorting, even with frustum culling disabled.
- Dispose instance matrix/color buffers as well as materials and geometry when
  scenes or editable-brick batches are replaced.
- List saved projects from small derived metadata records. Do not load another
  complete copy of every project's IO archive and geometry just to show its name
  and brick count. Legacy summaries are created transactionally, one project at
  a time, without a schema migration.
- Avoid autosaving an unchanged restored project again. Real edits and new
  documents still autosave, and explicit saves remain available.

## Memory and compatibility behavior

Before uploading an imported scene, enforce a buffer budget of 96 MiB, reduced
to 64 MiB on browsers reporting at most 2 GB RAM and 32 MiB at at most 1 GB.
This is a safety budget, **not** a guarantee about actual device GPU memory.
Browsers that do not expose device memory use the default budget.

An exceeded budget, lost WebGL context or unavailable WebGL switches to an
explicitly labeled software compatibility preview. It uses at most 32,000
sampled **real source triangles**, reduced further during movement. It does not
claim to display every surface. Large editable-brick software views are also
bounded and culled outside the viewport. No placeholder parts are asserted to
be original geometry.

The complete instances, source files, unknown metadata and original archive
remain in the project. Reducing display detail never deletes model references.
The software preview is a stability measure, not a full-fidelity replacement
for hardware-accelerated rendering. It retains bounded local source samples
and rewrites only a changed part's slots, including reflected/rotated shading,
inherited colors and alpha. Deletions return sample slots to a free list.
Insertions reuse slots or take a sample from one donor at the limit; they do not
re-prepare the complete scene or construct GPU geometry for imported hit tests.
The sample allocation remains capped at 32,000 triangles, including retained
local samples, but per-ID metadata/bounds still scale with the instance count.
Beyond the limit, some instances may have no displayed triangles. This does not
remove any source instance or alter saved data.

## Measured reference

The supplied encrypted Studio reference was imported through the verified
same-origin archive resolver. No private upload is checked into this repository.

| Measurement | Previous renderer estimate | Optimized renderer |
| --- | ---: | ---: |
| Parsed external model instances | 8,590 | 8,590 |
| Instances with available complete geometry | 8,536 | 8,536 |
| Imported drawing objects | 9,814 | 1,002 |
| Geometry and instancing buffers | 82.5 MiB | 51.8 MiB |

The previous columns are reconstructed from the previous reference/color
batching rules, without allocating that crash-prone scene. The optimized scene
was actually constructed. Its setup took approximately 0.4 seconds in the
workspace's Node benchmark; this is **not** a phone frame-rate measurement.
The complete scene contains approximately 4.95 million rendered triangles.
Missing references remain reported by their original part numbers; this change
does not invent geometry for the 54 unavailable instances.

A separate 10,000-instance, multicolor synthetic model uses four drawing
objects and about 1.81 MiB of buffers. Its two-million-triangle software input
is bounded to a 30,000-triangle preview. These are structural regression tests,
not claims that every 10,000-part model has the same complexity.

## Reproduce

```sh
pnpm --filter @workspace/brickbuilder-mobile test
pnpm --filter @workspace/brickbuilder-mobile typecheck
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile build
```

The optional private benchmark requires the original reference upload in its
local fixture location, a running frontend and the configured approved archive
resolver. Set a local preview origin, not a third-party service:

```sh
BRICKBUILDER_BENCH_URL="https://your-development-preview/" \
  pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/features/engine/performance.test.ts --reporter=verbose --silent=false
```

The private case skips when its upload or explicit benchmark origin is absent.
Ordinary tests do not require a network service. Tests cover typed geometry
sharing, instanced edges, original/fixed/translucent colors, partial-build
cancellation, memory-budget rejection, instance-buffer disposal, bounded
software preparation, worker payloads, summary backfill and summary deletion.
Additional incremental regressions cover stable IDs after swap deletion,
opacity migration, source enrichment, new reference insertion, reflected/sheared
matrices, buffer reuse, budget rejection retaining the prior scene, software
shading parity, sample-limit insertions and frame-coalesced drag rollback.

## Reproducible incremental-edit measurements

Measured in the workspace with Node.js 24 on 2026-11-01; these are CPU-side
synthetic-fixture measurements, **not physical Android certification, GPU render
times, input-to-photon latency or a guaranteed frame rate**. Timing varies with
JIT warm-up, garbage collection and concurrent work. The redistributable fixture
contains one reference, 200 inherited triangles, one fixed-color triangle and
an explicit edge, repeated across opaque and translucent instances on a grid.
The 4,000- and 10,000-instance cases represent 804,000 and 2,010,000 source
triangles. They do not represent arbitrary geometry diversity.

```sh
pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/features/engine/incremental.test.ts \
  -t 'measures .* instances' --reporter=verbose --silent=false
```

The baseline executes the prior full-batch construction/disposal path using the
same compiled geometry, rather than estimating it. Each edit/placement column
averages 12 successive immutable updates; initial scene/index construction is
outside the incremental timing. Picking is a single ray, comparing Three's
whole-scene instanced raycast against cached bounds plus exact candidate tests.
Preview means just the transient matrix/bounds update, averaged over 100 calls.
Software preparation includes cooperative yields; its update is one immutable
movement, not a full drawing frame.

| CPU operation (ms) | 100 instances | 4,000 instances | 10,000 instances |
| --- | ---: | ---: | ---: |
| Move: previous full rebuild | 2.58 | 7.35 | 15.23 |
| Move: incremental document update | 0.13 | 1.56 | 3.18 |
| Transient single-part preview | 0.004 | 0.003 | 0.002 |
| Placement: previous full rebuild | 1.03 | 5.95 | 11.97 |
| Placement: incremental | 0.23 | 2.02 | 4.46 |
| Delete all 12 newly placed parts: incremental | 0.33 | 3.13 | 7.06 |
| Picking: previous whole-scene raycast | 2.46 | 3.75 | 4.98 |
| Picking: bounds-indexed exact candidates | 0.93 | 1.42 | 3.26 |
| Software: previous complete preparation | 62.86 | 49.60 | 72.65 |
| Software: incremental movement | 2.31 | 2.32 | 4.14 |

Structural results are more repeatable than wall-clock times:

- For 12 moves: full builds **12 → 0**, drawing-buffer allocations **48 draw
  objects → 0**, incremental worker requests **0**, capacity growths **0**.
  Existing face/edge objects and their typed buffers remain identical.
- The selected fixture ray tests **100 / 4,000 / 10,000 cached boxes**, then only
  **2 / 4 / 4 candidate face meshes**, rather than iterating all face instances.
  The counter is candidate mesh triangle-test calls, not individual triangles.
  Established drags perform **zero repeated scene picks**.
- All three models retain four drawing objects. Initial allocated drawing
  buffers are **33,332 / 766,532 / 1,894,532 bytes**. Moving changes none of
  those allocations.
- Twelve placements cause **three capacity growths** per fixture and create
  **zero new geometry batches** for the known reference/opacity. Retained
  buffers become **41,516 / 1,091,916 / 2,707,916 bytes**. Deletion reuses
  capacity rather than repeatedly shrinking/reallocating it. New references or
  unseen opacity groups can allocate their own batches.
- Incremental document diffs still scan the instance list and allocate small
  JavaScript maps/sets; cached-bound picking is still linear in instance count.
  The zero-allocation statement applies to **drawing buffers on movement**, not
  all JavaScript allocations or renderer/driver internals.

A 402×874 emulated-browser check used a new self-contained synthetic project.
It verified a visible pre-release preview with unchanged IndexedDB data,
release/autosave, exactly one Undo/Redo step, reload persistence, and
pointer-cancel rollback without an extra history entry. That browser used the
software compatibility renderer; it is not hardware WebGL or Android evidence.
GPU batch transforms, fixed/inherited color grouping, opacity migration and
disposal are covered by the automatic Three.js object/buffer regressions, not
by a physical-device rendering certification.

## Remaining limits

- No physical Android device or real-device FPS/memory trace was available for
  this change. Do not describe the Node benchmark as Android certification.
- Actual performance depends on GPU, browser, thermals, viewport and part
  complexity, not just brick count. Full geometry is still expensive on weak
  hardware; the compatibility preview intentionally sacrifices visible detail.
- The importer's existing unsupported flexible/inline geometry and unavailable
  source parts are unchanged.
- Hardware-accelerated occlusion optimization and detailed geometry LOD are
  separate future work. No unlimited-size or universal 60 FPS claim is made.
