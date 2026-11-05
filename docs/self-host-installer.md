# Automated self-host installer

Entry point: **`scripts/setup-self-host.sh`**. Invoke with Bash from a clean,
committed checkout. Its versioned helpers in `scripts/self-host/` are required;
do not copy just that shell file to an unrelated directory.

## Supported environment

- An independent Ubuntu 22.04+ or Debian 12+ x86-64/glibc host with systemd.
  Ubuntu 24.04 is a suitable starting point. Not Replit, Alpine, ARM or Docker.
- Root/sudo to install packages and services. Nginx must already be installed,
  running and pass `nginx -t`.
- Existing trusted certificate/private key obtained beforehand, e.g. using
  Certbot. Default paths are `/etc/letsencrypt/live/DOMAIN/fullchain.pem` and
  `privkey.pem`. DNS must point at the host and public HTTPS must be reachable.
- Git for obtaining the source. If absent, install it using your OS package
  manager before cloning. The script installs other OS dependencies itself.
- Recommended build capacity: 2+ vCPU, 4 GiB RAM, 10 GiB free SSD. The script
  requires at least 5 GiB free on the `/opt` and `/var/lib` filesystems, and
  warns about low available memory. More space may be needed for retained
  releases, package caches and libraries.
- Outbound HTTPS to the OS repositories, nodejs.org, the npm registry and your
  selected data sources. You must approve any host/account costs yourself.
- A verified **catalog.bin** matching the checkout's catalog manifest.
  It is intentionally not committed to Git. Obtain it from the approved data
  archive or a trusted existing instance, as documented in the root README.
  No access to the project's Replit storage identity is assumed.
- A reviewed local LDraw archive, or explicit `--approve-ldraw-download`.
  Full geometry and the mapping catalog are distinct resources.

No PostgreSQL, paid catalog API, API key, native Android SDK, Java, GPU,
NodeSource repository or global replacement of your host's Node is required.

## Obtain the code

```sh
git clone --branch main https://github.com/Blackfishbox/BrickBuilder-Mobile.git
cd BrickBuilder-Mobile
bash scripts/setup-self-host.sh --help
bash scripts/setup-self-host.sh --plan --domain bricks.example.org
```

The plan does not inspect private-key contents, install, download or mutate
the host. It is an explanation of intended actions, **not** validation that
the real server/data/certificates are ready.

## Initial installation

With a catalog file and permission to prepare one official LDraw archive:

```sh
sudo bash scripts/setup-self-host.sh \
  --domain bricks.example.org \
  --catalog /absolute/path/catalog.bin \
  --approve-ldraw-download
```

Or supply both reviewed inputs:

```sh
sudo bash scripts/setup-self-host.sh \
  --domain bricks.example.org \
  --catalog /absolute/path/catalog.bin \
  --ldraw-dir /absolute/path/ldraw-approved
```

Use `--catalog-url https://YOUR-DATA-HOST/catalog.bin` instead of `--catalog`
if desired. HTTPS and SHA-256/length checks are mandatory; do not put private
models, signed credential-bearing URLs or secrets in installer arguments.
The URL is used only during installation, not by clients at runtime.

`--approve-ldraw-download` explicitly runs the existing official-archive
preparation workflow. It records the downloaded identity/hashes and preserves
legal texts. This is not an automatic recurring library update or a legal
warranty: review upstream licenses before public distribution. An existing
`--ldraw-dir` must contain its manifest and all recorded geometry/legal files.
Only manifest-listed files are copied, not arbitrary extra files.

### Existing Certbot/Nginx sites

Certbot may have created or modified an existing site for your domain. The
installer refuses to add a conflicting literal/wildcard `server_name`, and
refuses to overwrite an unrelated site without explicit authorization.

Select the actual file in `sites-available`, not its enabled symlink:

```sh
sudo bash scripts/setup-self-host.sh \
  --domain bricks.example.org \
  --catalog /absolute/path/catalog.bin \
  --approve-ldraw-download \
  --nginx-site /etc/nginx/sites-available/bricks.example.org \
  --replace-nginx-site
```

This **replaces the entire selected virtual host** with the app's HTTP/HTTPS
configuration. Existing custom locations, redirects or other applications in
that file are not merged automatically. Inspect and back up shared/custom
sites first. Other virtual hosts are not edited. Complex regex server-name
routing or nonstandard Nginx layouts may need manual integration instead.

To use non-default certificate paths (such as a Certbot `DOMAIN-0001` lineage):

```text
--cert /etc/letsencrypt/live/bricks.example.org-0001/fullchain.pem
--key /etc/letsencrypt/live/bricks.example.org-0001/privkey.pem
```

For existing **webroot-mode** renewal, provide `--acme-root` with the same
webroot as your Certbot renewal configuration. Its HTTP challenge directory is
served without redirect. Default: `/var/www/letsencrypt`. The script does not
change Certbot renewal files, create renewal timers or obtain certificates.
For Nginx-plugin renewal, retain your existing Certbot automation.
After setup, check `sudo certbot renew --dry-run` yourself. A working certificate
today is not proof that a custom renewal configuration will keep working.

## What is installed and started

1. OS build tools via `apt-get` (no blanket OS upgrade and no Nginx install).
2. Official Node 24 binaries checked against the HTTPS-delivered SHA-256 list,
   and pnpm 10.26.1, under `/opt/brickbuilder-tools/`. This is checksum/TLS
   verification, not independent GPG release-signature verification. Pin an
   exact patch with `--node-version 24.X.Y` if required.
3. Dedicated `brickbuilder-build` and `brickbuilder` system accounts.
   Dependencies/build scripts run as the build user with a minimal environment,
   not as root. Source comes from `git archive HEAD`, excludes private/local
   files and is installed in a fresh release directory.
4. Approved, per-file verified LDraw data under
   `/var/lib/brickbuilder/ldraw/ARCHIVE_SHA/`. The mapping payload is placed at
   the exact frontend catalog URL. No Replit storage credentials are required.
5. Frontend and API type checks/builds. First-party license and third-party
   notices are included before the PWA build, along with existing data notices.
   Installed production-package LICENSE/COPYING/NOTICE texts are collected in
   `licenses/software-dependencies.txt` without local filesystem paths. Missing
   root-level package notices produce a warning for manual review; collecting
   texts does not prove license compatibility or complete rights clearance.
6. A systemd service with runtime user `brickbuilder`, read-only system/home,
   no new privileges, and **`HOST=127.0.0.1`**. Default API port is 5000; change
   it with `--api-port 5123` if necessary. Nginx proxies only the local API;
   the catalog is static and does not call the Replit-specific catalog route.
7. An HTTPS Nginx site, configuration backups and an atomic `current` release
   link. The script verifies configuration syntax, service health and the actual
   HTTPS catalog checksum, app HTML and standard geometry response using local
   certificate-validated HTTPS. DNS/firewall reachability from outside still
   needs your own check.
8. The API is enabled for boot. Nginx must already have its normal service/boot
   configuration; the script reloads it rather than reinstalling it.

No firewall policy is changed, no private projects are uploaded, no domain or
certificate is purchased, and no cloud deployment or store submission occurs.

## Updates and rollback

In your clean source checkout:

```sh
git pull --ff-only
sudo bash scripts/setup-self-host.sh --domain bricks.example.org
```

Repeat any non-default `--nginx-site`, certificate/key, port and ACME-root
options. There is one fixed installation instance; the script does not store
those optional CLI preferences in a configuration database.

Updates reuse the verified installed data. If the new source pins a different
catalog, supply its approved binary explicitly. Official LDraw is not
redownloaded unless you opt in. A fresh source release and dependency install
are built; the live app stays on the previous release until activation.

Installations are serialized with a lock. Configuration backup directories are
under `/var/backups/brickbuilder/`. The installer retains previous releases
under `/opt/brickbuilder/releases/` and archive versions under
`/var/lib/brickbuilder/ldraw/`; plan disk cleanup rather than deleting an active
version or dependency store. Failed builds/staging directories can also need
inspection and cleanup.

When an activation check fails, the exit handler attempts to restore the
previous release symlink, chosen site file/enabled-link state, API unit and
previous service running/enabled state, then validates/reloads Nginx. A failed
first install removes its newly activated files rather than deleting unrelated
data. Dependency packages/users and toolchain downloads are not uninstalled.
If restoration itself fails, the script reports the backup directory for manual
recovery. Power loss, SIGKILL, unrelated concurrent administrator edits and
filesystem failure cannot be made transactional by a shell trap; keep a host
backup and review service logs after interruption.

Useful checks:

```sh
sudo systemctl status brickbuilder-api
sudo journalctl -u brickbuilder-api -n 100 --no-pager
sudo nginx -t
curl --fail https://bricks.example.org/api/healthz
sudo certbot renew --dry-run
```

User projects remain in client IndexedDB, not on this server. Each user still
needs verified exports. Test installation/PWA relaunch in airplane mode on an
actual Android device before describing it as tested on Android.

## Verification boundaries

```sh
bash -n scripts/setup-self-host.sh scripts/self-host/common.sh
python3 -m unittest scripts/test_self_host.py -v
pnpm --filter @workspace/api-server run build
```

The automated tests cover argument rejection, plan-only behavior, data hashes,
archive traversal/symlink rejection, template invariants and mocked activation
rollback without changing the test host. A built-API smoke test uses a temporary
local archive and a disposable loopback process.

These tests do **not** claim that package installation, systemd, Nginx and
Certbot have been exercised end-to-end on a fresh real VPS. Run the installer
on a backed-up supported host and inspect the final checks. No real server
credentials are needed or requested in chat.
