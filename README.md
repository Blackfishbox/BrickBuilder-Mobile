# BrickBuilder Mobile

A local-first, installable 3D brick-building PWA with a **German application
interface**. Build with verified LDraw geometry, save projects in your browser,
install reviewed LDraw parts packages, and import IO, LDR, MPD or internal JSON
models. No account or paid external catalog API is required. The complete
mapping catalog needs one successful download from the supplied resolver or a
static snapshot URL; it then remains available locally.

Import support is bounded, not a claim of general BrickLink Studio compatibility.
Imported parts can be selected individually, moved, rotated, recolored and
deleted with undo/redo and local persistence. The parts picker contains only the
LDraw library; existing legacy procedural bricks remain supported in saved projects.
See the [editing guide](artifacts/brickbuilder-mobile/docs/editing.md) for workflows
and the explicit limitations of edited MPD/IO export.
See the [application documentation](artifacts/brickbuilder-mobile/README.md)
for supported formats, verification history and limitations.
The [complete catalog guide](artifacts/brickbuilder-mobile/docs/complete-catalog.md)
documents all published source rows, directional mappings, coverage and offline use.

## Features

- Touch-oriented 3D editing with camera controls, snapping and connection indicators.
- Individual part selection, movement, rotation, colors, deletion and undo/redo.
- LDraw parts library with downloadable packages and verified geometry caching.
- BrickLink XML/CSV inventories with quantity limits when building from a list.
- IO, LDR, MPD and internal JSON import, with format-specific export limitations.
- Local projects and autosave in IndexedDB, plus an installable offline-capable PWA.

## Quick start

Tested environment: **Linux x86-64, Node.js 24.22.1, pnpm 10.26.1**.
The current lockfile and native-package overrides target Linux x86-64;
other operating systems and CPU architectures have not been validated.
Install that pnpm version, for example with `npm install --global pnpm@10.26.1`,
then run:

```sh
git clone --branch main https://github.com/Blackfishbox/BrickBuilder-Mobile.git
cd BrickBuilder-Mobile
pnpm install --frozen-lockfile
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run dev
```

Open <http://localhost:4173/>. Both `PORT` and `BASE_PATH` are required by the
Vite configuration, including for builds and production previews.
The commands use POSIX shell environment-variable syntax.

## Check and build the standalone frontend

```sh
pnpm run typecheck:libs
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

## Documentation

- [Application overview and format support](artifacts/brickbuilder-mobile/README.md)
- [Editing guide](artifacts/brickbuilder-mobile/docs/editing.md)
- [Catalog, part IDs and colors](artifacts/brickbuilder-mobile/docs/complete-catalog.md)
- [Large-model performance](artifacts/brickbuilder-mobile/docs/performance.md)
- [Setup and hosting](docs/setup-and-hosting.md)
- [Automated server installation](docs/self-host-installer.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Repository map

- `artifacts/brickbuilder-mobile/` — React, TypeScript, Vite, Three.js, Dexie and PWA.
- `artifacts/brickbuilder-mobile/docs/` — architecture, import evidence and licensing.
- [Large-model performance](artifacts/brickbuilder-mobile/docs/performance.md) — rendering budgets, reference measurements and device-testing limits.
- `artifacts/api-server/` — same-origin LDraw and pinned catalog resolver; no database or external API key required.
- `lib/` — workspace libraries, API contracts and optional database support.
- `scripts/` — maintenance and sanitized GitHub backup utilities.
- `artifacts/mockup-sandbox/` — separate development preview; not needed to host the app.

## Contributing

First-party documentation, code comments, test descriptions and development-facing
explanations are **English**. Application labels, notifications, localized errors,
manifest locale and other user-visible content remain **German**. Preserve
third-party source files, original credits and authoritative license texts verbatim.
Use specific English commit subjects and bodies; do not rewrite existing history.

Keep private uploads, credentials, local agent context and generated output out
of commits. Tests needing private uploads skip explicitly when those files are
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

## Self-hosting: requirements and sizing

### Automated setup (existing Nginx and Certbot certificate)

From a **clean Git checkout on your own Ubuntu 22.04+/Debian 12+ x86-64
server**, run:

```sh
# Preview first: no changes, downloads or root access.
bash scripts/setup-self-host.sh --plan --domain bricks.example.org

# Install, build, configure and start. Replace domain and catalog path.
sudo bash scripts/setup-self-host.sh \
  --domain bricks.example.org \
  --catalog /absolute/path/catalog.bin \
  --approve-ldraw-download
```

This single entry point installs the other required host tools, a separate
official Node 24 toolchain and pnpm, builds from the checked-out Git commit,
checks data hashes, configures HTTPS Nginx and a loopback-only systemd API,
starts the service and verifies the HTTPS app, catalog and geometry endpoint.
It does not install Nginx, obtain a certificate, configure DNS/firewalls,
publish anything or purchase services.

If Certbot already configured a site for this domain, select its actual
`sites-available` file and explicitly permit its replacement:

```sh
sudo bash scripts/setup-self-host.sh \
  --domain bricks.example.org \
  --catalog /absolute/path/catalog.bin \
  --ldraw-dir /absolute/path/reviewed-ldraw \
  --nginx-site /etc/nginx/sites-available/bricks.example.org \
  --replace-nginx-site
```

**Replacement changes that complete selected virtual host**, including custom
locations. Backups are retained and activation failures trigger restoration.
Other sites are not intentionally edited. Review the plan and
[installer guide](docs/self-host-installer.md) first; it explains certificate
paths, Certbot webroot renewal, data inputs, repeat runs, rollback and limits.
Use `--catalog-url https://...` instead of `--catalog` if you have an immutable
HTTPS source for the exact approved binary. A valid full mapping catalog is
not obtained by silently downloading different current CSVs.

The installer provisions the host; it is **not intended to run in Replit**.
The following sections document manual hosting and hardware requirements.

**The browser/phone renders the model.** The server distributes files and, if
enabled, resolves missing geometry. It does not render models, run an AI model,
store users' projects or need a GPU. A stronger server will not fix a phone's
WebGL/GPU or large-model memory limits.

Choose one of these deployments:

| Deployment | What works | Runtime requirements |
| --- | --- | --- |
| Static PWA | Editor, local projects, included/installed parts, cached imports; full catalog if its approved binary is copied into the static site | HTTPS static host such as Nginx; no Node.js process or database |
| Static PWA + local geometry resolver | Above, plus downloading missing **approved** LDraw files during import | Nginx, Node.js 24, a reviewed local LDraw archive, persistent disk |

The API's current defaults use an existing **Replit-specific storage identity**.
A clean VPS cannot access it just by cloning this repository. To self-host
independently, **serve the pinned catalog statically and set
`LDRAW_APPROVED_DIR` for the API**, as below. Neither a Replit account, a
Rebrickable API key, a paid catalog subscription nor PostgreSQL is required for
that configuration. A `.env` containing `DATABASE_URL` or `SESSION_SECRET` does
not solve a missing dataset.

### CPU, RAM, disk and network

These are **planning estimates for a small private deployment, not measured
concurrent-user capacity or guaranteed minimums**:

| Task | CPU | RAM | Disk budget |
| --- | --- | --- | --- |
| Serve a prebuilt static site | Shared/1 vCPU | About 256–512 MiB for a small web-server deployment, plus OS requirements | Reserve 100 MiB for the site and update copies; OS/logs extra |
| Serve site + approved local geometry API | 1–2 vCPU | 1–2 GiB; **2 GiB recommended** | At least 2 GiB for app/library/cache headroom; **10 GiB free SSD recommended** including builds, logs and updates, beyond the base OS |
| Build the workspace and run tests on the server | 2+ vCPU | **4 GiB recommended** | About 5–10 GiB free for dependencies, pnpm store, temporary downloads and multiple builds |

A practical starting point is **2 vCPU, 2 GiB RAM and 20 GiB total SSD**, provided
roughly 10 GiB remains free after installing the OS. Use 4 GiB RAM if building
and testing there; alternatively build elsewhere and deploy the output. No
Docker, Kubernetes, Redis, PostgreSQL, Java or Android SDK is needed for the
web application. Monitor actual memory, disk, request rate and latency before
increasing traffic. Persistent data and logs must survive service restarts.

Current size evidence, checked 2026-11-01:

- A fresh `main` frontend build contains **12,606,603 bytes, about 12.0 MiB**,
  before HTTP compression and before adding the catalog. It includes the
  compressed connection/reference datasets and their legal/coverage files.
- The approved catalog payload is exactly **2,180,181 bytes, about 2.08 MiB**.
  Together, the current static payload is roughly **14.1 MiB**, before
  filesystem block overhead. Reserve more than this for future versions.
- The existing official-archive preparation guide estimates about **140 MiB
  compressed / 500 MiB expanded** for the reviewed LDraw library. These are
  approximate snapshot-dependent values, not a newly measured download size.
  Keep headroom for staging, manifests, the original archive and two versions;
  do not size a volume to exactly 500 MiB.
- The current development workspace's dependency directory occupies about
  **640 MiB**. This is an observation, not a clean-install upper bound: the pnpm
  store, package versions, caches and build tools add to disk usage.
- Projects, imported IO archives, undo/autosave data and installed part packages
  consume **the user's browser/device storage**, not server disk. There is no
  server-side project backup. Browser storage can be evicted or cleared.
- First-load bandwidth depends on HTTP compression, service-worker precaching
  and downloaded geometry. Budget approximately **10–20 MiB per fresh
  installation before additional geometry**, not per visit after caching.
  Geometry-heavy imports and updates can consume much more.

Measure your deployed version with `du -sh`, `df -h`, `free -h` and access logs.
A responsive phone with sufficient WebGL memory is still essential for large
models.

### Install the host tools and the workspace

Validated platform: Linux x86-64/glibc. The frozen workspace deliberately
excludes several other native-package variants; ARM, Alpine/musl, Windows and
macOS are not validated deployment targets.

On an **independent Debian/Ubuntu server**, install the OS tools:

```sh
sudo apt-get update
sudo apt-get install -y git curl ca-certificates python3 nginx
```

Install **Node.js 24 LTS** using the
[official Node.js instructions](https://nodejs.org/en/download). If you already
use [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), for example:

```sh
nvm install 24
nvm use 24
npm install --global pnpm@10.26.1
node --version
pnpm --version
```

The tested versions are Node 24.22.1 and pnpm 10.26.1. The OS repository's
default Node version may be older. `npm` is used only to install pnpm, not to
install workspace dependencies.

From a clean checkout (all subsequent repository commands run at its root):

```sh
git clone --branch main https://github.com/Blackfishbox/BrickBuilder-Mobile.git
cd BrickBuilder-Mobile
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build
```

Python 3 and curl are needed to prepare data, not to serve the static PWA.
There are no pip packages to install for the standard-library preparation
scripts. No private IO test fixture is required; those tests skip explicitly.
Do not run `scripts/post-merge.sh` for ordinary hosting.

### Supply the catalog before deploying

The exact `catalog.bin` is **not included in Git**. Obtain the approved payload
from the maintainer's data backup or a running approved deployment. For example,
replace the hostname with your existing deployment's actual address:

```sh
mkdir -p generated-artifacts/catalog-sources
curl --fail --location \
  'https://YOUR-EXISTING-DEPLOYMENT/api/catalog/snapshot/ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c' \
  -o generated-artifacts/catalog-sources/catalog.bin
printf '%s  %s\n' \
  ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c \
  generated-artifacts/catalog-sources/catalog.bin | sha256sum --check
test "$(wc -c < generated-artifacts/catalog-sources/catalog.bin)" -eq 2180181
mkdir -p artifacts/brickbuilder-mobile/dist/public/api/catalog/snapshot
cp generated-artifacts/catalog-sources/catalog.bin \
  artifacts/brickbuilder-mobile/dist/public/api/catalog/snapshot/ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c
```

You can instead extract `catalog.bin` from a supplied approved data archive;
verify the same hash and size. A plain Git clone alone does **not** provide this
dataset. If no approved copy is available, follow the
[catalog reproduction procedure](artifacts/brickbuilder-mobile/docs/complete-catalog.md#reproduce-an-explicitly-reviewed-update).
A freshly downloaded upstream CSV may differ: creating a new snapshot requires
deliberate review and updating both pinned descriptors, not bypassing the hash.
No background synchronization or paid service is required.

Perform the copy **after each frontend build**, since Vite cleans its output.
Serve the payload as binary without a `Content-Encoding: gzip` header. It is
already internally compressed, and checksums apply to its original bytes.

### Optional: prepare a local LDraw resolver

Skip this section for static-only hosting. For missing-geometry downloads,
explicitly prepare the official LDraw archive; do not substitute Studio files
or private models:

```sh
python3 scripts/prepare-ldraw-archive.py \
  --approve-official-download \
  --output generated-artifacts/ldraw-approved
pnpm --filter @workspace/api-server run build
NODE_ENV=production LDRAW_APPROVED_DIR="$PWD/generated-artifacts/ldraw-approved" \
  PORT=5000 pnpm --filter @workspace/api-server run start
```

The preparation performs an intentional upstream download, records its identity
and per-file hashes, preserves original headers and collects legal texts.
Review the manifest and licenses before making it publicly available. It
refuses to overwrite an existing output directory; use a new versioned
directory when deliberately updating, review it and switch paths atomically.
Preparation requires network access; subsequent archive-mode requests use
local files, with no silent live fallback.

In another terminal:

```sh
curl --fail http://127.0.0.1:5000/api/healthz
curl --fail 'http://127.0.0.1:5000/api/ldraw/file?path=parts%2F3004.dat'
```

Persist the **whole approved directory including its manifest and legal files**
outside temporary build output. Point `LDRAW_APPROVED_DIR` at its absolute path
on every startup. Do not just set it during the initial build.

Without this override, the current API attempts to restore the configured
App Storage object **before listening** and may fail on an independent host.
The API's catalog route also still uses App Storage: the reverse proxy below
serves that one route statically instead. Do not use that route directly on
the backend port as a self-hosted catalog test.

### Serve HTTPS and route requests

Copy the contents of `artifacts/brickbuilder-mobile/dist/public/` into a
dedicated web root, such as `/srv/brickbuilder/public/`; deploy only built
assets, including `parts/`, `licenses/`, worker files and the catalog path.
Never publish the repository root, `node_modules`, `attached_assets/`,
`generated-artifacts/`, credentials or test models.

Root-domain Nginx locations, inside your site's `server` block:

```nginx
root /srv/brickbuilder/public;
index index.html;

# More specific than /api/: never forward the catalog to Replit storage.
location ^~ /api/catalog/snapshot/ {
    default_type application/octet-stream;
    gzip off;
    add_header Cache-Control "public, max-age=31536000, immutable, no-transform";
    try_files $uri =404;
}

# Include only when running the optional Node geometry API.
location /api/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
}

location /assets/   { try_files $uri =404; }
location /parts/    { try_files $uri =404; }
location /icons/    { try_files $uri =404; }
location /licenses/ { try_files $uri =404; }
location = /sw.js {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
}
location = /manifest.webmanifest {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
}
location = /index.html {
    add_header Cache-Control "no-cache";
}
location / { try_files $uri $uri/ /index.html; }
```

Use a real domain/DNS record and a valid HTTPS certificate. For example,
Debian/Ubuntu hosts can install `certbot` and `python3-certbot-nginx`, configure
the site's `server_name` and then run `sudo certbot --nginx -d YOUR_DOMAIN`.
Certificate automation needs suitable DNS/firewall/HTTP access; check renewal.
Do not copy the placeholder domain literally.

For a static-only deployment, replace the `/api/` proxy block with
`location /api/ { return 404; }`; retain the more-specific static catalog block.
The API prefix must **not** fall through to `index.html`. For subpath hosting,
follow [the detailed path guide](docs/setup-and-hosting.md#hosting-below-a-subpath);
do not copy root-only locations unchanged.

The Node API defaults to all interfaces for managed previews. Set
`HOST=127.0.0.1` for independent hosting (the installer does so), keep its port
**non-public**, expose only the HTTPS proxy, retain SSH/admin access as needed
and add suitable public request limits. Public geometry queries consume
bandwidth even though projects themselves stay on clients.

For a persistent API process, use your OS service manager, not Vite preview or
an interactive terminal. Example systemd unit, after placing the checkout in
`/opt/brickbuilder`, the approved archive in
`/srv/brickbuilder-data/ldraw-approved`, and creating an unprivileged
`brickbuilder` service user with read access:

```ini
[Unit]
Description=BrickBuilder approved LDraw resolver
After=network.target

[Service]
Type=simple
User=brickbuilder
WorkingDirectory=/opt/brickbuilder
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=5000
Environment=LDRAW_APPROVED_DIR=/srv/brickbuilder-data/ldraw-approved
ExecStart=/usr/bin/node /opt/brickbuilder/artifacts/api-server/dist/index.mjs
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Adjust `ExecStart` to the actual system-wide Node 24 binary; nvm's interactive
shell is not loaded by systemd. Keep the built API's required dependencies
alongside the checkout. Save the unit as
`/etc/systemd/system/brickbuilder-api.service`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now brickbuilder-api
sudo nginx -t
sudo systemctl reload nginx
```

Verify the public catalog URL against the same SHA-256, confirm missing asset
URLs return real 404s, install the PWA on Android over HTTPS, then test a second
launch in airplane mode. Offline mode still depends on downloaded assets and
browser storage availability, not an unlimited offline parts promise.
Back up configuration, approved datasets and previous deployment artifacts;
each user must separately export/verify backups of local projects.

## License

First-party application code and documentation are available under the
[MIT License](LICENSE). Third-party libraries, geometry and catalog datasets
retain their respective terms; see [Third-party notices](THIRD_PARTY_NOTICES.md)
for attribution, licenses and detailed documentation.
