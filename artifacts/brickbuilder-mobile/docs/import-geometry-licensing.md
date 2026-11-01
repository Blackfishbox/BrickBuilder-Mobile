# Geometry snapshot for model import

The additional `public/parts/import-geometry-2026-10-31.bin` snapshot contains
only 74 official LDraw main parts and their recursive dependencies: 321 files
in total. It is independent of the installable catalog packages and does not
change their interfaces. No embedded Studio files are copied into it.

Source: <https://library.ldraw.org/library/updates/complete.zip>
(official library, retrieved 2026-10-31). Original file URLs, authors and
license information are included per file, together with `CAreadme.txt` and
`CAlicense4.txt`.

Every file was checked for an explicit CC-BY-4.0, dual CC-BY-2.0-and-CC-BY-4.0,
or CC0 header and an LDraw-Org header. For dual headers, the offered CC-BY-4.0
license is used. Original headers, credits and history remain unchanged.
BrickBuilder changes: selection, gzip packaging and search metadata, not
original LDraw file content.

Compressed snapshot SHA-256:
`3611c261dc046428a019a0625bea3d7156d73de2244d9fe92413908e06dbaf6f`.
Size: 98,923 bytes. The app checks both hash and byte length on download.
The `.bin` extension is intentional: gzip is the internal package format,
not HTTP Content-Encoding. Automatic HTTP decompression would change the
checksum of bytes read by `fetch`.
The snapshot is deliberately generated, never automatically updated during
app builds. The explicit maintenance script accepts a locally downloaded
official archive via `LDRAW_ARCHIVE` to avoid many individual requests.

Geometry, authors and legal documents remain in the local project after import,
including JSON backups. LDR/MPD/minimal IO export references library files
without embedding geometry copies. The user's file is read only as a private
reference and is not included in the public snapshot or build.

Color names and RGB values are an explicit subset of LDConfig.ldr.
Separate BrickLink color numbers are documented in the color resolver with
source links and review date. Number equality is never inferred.

This documents a technical provenance/license review, not legal advice.
