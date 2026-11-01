# Standard plate regression fixture

`3795.dat` is the original LDraw Plate 2 x 6 by James Jessiman, official
2025-09 revision. It was retrieved from the project's already approved,
hash-verified offline LDraw archive through `/api/ldraw/file?path=parts/3795.dat`.
Only line endings and the final newline are normalized.

License: CC BY 4.0. The original author and history remain in the file.
See `public/licenses/connections/careadme.txt` and the LDraw attribution
documents shipped with the application for the source library's legal texts.

The regression suite combines this source with the existing licensed bundled
plate package and source fixtures. Its legacy 3023 fixture inlines the actual
3023b subpart and stud-group references; it does not invent replacement meshes
or fabricate connection coordinates.

## Additional reviewed standard sources

The following original files come from the existing approved complete official
archive SHA-256
`023083918da2d3697c794fb4267975509584f3611b993095874206a803fa610f`,
not a private Studio upload. CRLF is normalized to LF and trailing blank lines
may differ; geometry, headers, credits and history are unchanged.

| Fixture | Original official path | Author | Original byte SHA-256 |
| --- | --- | --- | --- |
| `3023a.dat` | `parts/3023a.dat` | Rene Rechthaler [Blechtaler] | `f49389ea0cffbc83346724fea5a1718a7e8a2c3d8d664736f8aab75233516659` |
| `3066.dat` | `parts/3066.dat` | James Jessiman | `f19b499123538e6606e283c970431ee261c8698d1f810a1e030a56b936c970fb` |
| `3066s01.dat` | `parts/s/3066s01.dat` | Michael Heidemann [mikeheide] | `7d672572665200218f4b3ffa05e94f6ace7b99a3f5c306681d0f879961cc7b13` |

Source URLs use `https://library.ldraw.org/library/official/` plus the original
path. All three explicitly offer CC BY 4.0; the legal texts above apply.
Existing approved brick/plate/import snapshots provide recursive dependencies.

The 3023a supplement is first-party metadata, derived from the reviewed cavity
and flat pin: two S6 openings at (-10,8,0) and (10,8,0), each 4 LDU deep.
Its root must match this retained original source before it is used.
The root's two box primitives establish the cavity; the explicit flat pin
does not obstruct either stud insertion. Source-triangle clearance and real
pairing regressions verify this, rather than borrowing 3023b metadata.

3066 demonstrates a different defect: current physical subpart sockets coexist
with an obsolete root metadata include of another part. The installed physical
source must win at coincident ordinary sockets. It must not be counted twice.
