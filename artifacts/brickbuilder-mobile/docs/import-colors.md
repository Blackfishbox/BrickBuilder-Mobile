# Imported colors

## Corrected behavior

The original importer knew only eight reviewed LDraw appearances. Valid colors
outside that subset, including yellow (14), green (2), light bluish grey (71)
and dark red (320), consequently rendered as the magenta warning material.

The application now bundles 320 color appearances from a deliberate official
`LDConfig.ldr` snapshot, available without a network request. Control codes 16
(inherit current color) and 24 (edge color) are not ordinary material colors.
The raw source codes remain LDraw codes and are never reinterpreted as BrickLink
numbers. Explicitly reviewed BrickLink color mappings remain separate;
adding an RGB value does not invent a catalog mapping.

The reviewed mapping subset now contains eleven entries. The following factual
identifiers were checked against the official
[BrickLink color guide](https://www.bricklink.com/catalogColors.asp) on
2026-11-01; LDraw appearance still comes from the independent LDConfig snapshot:

| LDraw code | LDraw name | BrickLink ID | BrickLink name |
| --- | --- | --- | --- |
| 288 | Dark_Green | 80 | Dark Green |
| 297 | Pearl_Gold | 115 | Pearl Gold |
| 8 | Dark_Grey | 10 | Dark Gray |

Missing confirmed cross-catalog mappings and general IO feature-scope notes are
shown in a separate, collapsed **Katalog- und Formatinformationen** section.
They do not mean ordinary LEGO content is invalid, absent or incorrectly colored.
Real missing geometry, unknown appearance codes and conflicting evidence remain
import warnings. The same classification applies to older saved issue codes.
Unconfirmed part numbers are not guessed, and no wholesale BrickLink catalog
or proprietary Studio resources are bundled.

Resolved colors and obsolete color warnings are refreshed when opening older
projects, including internal JSON imports. This changes derived appearance and
report data only: source codes, matrices, source text, original uploads and part
resources are retained. Geometry with fixed surface colors still resolves those
colors independently of its parent instance.

WebGL lighting is now achromatic and bounded instead of a strong warm key with
a greenish ambient contribution. Both the WebGL and software renderers resolve
the same source palette. Shading and transparency still differ between rendering
paths; this is not a claim of pixel-identical Studio rendering or realistic
chrome, pearl, glitter, glow or translucent material simulation.

## Source, attribution and redistribution

- Author/attribution: **LDraw.org**.
- Source: <https://library.ldraw.org/library/official/LDConfig.ldr>.
- Source update: **2026-05-29**; reviewed **2026-11-01**.
- Original source UTF-8 SHA-256:
  `d3490047460ad7a511b150006b009830fc52ecc1899b514c7380e9de644b3cfb`.
- Extracted facts: numeric code, original color name, RGB `VALUE`, and `ALPHA`
  (255 when omitted). Control codes are excluded. No Studio palette or
  BrickLink database is copied.
- LDraw.org legal information: <https://www.ldraw.org/legal-info>. That page
  offers original LDraw.org-specific content under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- The configuration itself has no individual geometry `!LICENSE` header.
  This normalized factual color table is **not** a certification that every
  downloadable geometry file has that license. Existing per-file geometry
  validation rules remain unchanged.
- Normalization/selection: BrickBuilder Mobile. Attribution, source version,
  exact source hash and this distinction are also retained in local projects.
  No endorsement by LDraw, BrickLink or LEGO is claimed.

Updates are deliberate maintenance changes, never an automatic library refresh
at build time. Keep factual values synchronized with the reviewed source and
retain independent evidence for any additional BrickLink mapping.

## Verified scope and remaining gaps

The private encrypted model contains 51 effective source color codes. Of these,
49 now resolve through the official table. Codes `1009006` and `1009007` are not
defined in the reviewed configuration or in that model's `!COLOUR` declarations;
they remain explicitly reported with magenta warning geometry rather than
being assigned a guessed color.

Automated tests cover RGB values, alpha, direct colors, inherited submodel and
subpart colors, fixed multicolor surfaces, Three.js material construction,
saved-project reopening and the actual private model when locally available.
Arbitrary custom `!COLOUR` declarations and physical Android/Studio visual
matching are not claimed.
