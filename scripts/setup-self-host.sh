#!/usr/bin/env bash
# Debian/Ubuntu host installer. Never execute server provisioning inside Replit.
set -Eeuo pipefail
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source "$SOURCE/scripts/self-host/common.sh"

usage() {
  cat <<'EOF'
Usage:
  sudo bash scripts/setup-self-host.sh --domain bricks.example.org \
    --catalog /absolute/path/catalog.bin --approve-ldraw-download

Required on first installation:
  --domain DOMAIN               Lower-case DNS name, no scheme/path/port
  --catalog FILE                Approved catalog.bin (exact pinned hash), OR
  --catalog-url HTTPS_URL        Download that exact approved payload
  --ldraw-dir DIRECTORY          Existing reviewed archive with manifest, OR
  --approve-ldraw-download       Explicit permission to prepare official LDraw

Options:
  --cert FILE                   Existing fullchain.pem (default: Certbot domain path)
  --key FILE                    Existing privkey.pem (default: Certbot domain path)
  --nginx-site FILE             /etc/nginx/sites-available/FILENAME
  --replace-nginx-site          Permit replacement of a non-managed site; backup kept
  --acme-root DIRECTORY          Existing Certbot webroot, if using webroot renewal
  --api-port PORT                Loopback API port, default 5000 (1024..65535)
  --node-version 24.X.Y          Pin Node 24; otherwise latest official 24.x patch
  --plan                        Print plan only; no writes, downloads or root required
  --help                        Show this help

Supports Ubuntu 22.04+ or Debian 12+ on x86-64; 4 GiB RAM recommended for builds.
Assumes nginx, systemd and an existing trusted HTTPS certificate. Does NOT
install nginx, obtain certificates, change firewall rules or publish anywhere.
Catalog data must be supplied; arbitrary upstream CSV updates are not accepted.
Updates reuse the installed verified data if no new data flags are supplied.
EOF
}
DOMAIN= CERT= KEY= CATALOG= CATALOG_URL= LDRAW_DIR= NGINX_SITE= NODE_VERSION=
ACME_ROOT=/var/www/letsencrypt
API_PORT=5000; APPROVE_LDRAW=0; REPLACE_SITE=0; PLAN=0
while (( $# )); do
  case "$1" in
    --help) usage; exit 0 ;;
    --plan) PLAN=1; shift ;;
    --approve-ldraw-download) APPROVE_LDRAW=1; shift ;;
    --replace-nginx-site) REPLACE_SITE=1; shift ;;
    --domain|--cert|--key|--catalog|--catalog-url|--ldraw-dir|--nginx-site|--acme-root|--api-port|--node-version)
      (( $# >= 2 )) || die "Missing value for $1"
      case "$1" in
        --domain) DOMAIN=$2 ;; --cert) CERT=$2 ;; --key) KEY=$2 ;;
        --catalog) CATALOG=$2 ;; --catalog-url) CATALOG_URL=$2 ;;
        --ldraw-dir) LDRAW_DIR=$2 ;; --nginx-site) NGINX_SITE=$2 ;;
        --acme-root) ACME_ROOT=$2 ;; --api-port) API_PORT=$2 ;;
        --node-version) NODE_VERSION=$2 ;;
      esac
      shift 2 ;;
    *) die "Unknown argument: $1 (use --help)" ;;
  esac
done
valid_domain "$DOMAIN" || die "Use a valid lower-case DNS name, e.g. bricks.example.org"
[[ "$API_PORT" =~ ^[1-9][0-9]{3,4}$ ]] && (( API_PORT <= 65535 && API_PORT >= 1024 )) || die "Invalid API port"
[[ -z "$NODE_VERSION" || "$NODE_VERSION" =~ ^24\.[0-9]+\.[0-9]+$ ]] || die "Only Node 24.X.Y is supported"
[[ -z "$CATALOG" || -z "$CATALOG_URL" ]] || die "Choose --catalog OR --catalog-url"
[[ -z "$LDRAW_DIR" || "$APPROVE_LDRAW" == 0 ]] || die "Choose --ldraw-dir OR --approve-ldraw-download"
CERT=${CERT:-/etc/letsencrypt/live/$DOMAIN/fullchain.pem}
KEY=${KEY:-/etc/letsencrypt/live/$DOMAIN/privkey.pem}
NGINX_SITE=${NGINX_SITE:-/etc/nginx/sites-available/brickbuilder-$DOMAIN.conf}
for path in "$CERT" "$KEY" "$NGINX_SITE" "$ACME_ROOT"; do
  safe_path "$path" || die "Configuration paths must be absolute and use only letters, digits, / . _ -"
done
[[ "$NGINX_SITE" == /etc/nginx/sites-available/* && "${NGINX_SITE#/etc/nginx/sites-available/}" != */* ]] || die "Use a single file in /etc/nginx/sites-available/"
INSTALL_ROOT=/opt/brickbuilder
DATA_ROOT=/var/lib/brickbuilder
UNIT=/etc/systemd/system/brickbuilder-api.service
ENABLED_SITE="/etc/nginx/sites-enabled/$(basename "$NGINX_SITE")"
if (( PLAN )); then
  usage
  printf '\nPlan for https://%s:\n' "$DOMAIN"
  printf '  Install tools: Node 24, pnpm 10.26.1, Python/curl/git/xz/openssl.\n'
  printf '  Build a fresh release in %s/releases (no private uploads or Git history).\n' "$INSTALL_ROOT"
  printf '  Verify catalog against the source manifest; prepare/copy approved local LDraw.\n'
  printf '  Existing TLS: %s; private key path: %s\n' "$CERT" "$KEY"
  printf '  Site: %s; API: 127.0.0.1:%s; unit: %s\n' "$NGINX_SITE" "$API_PORT" "$UNIT"
  printf '  Back up changed files, switch release, verify API/HTTPS, restore on activation failure.\n'
  printf 'No changes made. Real installation requires root, clean Git checkout and the above data inputs.\n'
  exit 0
fi
(( EUID == 0 )) || die "Run with sudo, or use --plan without root"
command -v flock >/dev/null || die "Install util-linux (flock) first"
exec 9>/run/lock/brickbuilder-setup.lock
flock -n 9 || die "Another BrickBuilder installation is running"
[[ "$(uname -m)" == x86_64 ]] || die "Only Linux x86-64/glibc is validated"
source /etc/os-release
[[ "${ID:-}" == ubuntu || "${ID:-}" == debian ]] || die "Only Debian/Ubuntu are supported"
if [[ "$ID" == ubuntu ]]; then
  dpkg --compare-versions "${VERSION_ID:-0}" ge 22.04 || die "Ubuntu 22.04+ required"
else
  dpkg --compare-versions "${VERSION_ID:-0}" ge 12 || die "Debian 12+ required"
fi
[[ -d /run/systemd/system ]] || die "A running systemd host is required"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
command -v nginx >/dev/null || die "Install/configure nginx before running setup"
[[ -s "$CERT" && -s "$KEY" ]] || die "Existing certificate/key not found; run Certbot first"
nginx -t
systemctl is-active --quiet nginx || die "Start your existing nginx service first"
[[ -z "$CATALOG_URL" || "$CATALOG_URL" == https://* ]] || die "Catalog URL must use HTTPS"
if [[ -e "$NGINX_SITE" || -L "$NGINX_SITE" ]]; then
  [[ ! -L "$NGINX_SITE" ]] || die "Choose the real sites-available file, not a symlink"
  if ! grep -q '^# Managed by BrickBuilder setup-self-host.sh' "$NGINX_SITE" && (( ! REPLACE_SITE )); then
    die "Existing non-managed nginx site: inspect it, then explicitly use --replace-nginx-site"
  fi
fi
if [[ -e "$UNIT" ]] && ! grep -q '^# Managed by BrickBuilder setup-self-host.sh' "$UNIT"; then
  die "An unrelated brickbuilder-api.service exists; resolve it manually"
fi
[[ ! -e "$INSTALL_ROOT/current" || -L "$INSTALL_ROOT/current" ]] || die "current must be absent or an installer release symlink"
if [[ -L "$INSTALL_ROOT/current" ]]; then
  [[ "$(readlink -f "$INSTALL_ROOT/current")" == "$INSTALL_ROOT"/releases/* ]] || die "Unexpected current symlink target"
fi
command -v git >/dev/null || die "Install git and use a clean repository checkout"
git -c safe.directory="$SOURCE" -C "$SOURCE" rev-parse --is-inside-work-tree >/dev/null
git -c safe.directory="$SOURCE" -C "$SOURCE" diff --quiet HEAD -- || die "Commit/stash tracked modifications before deployment"
git -c safe.directory="$SOURCE" -C "$SOURCE" ls-files --error-unmatch scripts/setup-self-host.sh >/dev/null || die "Use a committed installer checkout"
if [[ -z "$CATALOG" && -z "$CATALOG_URL" ]]; then
  SHA=$(sed -n 's/.*"sha256": "\([a-f0-9]\{64\}\)".*/\1/p' "$SOURCE/artifacts/brickbuilder-mobile/src/features/catalog/manifest.json" | head -1)
  CATALOG="$INSTALL_ROOT/current/public/api/catalog/snapshot/$SHA"
  [[ -f "$CATALOG" ]] || die "First install requires --catalog or --catalog-url"
fi
if [[ -z "$LDRAW_DIR" && "$APPROVE_LDRAW" == 0 ]]; then
  LDRAW_DIR="$DATA_ROOT/ldraw/current"
  [[ -d "$LDRAW_DIR" ]] || die "First install requires --ldraw-dir or --approve-ldraw-download"
fi
if [[ -n "$CATALOG" ]]; then CATALOG=$(realpath -e -- "$CATALOG"); fi
if [[ -n "$LDRAW_DIR" ]]; then LDRAW_DIR=$(realpath -e -- "$LDRAW_DIR"); fi
TEMP=$(mktemp -d /tmp/brickbuilder-setup.XXXXXXXX)
ACTIVATED=0; COMPLETE=0
finish() {
  local result=$?
  trap - EXIT
  if (( result != 0 && ACTIVATED )); then set +e; rollback_activation; fi
  rm -rf -- "$TEMP"
  if (( result != 0 )); then printf 'Setup failed. Existing data/releases were not deleted.\n' >&2; fi
  exit "$result"
}
trap finish EXIT
log "Installing host build dependencies (nginx and certificates are left installed as-is)"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git python3 xz-utils tar openssl
openssl x509 -in "$CERT" -checkend 0 -noout || die "Certificate is expired"
openssl x509 -in "$CERT" -checkhost "$DOMAIN" -noout || die "Certificate does not cover the domain"
IPV6=0
if python3 - <<'PY'
import socket, sys
try:
    with socket.socket(socket.AF_INET6) as s: s.bind(("::1", 0))
except OSError: sys.exit(1)
PY
then IPV6=1; fi
python3 - <<'PY'
from pathlib import Path
import shutil, sys
for directory in ("/opt", "/var/lib"):
    if shutil.disk_usage(directory).free < 5 * 1024**3:
        sys.exit("Reserve at least 5 GiB free on " + directory + " before building")
available = int(next(line.split()[1] for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:")))
if available < 3 * 1024**2:
    print("WARNING: Less than 3 GiB available RAM. A 4-GiB build host is recommended; allocation failures leave the old site intact.")
PY

# Detect duplicate server names without printing the host's full nginx config.
nginx -T >"$TEMP/nginx.txt" 2>/dev/null
python3 - "$DOMAIN" "$NGINX_SITE" "$TEMP/nginx.txt" <<'PY'
from pathlib import Path
import fnmatch, re, sys
domain, selected, dump = sys.argv[1:]
current = ""
for section in re.split(r"(?m)^# configuration file ", Path(dump).read_text()):
    if ":\n" not in section: continue
    current, text = section.split(":\n", 1)
    if Path(current).resolve() == Path(selected).resolve(): continue
    text = re.sub(r"(?m)#.*$", "", text)
    for names in re.findall(r"\bserver_name\s+([^;]+);", text):
        for name in names.split():
            if name == domain or fnmatch.fnmatchcase(domain, name) or (name.startswith(".") and (domain == name[1:] or domain.endswith(name))):
                sys.exit("Domain is already configured in " + current + ". Select its real file with --nginx-site and explicitly allow replacement.")
PY
for link in /etc/nginx/sites-enabled/*; do
  if [[ -e "$link" && "$(readlink -f "$link")" == "$NGINX_SITE" ]]; then ENABLED_SITE=$link; break; fi
done
if [[ -e "$ENABLED_SITE" || -L "$ENABLED_SITE" ]]; then
  [[ "$(readlink -f "$ENABLED_SITE")" == "$NGINX_SITE" ]] || die "Enabled site name belongs to another configuration"
fi

log "Installing a checksum-verified official Node 24 toolchain"
fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 240 "$@"; }
if [[ -z "$NODE_VERSION" ]]; then
  fetch https://nodejs.org/dist/index.json -o "$TEMP/node-index.json"
  NODE_VERSION=$(python3 -c 'import json,sys; print(next(r["version"][1:] for r in json.load(open(sys.argv[1])) if r["version"].startswith("v24.")))' "$TEMP/node-index.json")
fi
[[ "$NODE_VERSION" =~ ^24\.[0-9]+\.[0-9]+$ ]] || die "Invalid official Node version metadata"
NODE_DIR="/opt/brickbuilder-tools/node-v$NODE_VERSION-linux-x64"
if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  NAME="node-v$NODE_VERSION-linux-x64.tar.xz"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TEMP/SHASUMS256.txt"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$NAME" -o "$TEMP/$NAME"
  (cd "$TEMP"; grep -E "^[a-f0-9]{64}  $NAME$" SHASUMS256.txt >CHECKSUM; test -s CHECKSUM; sha256sum --check CHECKSUM)
  mkdir -p /opt/brickbuilder-tools
  [[ ! -e "$NODE_DIR" ]] || die "Incomplete tool directory exists; inspect it before retrying: $NODE_DIR"
  tar -xJf "$TEMP/$NAME" -C /opt/brickbuilder-tools
fi
if [[ ! -x "$NODE_DIR/bin/pnpm" ]] || [[ "$(PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/pnpm" --version)" != 10.26.1 ]]; then
  PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/npm" install --global --prefix "$NODE_DIR" --ignore-scripts pnpm@10.26.1
fi
export PATH="$NODE_DIR/bin:$PATH"
[[ "$(node --version)" == "v$NODE_VERSION" && "$(pnpm --version)" == 10.26.1 ]] || die "Unexpected toolchain version"
if [[ -n "$CATALOG_URL" ]]; then
  python3 - "$CATALOG_URL" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
if u.scheme != "https" or not u.hostname or u.username or u.password: sys.exit("Use a public HTTPS data URL without credentials")
PY
  BYTES=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["bytes"])' "$SOURCE/artifacts/brickbuilder-mobile/src/features/catalog/manifest.json")
  fetch --max-filesize "$BYTES" "$CATALOG_URL" -o "$TEMP/catalog.bin"
  CATALOG="$TEMP/catalog.bin"
fi
SHA=$(python3 "$SOURCE/scripts/self-host/verify-data.py" catalog "$SOURCE/artifacts/brickbuilder-mobile/src/features/catalog/manifest.json" "$CATALOG")
for user in brickbuilder brickbuilder-build; do
  if ! id "$user" >/dev/null 2>&1; then useradd --system --user-group --create-home --home-dir "/var/lib/$user" --shell /usr/sbin/nologin "$user"; fi
  [[ "$(id -u "$user")" != 0 ]] || die "Unsafe service/build user"
  getent passwd "$user" | awk -F: -v home="/var/lib/$user" '$6 == home && $7 == "/usr/sbin/nologin" { found=1 } END {exit !found}' || die "Existing account is not the expected system user: $user"
done
mkdir -p "$INSTALL_ROOT/releases" "$DATA_ROOT/ldraw"
chown root:root "$INSTALL_ROOT" "$INSTALL_ROOT/releases" "$DATA_ROOT" "$DATA_ROOT/ldraw"
chmod 755 "$INSTALL_ROOT" "$INSTALL_ROOT/releases" "$DATA_ROOT" "$DATA_ROOT/ldraw"
RELEASE="$INSTALL_ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir "$RELEASE"
git -c safe.directory="$SOURCE" -C "$SOURCE" archive HEAD | tar -x -C "$RELEASE" \
  --exclude=node_modules --exclude=attached_assets --exclude=generated-artifacts \
  --exclude=.agents --exclude=.local --exclude=.cache --exclude=.env --exclude='.env.*' \
  --exclude=dist --exclude=build
chown -R brickbuilder-build:brickbuilder-build "$RELEASE"
as_builder() {
  runuser -u brickbuilder-build -- env -i HOME=/var/lib/brickbuilder-build PATH="$PATH" LANG=C.UTF-8 CI=true \
    bash -c 'cd "$1"; shift; exec "$@"' bash "$RELEASE" "$@"
}
if (( APPROVE_LDRAW )); then
  log "Preparing the official LDraw archive with explicit operator approval"
  as_builder python3 scripts/prepare-ldraw-archive.py --approve-official-download
  LDRAW_DIR="$RELEASE/generated-artifacts/ldraw-approved"
fi
DIGEST=$(python3 "$SOURCE/scripts/self-host/verify-data.py" archive "$LDRAW_DIR")
ARCHIVE="$DATA_ROOT/ldraw/$DIGEST"
if [[ ! -d "$ARCHIVE" ]]; then
  STAGING="$DATA_ROOT/ldraw/.staging-$DIGEST-$$"
  python3 "$SOURCE/scripts/self-host/verify-data.py" copy-archive "$LDRAW_DIR" "$STAGING"
  mv -T "$STAGING" "$ARCHIVE"
else
  python3 "$SOURCE/scripts/self-host/verify-data.py" archive "$ARCHIVE" >/dev/null
fi
log "Building a clean source release as an unprivileged build user"
as_builder pnpm install --frozen-lockfile
as_builder pnpm run typecheck:libs
as_builder pnpm --filter @workspace/brickbuilder-mobile typecheck
as_builder pnpm --filter @workspace/api-server typecheck
install -D -m 644 "$RELEASE/LICENSE" "$RELEASE/artifacts/brickbuilder-mobile/public/licenses/first-party/LICENSE.txt"
install -D -m 644 "$RELEASE/THIRD_PARTY_NOTICES.md" "$RELEASE/artifacts/brickbuilder-mobile/public/licenses/first-party/THIRD_PARTY_NOTICES.txt"
as_builder mkdir -p generated-artifacts
as_builder bash -c 'pnpm licenses list --prod --json > generated-artifacts/dependency-licenses.json'
as_builder python3 scripts/self-host/dependency-notices.py generated-artifacts/dependency-licenses.json "$RELEASE" \
  artifacts/brickbuilder-mobile/public/licenses/software-dependencies.txt
as_builder env PORT=4173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/brickbuilder-mobile build
as_builder pnpm --filter @workspace/api-server build
ln -s artifacts/brickbuilder-mobile/dist/public "$RELEASE/public"
mkdir -p "$RELEASE/public/api/catalog/snapshot"
cp "$CATALOG" "$RELEASE/public/api/catalog/snapshot/$SHA"
python3 "$SOURCE/scripts/self-host/verify-data.py" catalog "$RELEASE/artifacts/brickbuilder-mobile/src/features/catalog/manifest.json" "$RELEASE/public/api/catalog/snapshot/$SHA" >/dev/null
# Runtime users cannot change source, assets, configuration, or library data.
chown -R root:root "$RELEASE" "$ARCHIVE"
chmod -R a+rX,go-w "$RELEASE" "$ARCHIVE"
if ! python3 - "$API_PORT" <<'PY'
import socket, sys
s = socket.socket()
try: s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError: sys.exit(1)
finally: s.close()
PY
then
  systemctl is-active --quiet brickbuilder-api && grep -qx "Environment=PORT=$API_PORT" "$UNIT" \
    || die "API port is occupied by another service; choose --api-port"
fi
BACKUP="/var/backups/brickbuilder/$(basename "$RELEASE")"
backup_activation
render_nginx >"$TEMP/site"
render_unit >"$TEMP/unit"
ACTIVATED=1
atomic_link "$RELEASE" "$INSTALL_ROOT/current"
install -m 644 "$TEMP/site" "$NGINX_SITE"
if (( ! ENABLED_EXISTED )); then ln -s "$NGINX_SITE" "$ENABLED_SITE"; fi
install -m 644 "$TEMP/unit" "$UNIT"
nginx -t
systemctl daemon-reload
systemctl restart brickbuilder-api
curl --fail --silent --show-error --retry 8 --retry-connrefused --retry-delay 1 --max-time 5 \
  "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null
systemctl is-active --quiet brickbuilder-api
systemctl reload nginx
fetch --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/catalog/snapshot/$SHA" -o "$TEMP/served-catalog.bin"
python3 "$SOURCE/scripts/self-host/verify-data.py" catalog "$RELEASE/artifacts/brickbuilder-mobile/src/features/catalog/manifest.json" "$TEMP/served-catalog.bin" >/dev/null
fetch --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/index.html" -o "$TEMP/served-index.html"
cmp "$TEMP/served-index.html" "$RELEASE/public/index.html" || die "HTTPS is serving a different application"
fetch --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/ldraw/file?path=parts%2F3004.dat" -o "$TEMP/part.dat"
[[ -s "$TEMP/part.dat" ]] || die "Geometry resolver returned no data"
systemctl enable brickbuilder-api
atomic_link "$ARCHIVE" "$DATA_ROOT/ldraw/current"
COMPLETE=1; ACTIVATED=0
log "Ready: https://$DOMAIN — API bound to 127.0.0.1:$API_PORT"
printf 'Release: %s\nConfiguration backup: %s\n' "$RELEASE" "$BACKUP"
printf 'Previous releases/data are retained. Check browser offline mode and certbot renew --dry-run.\n'
