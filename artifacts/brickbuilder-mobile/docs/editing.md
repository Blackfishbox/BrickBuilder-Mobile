# Editing LDraw models

The part picker shows only the installed LDraw library. There is no separate
three-brick demonstration palette. Every catalog item can be selected for
placement; its actual licensed geometry must resolve successfully first.
Missing geometry is reported by part number instead of replaced by a fabricated
brick. Install a parts package and cache its geometry before working offline.

## Touch workflow

1. Import an IO, LDR or MPD model, then create the local project.
2. The selection tool is activated automatically. Tap a visible individual part.
   Its LDraw number appears in the selection toolbar and its geometry is
   highlighted. Repeated copies of the same part have distinct selection IDs.
3. Change the color, rotate by 90 degrees, drag horizontally on the construction
   plane, or delete the selected instance. Imported source transforms and pivots
   are preserved; movement snaps to half-stud X/Z increments.
4. Undo and redo apply to imported instances as well as legacy saved bricks.
   Autosave and explicit saving preserve the effective model in IndexedDB.
5. Open **Steine**, choose a library part, and tap the construction surface to
   place the resolved LDraw geometry in the active color.

Hardware-accelerated views raycast the original instance IDs. The reduced
software compatibility view picks the actual sampled triangles and highlights
the selected part's visible triangles. Software detail reduction remains
explicit: geometry not displayed in that preview cannot be picked by touching
an invisible surface.

## Data safety and export boundaries

- Edits use immutable instance snapshots. Original uploaded bytes, source text,
  sections and unknown source metadata remain unchanged inside the project.
- Late geometry acquisition enriches each historical snapshot independently.
  It cannot restore a deleted instance or replace its edited color/transform.
- Internal JSON preserves effective edits, original sources and the edited flag.
  Use it as the complete application project backup.
- LDR export writes current instance transforms and colors as a flat list;
  it does not embed custom geometry. An unchanged MPD retains its original text.
- Edited MPD and minimal IO retain the source hierarchy and all embedded LDraw
  sections (including inline surfaces, custom geometry, comments and licenses).
  Reference-line occurrence paths distinguish repeated submodels. Only changed
  occurrences need new submodel variants; identical variants are shared.
  Effective colors and world transforms are converted back to local coordinates.
  Deletions affect only the selected occurrence. Added parts are written at root.
  Singular or unsafe inverse transforms (or otherwise unrepresentable inherited
  main colors) lift affected edited leaves to root
  instead of inventing a local transform; ancestor inline geometry stays intact.
  External library files are still library dependencies, not bundled snapshots.
- Old JSON projects without occurrence paths can export unambiguous source paths.
  Ambiguous repeated paths fail explicitly rather than guessing which occurrence
  was edited or deleted. Keep the JSON backup in that case.
- Unknown LDraw metadata is retained as text, **not semantically rewritten**.
  Commands tied to old indices, submodel names, textures or proprietary extensions
  may no longer apply after edits. Minimal IO contains generated `model.ldr`
  and `.info` only; it does not copy instructions, LXFML, textures, Studio geometry
  or unknown proprietary archive records. Its generated `.info` discloses this.
  Original bytes, source sections and unknown archive records remain untouched
  in internal JSON. This is not a lossless Studio round trip; keep both backups.
- Section/size limits and invalid occurrence identifiers fail explicitly.
  Synthetic regressions verify the export algorithm, not general Studio
  compatibility. Real-fixture checks only establish the specifically tested
  LDraw round trip; no claim is made that Studio opens these generated archives.
- The two locally supplied IO fixtures were checked after a single-occurrence
  rotation and a separate deletion: the effective leaf matrices/colors and
  reachable inline geometry survived generated IO → LDraw parsing. These are
  local-only fixtures (429 and 8,590 initial leaf instances), not public samples
  or proof of compatibility with other Studio files or Studio itself.
- No proprietary Studio resources or source code are used.

## Verification

Automated regression tests cover individual-instance changes, source fidelity,
four-turn transform stability, undo/redo, IndexedDB and internal JSON round trips,
effective LDR/MPD/IO exports, repeated and nested submodels, occurrence-specific
variants, embedded geometry and metadata retention, late geometry enrichment, library placement,
geometry-buffer sharing, hardware instance bounds and software triangle picking.

Browser verification uses a small original arrangement referencing official
LDraw parts. Mobile browser emulation is not a physical Android-device test.
Real Android GPU and touch-device certification remain outstanding.
