# BrickBuilder Mobile

A local-first, installable 3D brick-building PWA with a **German application
interface**. Build with verified LDraw geometry, save projects in your browser,
install reviewed LDraw parts packages, and import IO, LDR, MPD or internal JSON
models. No account, paid service or application API is required for the frontend.

Import support is bounded, not a claim of general BrickLink Studio compatibility.
Imported parts can be selected individually, moved, rotated, recolored and
deleted with undo/redo and local persistence. The parts picker contains only the
LDraw library; existing legacy procedural bricks remain supported in saved projects.
See the [editing guide](artifacts/brickbuilder-mobile/docs/editing.md) for workflows
and the explicit limitations of edited MPD/IO export.
See the [application documentation](artifacts/brickbuilder-mobile/README.md)
for supported formats, verification history and limitations.

## Quick start

Tested environment: **Linux x86-64, Node.js 24.22.1, pnpm 10.26.1**.
The current lockfile and native-package overrides target Linux x86-64;
other operating systems and CPU architectures have not been validated.
Install that pnpm version, for example with `npm install --global pnpm@10.26.1`,
then run:

```sh
git clone https://github.com/Blackfishbox/BrickBuilder-Mobile.git
cd BrickBuilder-Mobile
pnpm install --frozen-lockfile
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run dev
```

Open <http://localhost:4173/>. Both `PORT` and `BASE_PATH` are required by the
Vite configuration, including for builds and production previews.
The commands use POSIX shell environment-variable syntax.

## Check and build the standalone frontend

```sh
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run serve
```

The static deployment directory is
`artifacts/brickbuilder-mobile/dist/public/`, not the repository root.
Production preview is for local verification, not an internet-facing production server.

**[Setup and hosting guide](docs/setup-and-hosting.md)** covers clean installs,
static hosting, root/subpath deployments, HTTPS/PWA caching, browser storage,
optional API services and troubleshooting.

## Repository map

- `artifacts/brickbuilder-mobile/` — React, TypeScript, Vite, Three.js, Dexie and PWA.
- `artifacts/brickbuilder-mobile/docs/` — architecture, import evidence and licensing.
- [Large-model performance](artifacts/brickbuilder-mobile/docs/performance.md) — rendering budgets, reference measurements and device-testing limits.
- `artifacts/api-server/` — optional same-origin LDraw resolver; no database or API key required.
- `lib/` — workspace libraries, API contracts and optional database support.
- `scripts/` — maintenance and sanitized GitHub backup utilities.
- `artifacts/mockup-sandbox/` — separate development preview; not needed to host the app.

## Contribution and distribution rules

First-party documentation, code comments, test descriptions and development-facing
explanations are **English**. Application labels, notifications, localized errors,
manifest locale and other user-visible content remain **German**. Preserve
third-party source files, original credits and authoritative license texts verbatim.
Use specific English commit subjects and bodies; do not rewrite existing history.

GitHub backups are sanitized source snapshots, appended by fast-forward push.
Private uploads, credentials, local agent context and generated output must not
be included. Tests needing private uploads skip explicitly when those files are
absent; independent synthetic regressions run normally.

LDraw resources are separately licensed from application code. See
[parts licensing](artifacts/brickbuilder-mobile/docs/parts-licensing.md),
[import geometry licensing](artifacts/brickbuilder-mobile/docs/import-geometry-licensing.md)
and [BrickLink mapping evidence](artifacts/brickbuilder-mobile/docs/bricklink-mapping-licensing.md).
No endorsement by LEGO, BrickLink or LDraw is claimed.

## Optional missing-part downloads

Import checks the saved model, installed packages, verified local cache and bundled
snapshot before trying `/api/ldraw/file`. The optional resolver obtains original
licensed LDraw files and recursive dependencies, not catalog images or guessed
BrickLink identifiers. Without it the editor, local parts and saved geometry
still work offline. See [resolver setup](docs/setup-and-hosting.md#optional-ldraw-resolver)
for free self-hosting, bounded live requests and explicit official-archive approval.
