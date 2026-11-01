#!/usr/bin/env bash
# Functions are sourceable for unprivileged deployment/rollback tests.

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[BrickBuilder] %s\n' "$*"; }
safe_path() { [[ "$1" == /* && "$1" =~ ^[a-zA-Z0-9/._-]+$ && "$1" != *"/../"* && "$1" != *"/./"* && "$1" != */.. ]]; }
valid_domain() {
  [[ ${#1} -le 253 && "$1" != *..* && "$1" == *.* && "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || return 1
  local label
  local -a labels
  IFS=. read -r -a labels <<< "$1"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && "$label" != -* && "$label" != *- ]] || return 1
  done
}
atomic_link() {
  local target=$1 link=$2 temporary="${2}.setup-$$"
  [[ ! -e "$link" || -L "$link" ]] || die "Refusing to replace a real directory/file: $link"
  ln -s "$target" "$temporary"
  mv -Tf "$temporary" "$link"
}
render_nginx() {
  local ipv6_http="" ipv6_https=""
  if [[ "${IPV6:-0}" == 1 ]]; then
    ipv6_http="listen [::]:80;"
    ipv6_https="listen [::]:443 ssl;"
  fi
  cat <<EOF
# Managed by BrickBuilder setup-self-host.sh. Previous versions are backed up.
server {
    listen 80;
    $ipv6_http
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        try_files \$uri =404;
    }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    $ipv6_https
    server_name $DOMAIN;
    ssl_certificate $CERT;
    ssl_certificate_key $KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    root $INSTALL_ROOT/current/public;
    index index.html;
    client_max_body_size 1m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain application/manifest+json;
    location ^~ /api/catalog/snapshot/ {
        default_type application/octet-stream;
        gzip off;
        add_header Cache-Control "public, max-age=31536000, immutable, no-transform";
        try_files \$uri =404;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:$API_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
    location /assets/ { try_files \$uri =404; }
    location /parts/ { try_files \$uri =404; }
    location /icons/ { try_files \$uri =404; }
    location /licenses/ { try_files \$uri =404; }
    location = /sw.js { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location = /manifest.webmanifest { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location = /index.html { add_header Cache-Control "no-cache"; }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
}
render_unit() {
  cat <<EOF
# Managed by BrickBuilder setup-self-host.sh.
[Unit]
Description=BrickBuilder local approved LDraw resolver
After=network.target
[Service]
Type=simple
User=brickbuilder
Group=brickbuilder
WorkingDirectory=$INSTALL_ROOT/current
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$API_PORT
Environment=LDRAW_APPROVED_DIR=$ARCHIVE
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/bin/node $INSTALL_ROOT/current/artifacts/api-server/dist/index.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UMask=0027
[Install]
WantedBy=multi-user.target
EOF
}

# Snapshot only the paths this installer owns or the operator explicitly chose.
backup_activation() {
  mkdir -p "$BACKUP"
  chmod 700 "$BACKUP"
  OLD_CURRENT=$(readlink "$INSTALL_ROOT/current" || true)
  SITE_EXISTED=0; UNIT_EXISTED=0; ENABLED_EXISTED=0
  WAS_ACTIVE=0; WAS_ENABLED=0
  if [[ -e "$NGINX_SITE" || -L "$NGINX_SITE" ]]; then cp -a "$NGINX_SITE" "$BACKUP/site"; SITE_EXISTED=1; fi
  if [[ -e "$UNIT" ]]; then cp -a "$UNIT" "$BACKUP/unit"; UNIT_EXISTED=1; fi
  if [[ -e "$ENABLED_SITE" || -L "$ENABLED_SITE" ]]; then ENABLED_EXISTED=1; fi
  if systemctl is-active --quiet brickbuilder-api; then WAS_ACTIVE=1; fi
  if systemctl is-enabled --quiet brickbuilder-api; then WAS_ENABLED=1; fi
}
rollback_activation() {
  log "Activation failed. Restoring previous site, service and release link."
  if [[ -n "$OLD_CURRENT" ]]; then atomic_link "$OLD_CURRENT" "$INSTALL_ROOT/current"; else rm -f "$INSTALL_ROOT/current"; fi
  rm -f "$NGINX_SITE"
  if (( SITE_EXISTED )); then cp -a "$BACKUP/site" "$NGINX_SITE"; fi
  if (( ! ENABLED_EXISTED )); then rm -f "$ENABLED_SITE"; fi
  if (( UNIT_EXISTED )); then cp -a "$BACKUP/unit" "$UNIT"; else rm -f "$UNIT"; fi
  systemctl daemon-reload || true
  if (( WAS_ACTIVE )); then systemctl restart brickbuilder-api || printf 'WARNING: Restore the API manually from %s\n' "$BACKUP" >&2
  else systemctl stop brickbuilder-api || true; fi
  if (( ! WAS_ENABLED )); then systemctl disable brickbuilder-api || true; fi
  if nginx -t; then systemctl reload nginx || printf 'WARNING: Reload nginx manually.\n' >&2
  else printf 'WARNING: Review nginx configuration and backups at %s\n' "$BACKUP" >&2; fi
}
