# Standard construction verification

## Scope and evidence

This is a bounded geometry/interaction audit, not certification of every LEGO
part or Android device. The reported large displacement of **3023/3023b on
3795 has not been reproduced with the available sources**. Passing the checks
below must not be presented as confirmation that the user's original problem
has been resolved.

The audit enumerates the approved complete official LDraw archive, not just
the twelve installable catalog entries or the 74-part bundled import snapshot.
It selects original main-file descriptions `Brick`, `Plate`, or `Tile` with
two integral dimensions, including groove, reinforced underside, underside
ribs/details, missing centre studs, flat-pin, and Type 2 variants. It excludes
decorations, assemblies, nonrectangular/modified tops, and nonstandard heights.
Dimensions come from the authoritative description, never the filename or
bounding box. Actual connector positions are checked against transformed
source primitives and compiled underside triangles.

**91 source parts: 34 bricks, 36 plates, 21 tiles.** Aliased `3023` and its
historical flattened hierarchy have separate regressions.

## Complete enumerated inventory

Numbers in parentheses are the original description's stud dimensions, not a
claim that every tile has an underside socket at every grid location.

### Bricks (34)

2356 (4x6), 2456 (2x6), 2465 (1x16), 2653 (1x4), 3001 (2x4),
3002 (2x3), 3003 (2x2), 3004 (1x2), 3005 (1x1), 3006 (2x10),
3007 (2x8), 30072 (12x24), 3008 (1x8), 3009 (1x6), 3010 (1x4),
30400 (4x18), 3065 (1x2), 3066 (1x4), 3067a (1x6), 3622 (1x3),
4201 (8x8), 4202 (4x12), 4204 (8x16), 4216 (1x2), 4217 (1x14),
43802 (8x8), 44041 (8x16), 44042 (4x6), 60033 (4x12), 6111 (1x10),
6112 (1x12), 6212 (4x10), 733 (10x10), 925a (1x8).

### Plates (36)

11212 (3x3), 2445 (2x12), 3020 (2x4), 3021 (2x3), 3022 (2x2),
3023a (1x2), 3023b (1x2), 3024 (1x1), 3026 (6x24), 3027 (6x16),
3028 (6x12), 3029 (4x12), 3030 (4x10), 3031 (4x4), 3032 (4x6),
3033 (6x10), 3034 (2x8), 3035 (4x8), 3036 (6x8), 3456 (6x14),
3460 (1x8), 3623 (1x3), 3666 (1x6), 3710 (1x4), 3795 (2x6),
3832 (2x10), 3958 (6x6), 41539 (8x8), 4282 (2x16), 4477 (1x10),
60479 (1x12), 728 (8x11), 78329 (1x5), 91405 (16x16),
91988 (2x14), 92438 (8x16).

### Tiles (21)

1751 (4x4), 2431 (1x4), 26603 (2x3), 3068a (2x2), 3068b (2x2),
3069a (1x2), 3069b (1x2), 3070a (1x1), 3070b (1x1), 4162 (1x8),
48288 (8x16), 6320 (6x8), 63864 (1x3), 6636 (1x6), 6881a (6x6),
6881b (6x6), 6934 (3x6), 69729 (2x6), 8165 (4x8), 87079 (2x4),
90498 (8x16).

## Sources and reproducibility

- Approved official archive SHA-256:
  `023083918da2d3697c794fb4267975509584f3611b993095874206a803fa610f`.
  Its existing pinned restore descriptor is in the API service. The audit
  verifies every selected file and recursive dependency against that archive's
  manifest and checks each original license header.
- Every main-file URL is
  `https://library.ldraw.org/library/official/parts/<number>.dat`.
  Dependencies retain their original `parts/s/` or `p/` paths, authors,
  history and individual checksums. No live upstream download or archive
  refresh is performed by this test.
- The bundled import snapshot and independent brick/plate packages remain
  unchanged. Their provenance is in `import-geometry-licensing.md` and
  `parts-licensing.md`.
- Connection metadata and its separate CC BY-SA 4.0 licensing remain in
  `public/licenses/connections/manifest.json`. Original geometry is CC BY 4.0
  or CC0 as recorded per file. The new flat-pin supplement is first-party
  metadata derived from explicitly retained original geometry; it does not
  rewrite the upstream connection snapshot.
- `fixtures/3023a.dat`, `3066.dat`, and `3066s01.dat` retain the additional
  regression sources. See their README for author, license and original hashes.

Start the existing API workflow to restore the already approved archive, then:

```sh
pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/features/connections/catalog-standards.test.ts
```

The default archive directory matches the pinned API restore. For a prepared
checkout, `LDRAW_STANDARD_ARCHIVE` may point to the same approved manifest and
files. Without that archive, bundled-source and retained-fixture tests still
run, while the **full-archive enumeration assertion is explicitly skipped**.
Such a run is not evidence for the 91-part claim. Missing/hash-mismatched
dependencies in an available archive fail, rather than silently falling back.

## Confirmed defects and corrections

1. **Preview matrix round trip:** the Canvas recomputed an already resolved
   affine matrix through scene units and floor offset. A regression observed
   `3.4` becoming `3.3999999999999995` before rendering, while commit kept
   `3.4`. Both rendering paths now receive the original exact connection
   matrix. This is a precision defect, **not evidence explaining a visible
   multi-LDU displacement**.
2. **3066 duplicate/conflicting sockets:** installed `s/3066s01.dat` supplies
   four square, 20-LDU-deep openings, but the old root `SNAP_INCL` also imports
   four round, 24-LDU-deep descriptions from `s/3010s01.dat`. The physical
   source-inherited opening now takes precedence over a coincident ordinary
   socket from an include. Other connector families and distinct positions
   are not removed.
3. **3023a missing underside:** the real flat-pin variant has no underside
   metadata in the pinned connection snapshot. Two radius-6 openings at
   X = -10/+10, Z = 0, Y = 8 are verified against its original cavity and
   flat pin. A source-guarded first-party supplement supplies exactly these
   openings. Altering the reviewed source disables it. This is not applied
   to `3023b`, aliases, or arbitrary similarly sized parts.

No project, library, package, original IO data or local geometry cache is
deleted or automatically replaced. Existing immutable source precedence and
source-conflict errors remain intact. The confirmed faults do not establish
which sources/cache state caused the user's original observation.

## Automated configurations

- All 91 parts: real compiled geometry, source stud centres (solid, open and
  no-logo variants), underside insertion clearance, and metadata positions.
- Each part paired with real `3001`, `3022` and `3795` sources: valid candidates
  or explicit missing-data cases, exact transformed contact axes/endpoints,
  preserved upright basis, committed active contacts. Legitimate edge
  overhangs use actual sockets, not a fabricated full rectangular grid.
- `3023b/3795`: full-support pointer sweep, both rows, four quarter-turns,
  support yaw 0 / 90 degrees / 0.37 radians, off-grid translations 4.6/3.4 LDU,
  two scene-floor levels, several starting heights, and an existing stack.
- Real `prepareLibraryPart` and `useBuilder`: catalog and inventory selection,
  source acquisition, initial placement, inventory exhaustion, undo/redo,
  stable instance identity, exact local save/reload data.
- Real Canvas event/projection and connection search: sampled source geometry,
  visible live contact status, frame coalescing, preview vs final rendering
  and exact transaction matrix. Existing cancellation, manual height,
  obstruction, nonstandard connection and IO-preservation tests remain active.
- The geometry distinction is explicit: plate origin is its upper body plane;
  underside is +8 LDU; the stud tip is -4 LDU. Scene floor translation is
  rendering-only, never another part height.
- `2653` has sunken, longer hollow studs. Its authoritative metadata explicitly
  specifies the ordinary mating plane; the test records the real primitive's
  different Y origin rather than falsely requiring identical origins.

## Honest exceptions

- `1751`, `6320`, `8165`: real geometry exists, including underside structure,
  but the pinned connection dataset supplies no usable underside sockets.
  They remain explicit unconnected/free-placement cases, not invented snaps.
- `48288`: 80 described openings, not 128. `6934`: 14, not 18.
  `6881a`: 20, not 36. `6881b`: 4, not 36. Their tops remain studless.
  A small support under an undescribed/blocked centre is not treated as a
  valid connection simply because the tile's outline is rectangular.
- Locally modified or other historical sources are not all interchangeable.
  The existing hierarchy-equivalence recovery still requires its own source
  evidence; the flat-pin supplement requires the exact reviewed root.
- The installed library UI exposes its installed package entries, not every
  file in the complete resolver archive. The browser reference support may
  therefore be loaded from a self-authored LDR, while its plate is selected
  and prepared through the normal catalog/inventory UI.
- Browser observations, renderer and hardware limitations are recorded below.
  Software geometry/event tests alone are not Android/WebGL acceptance.

## Browser and final validation

The targeted browser journey used a **412x915 touch viewport** and only
self-authored LDR/CSV data. WebGL was unavailable, so it exercised
`canvas-fallback`, not GPU rendering or Android hardware.

- Imported the one-part 3795 support through the normal file dialog, installed
  the plates package and selected the catalog's `3023` entry. Actual resources
  included its redirect to `3023b` and the real `3023bs01` subpart.
- Placed the plate, dragged it with one touch between the two stud rows and
  observed **two magnetic connections before release**, then two verified
  contacts after release. A quarter-turn and another drag retained two contacts.
- The rotated final affine matrix was
  `[0,0,1,10,0,1,0,-16,-1,0,0,0]`. Save/reload preserved the part IDs,
  source support matrix and final plate matrix.
- Imported the authored CSV `3023,5,1`, selected its resolved red 3023b and
  placed one item through the inventory UI. The UI reported one used and zero
  remaining and disabled a second use.
- A targeted clarification verified Undo and Redo **immediately after an edit**
  on the original catalog 3023: each restored its exact matrix and left the
  base/inventory parts unchanged. The tester's initial suspicion of disabled
  Undo was after reload. History is intentionally in memory, so disabled
  Undo after reopening is not the same as losing a current-session edit.

Screenshot evidence from this run includes the held two-contact preview,
rotated preview, save confirmation, correct CSV preview, exhausted inventory,
and Undo/Redo states. The reported larger visual misalignment was **not
reproduced**. No assertion is made about the user's unknown local revision,
WebGL, or physical Android behavior.

Typecheck and the production build passed. The build retains its existing
large-bundle warning. A simultaneous initial full-suite/build run exhausted
the default five-second limits in two unrelated tests; test worker concurrency
is now bounded to avoid competing snapshot decodes. The bounded full run passed:
**33 files, 663 tests passed, 4 existing source-dependent tests skipped**.
The complete 91-part archive assertion ran; it was not one of those skips.
Workflow restart, clean browser logs and a final mobile viewport check also
passed. No publication was performed.
