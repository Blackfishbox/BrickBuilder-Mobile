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
- LDR export writes current instance transforms and colors. An unchanged MPD
  can retain its original text. **Edited MPD and minimal IO exports flatten the
  effective instance list.** This is not a lossless Studio document round trip.
  Original hierarchy, embedded/custom geometry and unknown archive records are
  not guaranteed to be represented by those flattened exports; retain the JSON
  project and original IO file. The export dialog states this boundary.
- No proprietary Studio resources or source code are used.

## Verification

Automated regression tests cover individual-instance changes, source fidelity,
four-turn transform stability, undo/redo, IndexedDB and internal JSON round trips,
effective LDR/MPD/IO exports, late geometry enrichment, library placement,
geometry-buffer sharing, hardware instance bounds and software triangle picking.

Browser verification uses a small original arrangement referencing official
LDraw parts. Mobile browser emulation is not a physical Android-device test.
Real Android GPU and touch-device certification remain outstanding.
