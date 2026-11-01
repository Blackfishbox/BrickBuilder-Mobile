# Build from a local parts list

The construction drawer has **LDraw-Katalog** (unrestricted) and
**Meine Teileliste** (quantity-limited) tabs. Lists and allocations are private,
project-local IndexedDB data. They are never sent to BrickLink or uploaded.
The public catalog snapshot and licensed LDraw geometry may be downloaded;
install/cache these while online before relying on offline construction.

## Accepted formats

Only UTF-8 BrickLink inventory/wanted-list XML and the following CSV template
are supported. Arbitrary spreadsheet formats, semicolon-separated CSV, live
BrickLink accounts, purchasing, pricing and automatic assembly are not supported.

```csv
part_id,color_id,quantity
3001,5,2
3001,7,1
```

The header is exact. CSV uses commas, optional quoted fields and doubled quotes;
LF/CRLF and a UTF-8 BOM are accepted. IDs are BrickLink IDs, **not** LDraw or
Rebrickable IDs. Quantities are positive decimal integers.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<INVENTORY>
  <ITEM>
    <ITEMTYPE>P</ITEMTYPE>
    <ITEMID>3001</ITEMID>
    <COLOR>5</COLOR>
    <MINQTY>2</MINQTY>
    <REMARKS>Self-authored example</REMARKS>
  </ITEM>
</INVENTORY>
```

XML requires `INVENTORY/ITEM`, `ITEMTYPE`, `ITEMID`, `COLOR` and either `QTY`
or `MINQTY`. Conflicting quantity fields, duplicate fields, nested item fields,
malformed XML, DOCTYPE and entity declarations are rejected. Additional scalar
item metadata is retained. Non-`P` item types remain visible as unsupported and
cannot be placed. Limits: 2 MiB UTF-8, 5,000 source rows, 100,000 units per
aggregated row, part IDs up to 80 alphanumeric/underscore/hyphen characters.

Parsing and reverse catalog resolution run in the existing catalog worker,
not on the UI thread. Identical item-type/part/color rows aggregate in source
order, retaining their original row numbers and scalar metadata. Preview lists
every resulting row's exact quantity, duplicate source rows, candidate mappings
and unsupported entries before confirmation; large lists are paginated.
Cancelling or validation failure does not alter the project.

## Resolution and placement

Resolution uses the existing approved catalog provider and its actual direction
flags: BrickLink import -> Rebrickable identity -> LDraw export. It never infers
an ID from a filename or substitutes a generic brick. Multiple part or color
candidates require an explicit choice. Unknown entries retain their BrickLink
numbers so the source list can be corrected. A confirmed mapping alone does not
guarantee that licensed geometry is available; real geometry is prepared through
the existing resolver before selection succeeds. Failed/cancelled preparation
does not allocate anything.

Every successful list-origin placement records a source list ID and row ID on
the effective instance. Remaining stock is total minus effective allocations,
checked synchronously against the latest document during the same immutable
placement commit. Fast repeated taps and stale selections cannot overspend a
row. Moving, rotating and visually recoloring keep the original reservation.
Future placements retain the chosen source-row color even if the editor palette
changes. Deleting returns the unit; undo/redo restores model and allocation
together. Existing model imports and unrestricted catalog placements consume
nothing. Choosing a catalog part explicitly exits list placement mode.

## Saving, replacement and backups

The list, original IDs, quantities and per-instance allocations are saved with
the local project, including autosave. Older projects without inventory remain
valid and their instances are never retroactively charged. Project switching
clears pending placement selection. Internal JSON validates orphan allocations,
duplicate row/instance IDs and over-allocation before accepting a backup.

Replacement is deliberately conservative: while **any** source-list instances
remain, replacing/reimporting a list is blocked. Remove those instances first
or start a new project. When no allocations remain, preview confirmation
explicitly replaces the entire list with a new source identity. This change
is undoable and cannot silently refill stock used by retained instances.

**Internal project JSON is the complete inventory-preserving backup.**
LDR/MPD/IO exports describe the model but do not encode application-specific
inventory allocations. Original uploaded IO bytes and metadata are unchanged.

## Verification boundary

Synthetic automatic tests cover bounded parsing, duplicate aggregation,
directional aliases/variants, per-color stock, failures/cancellation, rapid
placement, editing/deletion/history, legacy projects and IndexedDB/JSON
round trips. A mobile browser check uses only self-authored list/model data.
Browser emulation is not physical Android-device verification.
