# Setup and hosting

## Complete catalog snapshot

The full mapping catalog needs an initial download, then uses IndexedDB offline.
The API serves only the pinned public object at the exact path in
`artifacts/brickbuilder-mobile/src/features/catalog/manifest.json`. Existing
App Storage service identity is used; no Rebrickable API key or paid catalog
subscription is needed. Start the existing API alongside the frontend, or serve
the approved bytes statically at that path.

For independent static hosting, first reproduce/obtain the approved snapshot
as described in the [catalog guide](../artifacts/brickbuilder-mobile/docs/complete-catalog.md).
After a frontend build, copy it under the **frontend base path**, for example:

```sh
mkdir -p artifacts/brickbuilder-mobile/dist/public/api/catalog/snapshot
cp generated-artifacts/catalog-sources/catalog.bin \
  artifacts/brickbuilder-mobile/dist/public/api/catalog/snapshot/ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c
```

Use the descriptor's actual digest when updating, serve `application/octet-stream`,
and do not add `Content-Encoding: gzip` or rewrite this binary route to index.html.
For a subpath installation, retain the catalog URL below that subpath or proxy it
to the matching API route. Do not deploy generated source downloads or private IO
fixtures. A missing/corrupt snapshot is visibly reported, not silently substituted
with fabricated catalog data. The old verified subset can still support the
editor, but cannot be described as full coverage.

## Scope and tested toolchain

The editor can run as a standalone static browser application. An optional
same-origin resolver downloads approved missing LDraw geometry during import;
it adds no accounts, cloud sync, paid provider, database or API key requirement.
Static-only hosting keeps local/offline editing and cached models available,
but cannot download arbitrary missing geometry.

Commands were checked on Linux x86-64 with **Node.js 24.22.1** and
**pnpm 10.26.1**. Use `node --version` and `pnpm --version` to check your tools.
Install pnpm with `npm install --global pnpm@10.26.1` if necessary.
Use pnpm, not npm or Yarn, for this workspace's dependencies.

The workspace overrides deliberately exclude non-Linux-x64 native package
variants. macOS, Windows, ARM and musl-based Linux are not validated by these
instructions. Changing that policy requires separate dependency and build testing;
do not assume the frozen lockfile is portable to those targets.

All commands below run from the repository root in a POSIX-compatible shell.
They work without `attached_assets/`, local agent files or Replit credentials.

## Install from a clean checkout

```sh
git clone https://github.com/Blackfishbox/BrickBuilder-Mobile.git
cd BrickBuilder-Mobile
pnpm install --frozen-lockfile
```

Keep `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root manifests and workspace
libraries together. Do not copy just the frontend directory: it declares local
workspace dependencies. Frozen installation must not rewrite the lockfile.
An ordinary install downloads packages from the configured package registry;
it does not require a database.

The frontend requires **no `.env` file, PostgreSQL, `DATABASE_URL`,
`SESSION_SECRET`, API token or GitHub connection**. Do not run
`scripts/post-merge.sh` as a general local setup command: it is an internal
merge hook that includes database/backup operations, not the app-only setup.

## Configuration

| Variable | Required for | Example | Meaning |
| --- | --- | --- | --- |
| `PORT` | Frontend dev, build and preview | `4173` | Positive TCP port; the config checks it even during a static build |
| `BASE_PATH` | Frontend dev, build and preview | `/` or `/brickbuilder/` | Public URL path, with leading and trailing `/` |
| `PORT` | Optional API process | `5000` | Separate API listening port |
| `LDRAW_APPROVED_DIR` | Optional resolver archive mode | Absolute reviewed archive directory | Uses an immutable official archive instead of live per-file requests |
| `DATABASE_URL` | Optional database library/schema tools | Your own PostgreSQL connection | Not used by the editor, health route or resolver |

Never put secrets in frontend build variables: browser bundles are public.
Replit's managed frontend workflow supplies its own `PORT` and `BASE_PATH`.

## Develop, test and build

```sh
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run dev
```

Open <http://localhost:4173/>. Stop with Ctrl+C. The development server has
the service worker disabled; it is not an offline/PWA acceptance environment.

```sh
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run serve
```

Open <http://localhost:4173/> for the built app. Stop preview with Ctrl+C.
The output is **`artifacts/brickbuilder-mobile/dist/public/`** and includes
`index.html`, hashed assets, icons, parts snapshots, the web manifest and
generated service-worker files. No Node process is needed to serve these files
on a static host. Do not upload source, `node_modules`, uploads or environment files.

The test suite always runs self-authored model/container tests, snapshot
integrity checks, format roundtrips, storage rollback and offline-reopen
regressions. Private-reference cases skip explicitly in a sanitized
checkout, including archive coverage when its approved archive is absent. If their original
local uploads exist, those cases run too. Do not publish or obtain private
models merely to remove those skips. A passing synthetic suite does not prove
general Studio compatibility.

Root `pnpm run typecheck` and `pnpm run build` cover **all** workspace packages,
including development previews and optional services. Use the filtered commands
above when installing or hosting only BrickBuilder Mobile.

## Static hosting at the domain root

1. Run the production build with `BASE_PATH=/`.
2. Configure your static host's publish directory to
   `artifacts/brickbuilder-mobile/dist/public`.
3. Serve its contents at `https://your-domain.example/`.
4. Return `index.html` for application navigation URLs that are not real files
   (SPA fallback). Serve actual assets normally and return real errors for
   missing asset/parts files, rather than returning HTML as a successful download.
5. Enable HTTPS and correct MIME types for JS, CSS, SVG and the web manifest.

Example Nginx location rules (after copying the build into `/srv/brickbuilder/`;
TLS certificate setup is host-specific):

```nginx
root /srv/brickbuilder;
location /assets/ { try_files $uri =404; }
location /parts/ { try_files $uri =404; }
location /icons/ { try_files $uri =404; }
location = /sw.js {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
}
location = /manifest.webmanifest {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
}
location / {
    add_header Cache-Control "no-cache";
    try_files $uri $uri/ /index.html;
}
```

Include the server's usual MIME type mapping. Do not apply `Content-Encoding:
gzip` to the `.bin` parts snapshots: gzip is their internal data format, and
the app validates the exact downloaded bytes. Transfer compression is only safe
if decoding leaves those original bytes intact.

## Hosting below a subpath

For a public path such as `/brickbuilder/`, rebuild with that exact path:

```sh
PORT=4173 BASE_PATH=/brickbuilder/ pnpm --filter @workspace/brickbuilder-mobile run build
PORT=4173 BASE_PATH=/brickbuilder/ pnpm --filter @workspace/brickbuilder-mobile run serve
```

Preview at <http://localhost:4173/brickbuilder/>. Mount the **contents** of
`dist/public/` at `/brickbuilder/`, not at `/`. Keep the trailing slash and
redirect `/brickbuilder` to `/brickbuilder/`.
Configure the host's navigation fallback to `/brickbuilder/index.html`, and
apply the asset rules above under `/brickbuilder/assets/`, `/brickbuilder/parts/`
and `/brickbuilder/icons/`. Cache-control exceptions must also use the prefix.

The build's Vite base, manifest start URL/scope, generated service worker and
parts URLs follow the configured base path. Do not move a root build to a
subdirectory without rebuilding. A repository-style static host may use a path
like `/BrickBuilder-Mobile/`; use that exact case if it is your chosen host's
path. These are examples, not a statement that a site has been deployed.

## HTTPS, PWA and update caching

Service workers and installability require a secure context: HTTPS for remote
hosts, with `localhost` allowed for local development. Plain HTTP on a phone's
LAN IP is not equivalent to localhost and is not a reliable PWA test.
Browser install support varies; the current manifest uses a local SVG icon.
Physical Android installation/offline acceptance is still outstanding.

The production worker precaches the app shell and bundled JS/CSS/icons/manifest,
uses an app navigation fallback and removes obsolete precaches. Registration
uses `autoUpdate` and the worker claims clients. Serve `index.html`, `sw.js`
and the manifest with revalidation/no-cache, not permanent immutable caching.
Hashed build assets may be cached long-term. Upload an internally consistent
build atomically where possible, including generated Workbox files; stale HTML
or worker files can otherwise request assets from a different release.

Parts `.bin` files are not precached by the worker. Library packages download
only on request; the additional reviewed import geometry snapshot loads when
needed during import. Offline use requires the initial app load and the needed
resources to finish successfully first. Complete newly resolved geometry graphs
and legal texts are saved in IndexedDB and in imported projects; reopening
does not contact the resolver. A later import can reuse that local cache.

## Where user data lives

Projects, autosave/recovery data, installed parts packages, search metadata,
original LDraw files, credits and legal documents live in **IndexedDB in the
user's browser**, not in a server-side uploads folder or PostgreSQL. Imported
projects also retain original upload bytes, source sections and resolved
geometry for offline reopening. JSON export is the full local project backup;
LDR/MPD/minimal IO exports are not substitutes for that backup.

Data is browser/profile/origin-specific. Changing domain, scheme or port does
not move existing data. Paths on the same origin are not separate IndexedDB
storage boundaries. Browser cleanup, private browsing or storage eviction can
remove data. Export JSON backups before clearing site data or changing hosts.
There is no account-based sync or server recovery. Clearing a service-worker
cache and deleting IndexedDB are different actions; avoid deleting user data
when troubleshooting stale app assets.

### User-controlled space management

Open the project menu → **Offline-Speicher verwalten** to inspect browser-reported
usage/quota and separate lists of saved projects, installed packages and reusable
import-geometry snapshots. Category sizes estimate UTF-8 JSON payloads, not actual
IndexedDB disk allocation or compressed download sizes. The browser's origin-wide
estimate can include app caches and other data, may be rounded, and may be unavailable.
It is not expected to equal the sum of category estimates.

Removing a reusable snapshot removes only its shared copy. Existing saved projects
retain their embedded geometry, original upload bytes, attribution and legal texts.
Future imports may need to retrieve those files again. Installed packages are never
automatically evicted to make room; removing one requires explicit confirmation.
It disappears from the parts library until the user reinstalls it.

Project deletion also requires confirmation and removes that project's local
original uploads and resources permanently. Export and verify a full JSON backup
first; downloading a backup does not itself delete anything. The currently opened
project is protected: switch to a different project before deleting it. Deleting
one project does not prune resources from other projects or remove shared packages
or reusable snapshots.

Full JSON backups are not subject to the 32 MiB source-upload transport limit:
embedded original byte arrays, decoded sections and resources can make a supported
source upload expand beyond that size. The file picker and importer share this
rule; decoded JSON model/resource validation limits remain in effect. Large
backups still require enough browser memory to parse and validate.

## Optional LDraw resolver

The existing Express service exposes `GET /api/ldraw/file?path=parts%2F3004.dat`
and `/api/healthz`. A static host cannot run Express. On any Node-capable host:

```sh
pnpm --filter @workspace/api-server run build
PORT=5000 pnpm --filter @workspace/api-server run start
# Alternatively, build and start in development:
PORT=5000 pnpm --filter @workspace/api-server run dev
```

The API already mounts routes below `/api`; its health endpoint is
`http://localhost:5000/api/healthz`. A reverse proxy must preserve `/api/`
when forwarding (do not strip it or add it twice). Give frontend dev/preview
and API different ports. Terminate HTTPS at your host/proxy.

Neither route imports the database module. The optional
`@workspace/db` library and schema tools require a separately configured
PostgreSQL `DATABASE_URL` if you choose to use them. Do not provision a database
for the standalone PWA. Any future server-side feature needs its own
configuration/security documentation.

### Development forwarding and production routing

The frontend deliberately calls the **API artifact's** `/api/ldraw/file`, not
`localhost` and not `${BASE_PATH}api`. `/api` is a sibling service prefix even
when the editor is mounted below `/brickbuilder/`. On Replit the registered
artifact proxy already forwards `/api` to the API workflow. Start both managed
workflows; do not add a second Vite proxy.

For a non-Replit checkout, opening Vite directly on port 4173 provides static-only
behavior unless a same-origin reverse proxy forwards the API. Run the two
processes on different ports and use a local nginx server, for example:

```nginx
server {
    listen 8081;
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_read_timeout 20s;
    }
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Open `http://localhost:8081/`, not the direct Vite port, to test online resolution.
In production serve `dist/public` with the SPA rules above and forward `/api/`
to Node **before** the HTML fallback. Preserve the full path, query string,
`X-LDraw-SHA256`, `X-LDraw-Snapshot` and `Retry-After` headers.
The route sends `application/octet-stream` with `no-transform` and no
`Content-Encoding`; do not decompress, recode, or wrap the payload as JSON.
Hash response bytes through the public route and compare with `X-LDraw-SHA256`.
Do not set cross-origin access headers on this route.

### Bounded live mode and explicit archive approval

The repository's API now defaults to a pinned approved archive in App Storage.
At first startup on a new instance it downloads that immutable compressed
snapshot from App Storage, verifies its pinned SHA-256, restores it atomically
and checks every restored file against the archive manifest before serving.
Subsequent starts reuse the completed local copy. No startup/build action
downloads a new version from LDraw. The storage object is private and accessed
using Replit-managed service credentials; it contains only official library
files and legal texts, never private models. Do not delete it while this
snapshot remains configured.

`LDRAW_APPROVED_DIR` still overrides the default for a deliberately prepared
local archive, including standalone hosting outside Replit. A missing or corrupt
configured archive/storage object fails explicitly; it never silently falls back
to thousands of live requests. A cold restore needs roughly 500 MiB expanded
disk space plus its compressed download and can delay API startup. Startup
failures are reported in the API logs. Restored files remain excluded from Git
and deployment inputs; durable bytes are in App Storage, not the workspace.

For conscious snapshot maintenance on Replit, run the archive approval below,
then upload the approved bytes once:

```sh
node --experimental-strip-types \
  artifacts/api-server/scripts/publish-ldraw-snapshot.mjs \
  generated-artifacts/ldraw-approved YOUR_STORAGE_BUCKET
```

The command prints the storage identity and both hashes. Update the checked-in
snapshot descriptor deliberately, test a clean restore, and retain the old object
until no active release needs it. Uploads refuse to overwrite an existing object.
No private-model upload endpoint or account system is involved.

The underlying provider's optional live mode reads only fixed official LDraw URLs
and the CC0 legal-code URL. It rejects URLs, traversal, arbitrary namespaces,
redirects, unsupported license headers and malformed geometry. Limits: four
upstream requests at once, 12-second upstream timeout, 2 MiB per file, 32 MiB
bounded in-memory cache, negative caching and a global upstream 429
cooldown. Live mode permits at most **120 upstream requests per hour per process**.
It is for small gaps, not recursively fetching a large library. A multi-process
host has a separate budget per process; apply a reverse-proxy rate limit for
untrusted public traffic if needed.

For large models, explicitly prepare one official archive on the **server**:

```sh
# Requires Python 3 and curl; intentionally downloads about 140 MiB compressed.
# Expansion is currently about 500 MiB. Never run this automatically at startup.
python3 scripts/prepare-ldraw-archive.py --approve-official-download

# Use the printed absolute directory; no database or key is needed.
LDRAW_APPROVED_DIR=/absolute/path/generated-artifacts/ldraw-approved \
  PORT=5000 pnpm --filter @workspace/api-server run start
```

The command records the exact archive SHA-256 and per-file hashes in a versioned
manifest, preserves original file bytes/credits and downloads the CC0 legal
code. It rejects duplicate/traversing paths, bounds expansion and refuses
to overwrite an existing destination. This is an explicit operator approval of
the official source, not a legal opinion or a signature from LDraw. To inspect
an already downloaded official archive, add `--archive /path/complete.zip`.
Review the printed hash and original headers before hosting; never use a private
Studio archive. Archive mode has **no live fallback** for absent or changed files.
It serves only the subset requested by the model, never the full archive
to a phone, and still validates each individual file's accepted license.

Keep archives/generated files outside Git (the default `generated-artifacts`
directory is excluded from backups and deployment inputs). An ignored local
archive is not transferred by a source merge or static deployment. On another
host, prepare/copy your deliberately approved server cache separately and set
the directory explicitly. Keep old approved directories immutable; choose a
new output directory for a conscious update. Installed snapshots and saved
project resources are never silently refreshed.

### Import behavior and failure handling

The German dialog shows checked roots, acquired file count and bytes, offers
**Nachladen abbrechen**, and allows **Fehlende LDraw-Teile erneut laden** in both
a preview and an open partial project. Retry respects upstream `Retry-After`.
Downloading never replaces a project: only the explicit create action commits
a new import. Re-resolving saves before updating the canvas and retains editable
bricks, undo/redo history and original source data.

The client allows two requests at once, one limited retry, 3,000 newly requested
files, 32 MiB per acquisition and 48 dependency levels. Availability requires
a complete acyclic graph and compiled surfaces for every used color, not merely
HTTP 200. Missing files, unsupported sources/licenses, cycles, throttling,
timeouts and malformed files leave the upload intact. Cache writes are atomic;
quota failures are shown, not treated as successful offline persistence.
Geometry, hashes, provenance, credits, legal texts and versioned dependency
manifests travel with saved projects/JSON. Original bytes are not normalized
before hashing, including BOM and CRLF.

```sh
pnpm --filter @workspace/api-server test
```

No full library archive is committed. Measured reference coverage is documented
in [missing-geometry verification](../artifacts/brickbuilder-mobile/docs/missing-geometry-verification.md).

## Troubleshooting

- **Missing `PORT` or `BASE_PATH`:** set both on dev, build and preview commands.
- **Blank page or HTML instead of JS:** check the built base path, mount point,
  MIME types and fallback rules; rebuild after a path change.
- **Old version persists:** inspect worker registration/cache and host cache
  headers. Back up projects before any destructive browser cleanup.
- **Parts download rejected:** check the real HTTP status, path, snapshot byte
  length and content encoding; do not disable integrity checks.
- **Native dependency install/build fails:** verify Linux x86-64 and the tested
  tool versions; do not silently discard the lockfile or security policies.
- **A test needs a local upload:** only explicitly marked private cases may skip;
  failures in independent synthetic cases are real failures to investigate.

## Sanitized code backups

The authorized maintainer backup command is:

```sh
DANGEROUSLY_ALLOW_GIT=1 bash scripts/backup-github.sh \
  "Describe the actual source changes in English"
```

It targets the existing GitHub repository and verifies the remote result.
It is **not** needed to install, build or host the app. It uses a separate
sanitized snapshot/index and fast-forward history, not the local checkpoint
history. Uploads, credentials, internal context and generated output stay out.
Remote history drift stops the backup for inspection; do not bypass this with a
force push. Updating GitHub's About description is a separate authorized API
operation, not something a README or Git push changes.
