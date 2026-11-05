# Dependency security review

Reviewed on **2026-11-02**, using Node.js 24.22.1 and pnpm 10.26.1 on
Linux x86-64. This is a point-in-time dependency and reachability assessment,
not a penetration test or a guarantee that self-hosting is secure.

## Result and scope

The historical GitHub notice reported 19 alerts (6 high, 10 moderate, 3 low).
Its original alert export was not available, so those exact historical counts
cannot be independently reconstructed. The checked-out root manifest, every
workspace manifest in `artifacts/`, `lib/` and `scripts/`, and `pnpm-lock.yaml`
were checked against fresh advisory data, not against that notice alone.

| Check | Before | After |
| --- | --- | --- |
| Dependency scanner (OSV), advisory/version pairs | 21: 7 high, 12 moderate, 2 low | 4 moderate; no high or critical |
| `pnpm audit --json`, advisory/version occurrences | 21: 7 high, 11 moderate, 3 low | 4: 3 moderate, 1 low |
| `pnpm audit --prod --json` | Not used as the baseline | 0 |
| Static code scanner | 1 high path-traversal warning | Existing protection verified; see below |
| Privacy/dataflow scanner | 0 findings | Source dataflows unchanged |

The remaining four package/version pairs cover three distinct advisories.
OSV rates deepmerge moderate; the npm registry rates it low. Use the higher
rating for prioritization. Neither scanner's severity alone proves reachability.
In particular, `--prod` is **not** a browser-bundle audit: this repository
intentionally declares browser libraries, including Zod, as devDependencies.

No paid service, firewall bypass, release-age exception or blanket major
upgrade was introduced. The one-day minimum package release age and existing
platform policy remain enabled. No production deployment was performed.

## Fixed findings, ordered by practical exposure

### 1. API request parsing: remotely reachable denial of service

**High:** [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
`express@5.3.0 → body-parser@2.3.0` was present in the production API graph.
`artifacts/api-server/src/app.ts` enables JSON and extended form parsers before
routing, with decompression enabled. Thus an unauthenticated request could
trigger the decoder failure, even for an unknown route. Updated the compatible
transitive dependency to **body-parser 2.4.0**, without changing Express's major
or disabling supported request formats.

Also updated **qs 6.16.0 → 6.17.1** within Express's existing range:
[GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw),
moderate. Its prerequisite is `stringify(..., { arrayFormat: "comma" })` on
untrusted objects; no such application call was found. This was a production
dependency finding, but not a demonstrated exploitable route.

`artifacts/api-server/src/lib/request-parsing.test.mjs` runs in a child process:
gzip, deflate and Brotli requests with trailing garbage are tested against both
enabled content types. A subsequent health request must succeed after each
payload. Ordinary JSON parsing must also still work.

### 2. Browser import validation and shared schemas: Zod memory exhaustion

**High:** [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Both **3.25.76** and **4.6.5** were locked. The frontend uses Zod to validate
imported projects, inventories and installed parts packages. A malicious file
opened by a user is a relevant input boundary; this is not an unauthenticated
server-side array-validation endpoint. The API currently uses a small health
response schema; the optional database library has no active array-input route.

There is no fixed 3.x release. The **targeted** catalog change to **4.6.7**
removes both vulnerable branches rather than forcing a major override onto an
unknown transitive consumer. Existing schemas use two-argument records and
required no manual schema rewrite. All frontend tests passed, including internal
project round trips, inventory validation/persistence and parts-package checks.
Orval now explicitly generates for Zod 4 and React Query 5, matching the installed
runtimes; generated outputs are included.

This does not make arbitrarily large JSON safe. Existing file-size and import
limits must remain; do not expose these schemas to unlimited remote payloads.

### 3. Code generation HTTP client: eight undici advisories

The old path was `lib/api-spec → orval@8.41.0 → @scalar/json-magic@0.15.6 →
undici@7.29.1`. Updated the direct parent to **Orval 8.46.0**, which resolves
Scalar 0.16.1 and **undici 7.30.1**. This is a compatible minor parent upgrade,
not a global undici major override.

| Advisory | Severity | Condition |
| --- | --- | --- |
| [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) | High | Custom function-valued TLS verification under `tls` |
| [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26) | High | Shared cache and redirect interceptors in affected composition |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) | High | Malicious HTTPS peer renegotiating TLS 1.2 |
| [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) | High | Malicious response with excessive content encodings and early close |
| [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) | Moderate | EventSource connection to a malicious peer |
| [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6) | Moderate | Decompress interceptor with a throwing handler |
| [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) | Moderate | WebSocket connection to a malicious peer |
| [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) | Moderate | Non-lowercase SRI algorithm tokens |

Code generation currently reads the repository's local `openapi.yaml`. There is
no application code using these optional interceptor, SSE, WebSocket or custom
TLS configurations. These packages are not the browser's fetch implementation
and are not bundled into the API runtime.

**Important:** updating the npm package does not patch Node's built-in fetch.
The runtime used for verification reports `process.versions.undici === "7.30.1"`.
Self-hosters must independently maintain a security-patched Node 24 runtime.
The optional live LDraw provider uses built-in fetch, restricted fixed sources,
timeouts and size limits; the configured API restores an approved archive and
does not use the live fallback.

### 4. Build-time URI and CSS processing

- **fast-uri 3.1.8 → 3.1.9**, via the existing 3.x override, covers
  [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) (low),
  [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) (moderate),
  [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) (moderate),
  and [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) (low).
  Paths run through AJV under Workbox and Orval/Scalar. No application URL
  authorization, HTML URL rendering or user-supplied suffix normalization uses
  this package.
- **postcss-selector-parser 6.0.10 → 6.1.5**, covers moderate
  [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).
  The latest `@tailwindcss/typography@0.5.20` still pins 6.0.10 exactly, so a
  parent-scoped override is necessary. Trusted repository CSS is processed
  during builds; there is no user CSS parsing service. Production builds pass.

## Remaining findings: build-only, not silently ignored

| Package/version and advisory | Actual path / exposure | Reason retained |
| --- | --- | --- |
| deepmerge 4.3.1, [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), moderate OSV / low npm | PWA → Workbox → Rollup node-resolve; merges built-in resolver defaults, not request JSON | Latest release is affected; no published fix reported |
| glob 11.1.0, [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate | PWA → Workbox; build-time `globSync` over local output, with repository-authored patterns, no AbortSignal budget | Reported fix 14.0.2 is outside the parent's supported major |
| minimatch 10.2.6, [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | Workbox → glob; patterns fixed in `artifacts/brickbuilder-mobile/vite.config.ts` | Reported fix 11.0.1 requires a major jump |
| minimatch 5.1.9, same advisory, moderate | Workbox → off-main-thread plugin → ejs → jake → filelist; tooling, no application input path | Scanner lists all versions before 11.0.1; no compatible 5.x fix reported |

The latest PWA plugin (2.0.0) and Workbox (7.4.1) were checked. No patched
compatible parent was available. Do not apply broad major overrides simply to
make the counters zero: older glob/filelist integrations may require incompatible
APIs. The scanner's minimatch range is broader than the specifically described
10.2.6 proof; retain both findings rather than claim 5.x is proven safe.

**Operating restriction:** build only trusted source, configuration, templates
and local trees; do not offer this build chain as a service for untrusted
repositories or attacker-supplied glob patterns. Serve `dist/public` as static
files, not Vite's development server. Recheck these advisories when upstream
parents publish fixes. No advisory is excluded from audit output.

## Static warning: LDraw archive path

The static scanner flags the file read in
`artifacts/api-server/src/lib/ldraw-provider.ts` as high
(`javascript.express.file.fs-express.fs-express`). Inspection found existing
controls: `normalizePath` accepts only approved legal filenames or restricted
`parts/` and `p/` `.dat` references, the file must appear in the approved manifest,
`realpath` resolves symlinks, the resolved path must begin with the canonical
archive root **plus a separator**, and size and SHA-256 are checked.

A new regression test supplies a correctly hashed outside file through an
in-archive symlink, as well as raw and encoded traversal inputs. All are rejected.
The warning is assessed as **mitigated by existing validation**, not deleted or
suppressed; a future static scan can still report it. The archive is
operator-controlled: make it read-only to untrusted local users. This check
does not protect against a privileged local writer racing file replacement
between `realpath`, `stat` and `readFile`.

## Verification and reproduction

Successful checks:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/brickbuilder-mobile run test
pnpm run typecheck
PORT=4173 BASE_PATH=/ pnpm run build
pnpm audit --json
pnpm audit --prod --json
```

Full audit correctly exits nonzero for the retained toolchain advisories;
production audit exits zero. API tests: **10 passed**. Frontend:
**788 passed, 6 skipped**, across 35 passing and one skipped test file. Skipped
tests are existing skips, not security exceptions introduced by this change.
The root build includes the final full-workspace typecheck and all three builds.
Code generation completes without a version-inference warning.

Builds emit non-fatal large-chunk and third-party Zod pure-comment warnings;
the API emits an existing cloud-storage credential-option deprecation warning.
All three development workflows restart successfully, `/api/healthz` returns
`200 {"status":"ok"}`, and the initial frontend preview loads without browser
errors. The screenshot catches the lazy 3D canvas during loading; it is not an
interactive WebGL test. No browser journey, external host/Nginx configuration,
OS package audit, production database check or live penetration test is claimed.

Raw scan JSON, dependency paths and command logs from this run are in ignored
`generated-artifacts/security/` for local inspection; they are not required for
installation and are not committed or deployed. Advisory IDs, versions,
reachability decisions and reproducible commands above are the durable evidence.
