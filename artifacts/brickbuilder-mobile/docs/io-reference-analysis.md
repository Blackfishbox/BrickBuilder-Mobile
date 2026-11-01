# IO reference analysis

## Source and limits

The user-supplied file is locally available at
`attached_assets/ford_mxCopy_Copy-1_1793477649199.io`.
SHA-256: `ef2c06d4ced5bb56b3ff3bc91fb18274dfc0e84133055bc4d93fd048585f0c14`.
It is not distributed with the source repository.

The original analysis checks archive structure and model data, not the finished
import function or visual equivalence in BrickBuilder. It does not demonstrate
general IO compatibility. Later adapter verification is described separately below.

## Container

An unencrypted ZIP archive with eight entries and 1,422,568 uncompressed bytes:

- `model.ldr`
- `model.lxfml`
- `modelv2.ldr`
- `model2.ldr`
- `model.ins`
- `thumbnail.png`
- `errorPartList.err`
- `.info`

`.info` lists Studio version `2.26.3_1`, part count 429 and parts database
version 212.

## Model reference

`model.ldr` contains nine FILE sections: one main model and eight submodels,
with 402 raw type-1 reference lines. Recursively resolving the main model gives:

- 429 part instances.
- 74 distinct external part references.
- Eight effective color codes after inheriting color 16.

The resulting count matches Studio's `.info` part count.
The 74 references are not confirmed BrickLink IDs.

| Source color code in model.ldr | Instances |
| --- | ---: |
| 0 | 305 |
| 72 | 68 |
| 19 | 4 |
| 4 | 12 |
| 1 | 2 |
| 15 | 21 |
| 179 | 4 |
| 47 | 13 |

Do not interpret these numbers directly as BrickLink color IDs; mapping needs
a traceable separate color table.

## Import requirements

1. Resolve submodels with names containing spaces, detecting cycles and limiting
   depth/instance expansion.
2. Preserve full affine transformation matrices. Nine raw reference lines have
   values beyond simple axis rotations; position plus Y-quarter-turns is insufficient.
3. Convert source units separately from internal building units.
4. Visibly report unresolved parts/colors while preserving source data.
   No silent substitute bricks or dropped unknown references.
5. Protect existing projects and autosave from import errors. Create a new
   project only after successful validation.
6. Check ZIP sizes, paths and supported encoding before reading; no filesystem
   extraction.

## Additional entries

`modelv2.ldr` includes Studio-specific type-11 lines and cannot be interpreted
as ordinary type-1 LDraw references.

`model2.ldr` has 270 FILE sections, including embedded part/primitive definitions,
and different color numbers from `model.ldr`. Do not copy these embedded
resources into the general parts library or treat them as freely redistributable
LDraw data. Use separately licensed sources for the library.

`model.lxfml` has 422 Part elements and is not a substitute for recursive
`model.ldr` counting without additional format knowledge.
`model.ins` is XML with an Instruction root; `.info` is JSON.
Retain extra data unchanged where possible, without claiming supported editing
features for it.

## Implemented adapter verification

Private-reference tests read the local upload directly and skip explicitly when
it is absent. It is not copied into a public fixture or application build.
Independent synthetic regressions run without it.

- 429 retained instances, 74 external references, nine FILE sections.
- The eight effective color codes/counts above match.
- All 429 instances have resolvable original LDraw geometry. A separate,
  hash-pinned snapshot has 74 main parts / 321 reviewed original files
  (98,923 gzip bytes).
- Geometry comes from the official LDraw library, not `model2.ldr`.
  Subparts/primitives resolve recursively.
- Full 3×4 matrices, including reflection, scaling and shear, remain intact.
  Display conversion: 20 LDU = one stud, with Y inverted.
- JSON backups and local reopening retain the original archive, submodels,
  matrices, resources, legal texts and issues without another download.
- The eight LDraw colors have explicitly separate BrickLink mappings.
  Unconfirmed BrickLink/Studio part IDs remain empty.
- Tests cover damaged archives, unsafe paths, cycles, invalid matrices and
  simulated storage failure. Failed transactions change neither existing
  projects nor the active-project pointer.
- LDR export retains resolved matrices/colors; MPD retains unchanged submodel
  source while no builder bricks have been added. Minimal IO export is read
  back by our importer; this is **not evidence of opening it in BrickLink Studio**.

## Visual and domain limitations

An earlier mobile browser flow (402×874) visibly rendered the assembled car.
The preview reported 429/74/8 with only expected unconfirmed BrickLink-ID and
bounded IO-support notices. After reloading/reopening with the geometry download
route blocked, geometry remained available without another request. An existing
one-brick project remained unchanged; a corrupt IO upload produced an error
without replacing it.

There was no pixel/geometry comparison against a Studio reference view because
none was supplied. This is not a claim of general IO compatibility or physically
correct LEGO connections.

Rendering supports LDraw types 1–4 (recursive type 1, triangulated quads).
Type-5 edges are not implemented. BFC culling is not reconstructed; faces are
double-sided with flat per-triangle normals. TEXMAP, Studio textures, metallic/
pearlescent materials, instructions and proprietary extra data are not supported
editing features. Transparency is approximate. These limits do not modify
retained source data.

Imported instances are intentionally read-only model views; builder bricks can
still be edited alongside them. A display-only height correction keeps the
model above the baseplate without changing source matrices.

Still outstanding:

- Confirmation of visual equivalence with Studio.
- Physical Android acceptance, including airplane mode and storage eviction.

## Addition: evidenced BrickLink part numbers

The separately licensed `ldraw-explicit-bricklink` mapping dataset
(`2026-10-31.1`) verifies eight of the 74 reference parts using explicit BrickLink
keywords in reviewed LDraw originals. The other 66 references and all Studio
IDs remain unconfirmed. Earlier statements that all BrickLink part IDs were
empty describe the state before this addition.

The report lists part/color combinations with counts, names, IDs, variants,
sources, authors, license, source hash and version. Conflicting evidence produces
multiple candidates without a selected ID; unknown IDs and original data are
retained. See [BrickLink mapping licensing](bricklink-mapping-licensing.md).
