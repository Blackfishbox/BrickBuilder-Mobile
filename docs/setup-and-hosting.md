# Setup and hosting

## Scope and tested toolchain

This guide hosts the existing standalone browser application, without adding a
server, cloud sync, accounts or automatic missing-parts downloads.
The current frontend makes **no application API calls**.

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
| `DATABASE_URL` | Optional database library/schema tools | Your own PostgreSQL connection | Not used by the current frontend or health-only API route |

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
regressions. Three private-reference cases skip explicitly in a sanitized
checkout: two in `import.test.ts`, one in `legacy-io.test.ts`. If their original
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
resources to finish successfully first. This is not an automatic downloader
for arbitrary missing references.

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

## Optional API and database services

The repository includes an Express scaffold, but the current frontend does not
need it. A static host cannot run Express. To run the existing health-only
service on a Node-capable host:

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

The current health route does not import the database module. The optional
`@workspace/db` library and schema tools require a separately configured
PostgreSQL `DATABASE_URL` if you choose to use them. Do not provision a database
for the standalone PWA. Any future server-side feature needs its own
configuration/security documentation; this guide does not claim such a feature exists.

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
