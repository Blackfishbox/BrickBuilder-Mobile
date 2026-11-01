# Older encrypted Studio IO files

## Reproduced failure

The private user file `attached_assets/40649-size_1793502923137.io` is a ZIP32
archive with 122 entries, about 4.6 MiB compressed and 22,599,896 declared
uncompressed bytes in total. Its metadata identifies Studio `2.23.5_1`.

Entries use traditional PKZIP encryption, which the previous reader rejected.
Also, `model2.ldr` is 17,776,068 bytes, exceeding the 16-MiB limit previously
applied to every entry, although that additional Studio geometry need not be read.

## Implementation

- The IO adapter additionally supports the documented fixed Studio format
  encryption; no password search or user credentials.
- The format convention is publicly documented:
  <https://wiki.ldraw.org/wiki/IO>.
- All ZIP names, local headers, ranges and total sizes are validated.
- Only `model.ldr` is decrypted/decompressed. Actual size and CRC are checked;
  output buffers remain bounded.
- Other entries stay unchanged in the original upload. They are neither
  executed nor copied into the licensed parts library.
- General ZIP use outside the IO adapter still rejects encrypted archives.

## Actual verification

The private import regression runs locally only when the upload exists and
otherwise skips explicitly. It reads 8,590 resolved type-1 instance references
with 517 distinct external part references and verifies that original upload
bytes remain unchanged.

Studio metadata instead reports 8,586 parts. That value is not blindly adopted
as the parser result. The model also contains four flexible submodels described
only with triangles. The current parser preserves those geometry lines in the
source and reports them, but does not render them as surfaces.

The bundled geometry dataset covers only some of the 517 references.
Installed packages can extend the available resources. Missing standard parts
are shown in a notification with reference/count; unconfirmed color mappings
retain their warnings. Complete rendering or visual equivalence with Studio
has therefore **not** been demonstrated.

Independent self-authored text fixtures encrypted with Info-ZIP test stored
and DEFLATE-compressed entries, a wrong key, corrupt data, size discrepancies
and skipping large unused resources. These contain no private models and run
without uploads. A physical Android test remains outstanding.
