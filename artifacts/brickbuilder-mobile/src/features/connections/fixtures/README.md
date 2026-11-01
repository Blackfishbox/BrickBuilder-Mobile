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
