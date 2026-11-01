# Offline connection data and active contacts

## Source and licensing

The installed dataset is pinned to **LDCad Shadow Library**
`9b1131fb1991f8c0bfc072325e4e12f6271aba35`:
<https://github.com/RolandMelkert/LDCadShadowLibrary>.
Its README and original LICENSE.md identify **CC BY-SA 4.0**.
The shadow data remains separate from first-party application code. Original
author/history/license lines are preserved, and every original record has a
SHA-256 hash. Adaptations of that dataset remain subject to its attribution
and share-alike terms; this does not relicense the whole application.

The separately compressed LDraw reference graph retains original authors,
per-file CC BY 4.0 or CC0 declarations, original file hashes and type-1
reference lines. Its archive SHA-256 is
`023083918da2d3697c794fb4267975509584f3611b993095874206a803fa610f`.
This graph is an explicitly documented reference-only extraction, not a
replacement geometry library. Real source geometry must already be installed
or acquired through the existing audited geometry workflow. No Studio assets
are used.

Attribution, complete upstream legal texts, integrity manifest and machine
readable coverage are shipped under `public/licenses/connections/` and linked
from the parts library. The original shadow texts and adapted reference graph
are losslessly compressed into source data modules. They are included in the
application installation, not fetched from upstream during a drag. Production
service-worker precaching includes the data-containing JavaScript chunk and
the legal/report files. The 12 MiB precache entry limit is intentional.

Rebuilds are explicit, never silent upstream updates:

```sh
git clone https://github.com/RolandMelkert/LDCadShadowLibrary generated-artifacts/ldcad-shadow
git -C generated-artifacts/ldcad-shadow checkout 9b1131fb1991f8c0bfc072325e4e12f6271aba35
# Obtain the approved complete.zip with the hash above, not an unchecked update.
python3 scripts/build-connection-snapshot.py \
  --shadow generated-artifacts/ldcad-shadow \
  --ldraw-archive generated-artifacts/complete.zip
pnpm --filter @workspace/scripts exec tsx \
  ../artifacts/brickbuilder-mobile/src/features/connections/audit.ts
```

The builder requires the pinned shadow revision and checks every redistributed
LDraw file's license/author. Re-audit any deliberate archive replacement.

## What the counts mean

The reproducible coverage report records:

| Measure | Count |
| --- | ---: |
| Original shadow `.dat` records | 4,285 |
| Audited LDraw hierarchy records | 37,150 |
| Examined top-level part references | 25,024 |
| Parts with parsed connector descriptions | 19,063 |
| Expanded, deduplicated connector descriptions | 346,323 |
| Parts containing cylinders | 18,477 |
| Parts containing clips | 1,593 |
| Parts containing generic connections | 1,264 |
| Parts containing finger connections | 894 |

Families overlap: these columns must not be added to obtain a part total.
**None of these counts certifies that every part pair works.** A working
connection also requires installed geometry, supported transforms, compatible
profiles, valid insertion depth, free contacts and successful obstruction
checks. The report includes per-part counts and all distinct expansion
diagnostics, rather than labeling a downloaded record as supported.

The snapshot currently reports 2,424 distinct transform-policy rejections,
54 unsupported/incomplete metadata records and two missing geometry references
(`6177973fc01.dat`, `6177973hc01.dat`). These are not fabricated into ports.
Remaining rejected metadata includes ambiguous generic records without a
matching group/explicit size policy, unsupported extra parameters, and invalid
frames. See `coverage.json` for exact source paths and lines.

## Expansion semantics

- Resolve exact LDraw references with normal `parts/` and `p/` search order.
  Never use BrickLink equivalence or strip variant suffixes.
- Walk actual installed type-1 geometry hierarchies; the pinned graph makes
  audit/metadata expansion possible without downloading geometry. Missing
  installed dependencies are explicitly diagnosed.
- Apply direct shadow metas after inherited geometry information. `SNAP_CLEAR`
  clears all inherited ports or only matching IDs. `SNAP_INCL` imports the
  target's direct shadow instructions with position, orientation, grids and
  scale policies, not the target's implicit geometry hierarchy. Explicit
  shadow include chains are followed with cycle guards (the snapshot itself
  includes `2823 -> 3700 -> connhole` and other such chains).
- Expand centered/un-centered X/Z grids and the X/Y/Z grid form actually used
  by the pinned library. Preserve connector-local coordinate frames.
- Apply scale policies in the connector's axes; reject meaningful shear and
  disallowed scaling. Respect `mirror=none`, `cor` and `corZ`. Normalize rounded
  rotation coefficients within 0.001, without rescaling the source model.
- The older online metadata table predates some snapshot conventions. The
  audited finger data uses a centered default and radius 6 (explicit
  `center=false` records and `h1`/`h2`/`clh*` source geometry distinguish this
  from cylinder defaults). The implementation preserves the explicit
  `match=size`/`placement=free` generic extensions. It rejects ambiguous generic
  defaults rather than matching every group-less object.
- Expansion has cycle/depth/visit/grid/connector budgets. Exceeding a budget
  produces a diagnostic, not a working connector.

## Matching and collision limits

Enabled families are cylindrical R/A/S and flexible `_L`/`L_` sections,
female clips against cylindrical bars, interlocking finger sequences, and
generic group/explicit-size connectors. Genuine examples cover ordinary
studs/anti-studs, `2780`/`3700` pin/hole, `3705`/`32064` axle/hole,
`30374`/`4085a` bar/clip, `p/h1.dat`/`p/h2.dat` fingers, and
`14417`/`30396` free spherical generic joints.

Matching aligns actual frames, not just upright Y-axis quarter-turns.
Axle/square fits retain fourfold roll alignment; round profiles retain
continuous roll freedom. Free spherical generic joints preserve current
orientation. Sliding candidates include the closest axial position and
section-boundary alignments. Profile overlap must engage a matching size:
clearance alone does not make a smaller bar connected inside a larger hole.
Caps block penetration through closed ends. Non-sliding capped stud/socket
pairs seat at their entry planes; partially inserted studs do not turn an
uneven bridge into a verified connection.

Occupied contacts are checked against real current transforms. Separate
non-overlapping regions of a long sliding connector may be used independently.
Third-party bounds remain conservative obstacles. For mating counterparts,
overlap is allowed only in the insertion slab/radial envelope; if a whole-part
AABB is inconclusive, bounded source-triangle crossing tests check actual
surfaces outside the declared mating region. Generic bounds define the
allowed local matching region, not an exemption for an entire part.

This is not a physics, stability, deformation or articulation simulator.
Narrow-phase tests are limited to 20,000 triangles per part and 100,000
candidate triangle pairs; exceeding them rejects that snap. A bounded,
three-direction parity check also rejects enclosed/coincident solids outside
the mating region without treating one ray through an open seam as proof.
Open/non-manifold
geometry and unusual multi-profile interference remain limitations; the
fallback samples at most 32 face midpoints per body. A conservative fallback may
refuse valid configurations. No collision check here certifies physical
manufacturing tolerances, friction, strength or flexible motion.

## Editor, visualization and persistence

Drag preview, release, catalog placement and inventory placement all use the
same full 12-coefficient LDraw transform. Release carries that exact matrix to
the editor without dividing/multiplying the saved LDU translation through UI
units. A drag previews only the moving instance, at most once per animation
frame, and commits one inventory-aware document transaction on release.
Original source bytes, hierarchy, legal metadata, allocation and instance ID
are unchanged. History, autosave and internal JSON store the complete matrix.
Explicit height controls bypass connection/stacking resolution.

Contact descriptors carry stable instance/connector IDs, location, orientation,
family, candidate/verified state and source evidence. Green committed markers
are recomputed from current transforms after edits/history, never from a saved
last-snap flag. Amber markers are only placement candidates during dragging.
The selected counterpart receives a thin projected outline. A touch-sized
German toggle shows/hides the shared, non-interactive overlay in both GPU
instancing and the reduced software renderer.

At most 64 contacts are retained per result and 32 marker locations are drawn.
Cancellation, pointer loss, camera takeover, selection/project changes and
unmount clear temporary markers. The last valid scene stays visible while a
replacement prepares; markers are withheld until that scene matches the
current model.

## Verification

Automatic tests use genuine licensed source fixtures for every enabled family
and verify source hashes/legal files, inheritance, clears/includes, grids,
scale/mirror handling, incompatibility, occupied contacts, oriented insertion,
off-grid matrices, release-before-frame, cancellation, marker bounds/lifecycle,
stock accounting, history and persistence. Existing large-model geometry-cache
regressions remain active. Mobile browser evidence and measurements are
recorded separately in `performance.md`; they are not physical Android results.
