# Missing geometry resolver verification

## Sources and exact-byte transport

The approved source is the official LDraw library, with separately checked
CC BY 4.0/dual CC BY 2.0 and 4.0 headers (choosing 4.0), or CC0 headers.
Authors, original comments and source bytes remain unchanged. Required legal
texts are included. No Studio private resource archive, catalog-picture mesh
or inferred BrickLink equivalence is used.

The explicitly downloaded official complete archive used for this verification
had SHA-256:

```text
023083918da2d3697c794fb4267975509584f3611b993095874206a803fa610f
```

It supplied 37,153 selected geometry/legal files, about 500 MiB expanded on the
server. None of this archive is committed or sent wholesale to a phone.
This is a source snapshot identity, not an upstream cryptographic signature.

An actual request through the HTTPS development preview to
`/api/ldraw/file?path=parts%2F3004.dat` returned **670 bytes** without a
`Content-Encoding` transformation. Both response bytes and approved raw file
had SHA-256:

```text
e1caee3b32175393c9d6ea176a47f8869173a01d03a451e1cfe10d09167c0203
```

Traversal returned HTTP 400; a cross-site browser request returned HTTP 403.
Standalone provider tests additionally verify bounded concurrency, negative
caching, 404/429/Retry-After, oversized data, timeouts, rejected licenses and
changed archive bytes. Client tests cover recursive compilation, normalized
duplicate instances, primitive fallback, cycles, missing dependencies,
unsupported licenses, malformed data, exact BOM/CRLF hashes, cancellation and
retry, quota failure, saved-model reopening, JSON metadata roundtrip and reuse
on later imports without an API.

## Private encrypted reference measurement

The local optional regression uses the private original upload only when
present; it never ships that file. It uses the approved archive's actual raw
bytes through the same client response-validation contract. Actual proxy-byte
transport was checked separately above.

| Measurement | Result |
| --- | ---: |
| External type-1 instances parsed | 8,590 |
| Distinct external references | 517 |
| References covered by bundled snapshot alone | 54 |
| References with complete compilable graphs after resolution | 487 |
| Renderable instances after resolution | 8,536 |
| Remaining distinct references | 30 |
| Remaining instances | 54 |
| Geometry resources retained in the model | 1,313 |

The test verifies the exact original upload SHA-256 is unchanged and saves/
reopens the result with networking disabled. Availability is measured after
recursive graph collection and compilation for effective colors, not by file
existence or successful HTTP status.

The 30 unavailable original references and instance counts:

```text
bl_85984pb176.dat (1)   85984pb127.dat (1)      93592.dat (1)
973pb3863.dat (1)      bl_3626cpb2914.dat (1)  4079b.dat (10)
25269pb003.dat (4)     bl_14718pb059.dat (1)   bl_69729pb067.dat (2)
bl_14769pb570.dat (1)  3626cpb1567.dat (1)     3626cpb0852.dat (1)
25379.dat (1)         2436c.dat (3)           14769pb244.dat (1)
bl_973pb4540.dat (1)   973pb3540.dat (1)       bl_3626cpb1966.dat (1)
36036pb05.dat (1)     973pb0322.dat (1)       bl_3626cpb2537.dat (1)
29685pb01.dat (1)     bl_69729pb065.dat (1)   bl_69729pb066.dat (1)
bl_973pb4947.dat (1)   62821b.dat (1)          731c03.dat (2)
41837-1.dat (2)       softaxleendtip.dat (8)  98138pb085.dat (1)
```

These names are preserved **model references**, not asserted BrickLink catalog
IDs. An unavailable alias or printed variation is not replaced with a guessed
base part. Other approved libraries or explicit mapping evidence could be
considered separately; this measurement does not claim universal compatibility.
Inline triangle-only flexible submodels remain source-only and out of scope.

## Reproduce

The mobile browser pass used a small self-authored fixture with `6111.dat`
and a nonexistent reference. It confirmed visible real geometry, German
missing-reference counts, cancellation/retry and closing during a delayed
request, preservation of the original saved builder project, no resolver calls
when reopening a saved import with the API blocked, and no API calls on a
subsequent cached-only import. Portrait 402×874 and landscape 874×402 had no
horizontal overflow. Quota rollback is covered by the standalone suite rather
than fault injection in the browser. Whole-app installed offline operation was
not tested by this development-workflow pass.

Verification passed: 51 frontend tests, five provider tests, workspace type
checking and the production PWA build. The existing approximately 536 kB
uncompressed Three.js chunk still produces Vite's size advisory.

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/brickbuilder-mobile test
pnpm run typecheck
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile build
```

The reference case skips if either private model or locally approved archive
is absent. Independent synthetic cases always run. The editor can be hosted
statically without a resolver; use the optional setup in
[the hosting guide](../../../../docs/setup-and-hosting.md#optional-ldraw-resolver)
to resolve new missing files.

Physical Android/GPU acceptance and a full installed-PWA airplane-mode test
are not established by these standalone checks.
