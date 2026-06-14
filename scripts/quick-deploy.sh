#!/usr/bin/env bash
# rinpanel Quick Deploy — single-command setup for a fresh Ubuntu VPS.
#
# Usage (as root, on Ubuntu 22.04+):
#   curl -fsSL https://raw.githubusercontent.com/rinebyte/rinpanel/main/scripts/quick-deploy.sh | sudo bash
#
# Optional env-var overrides:
#   ADMIN_USERNAME       (default: admin)
#   LETS_ENCRYPT_EMAIL   (default: empty — fill later in .env.local for SSL)
#   PANEL_PORT           (default: 8443)
#   INSTALL_DIR          (default: /opt/rinpanel)
set -euo pipefail

# --- preconditions -----------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "Skrip ini harus dijalankan sebagai root. Coba: curl ... | sudo bash" >&2
  exit 1
fi

ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
LETS_ENCRYPT_EMAIL="${LETS_ENCRYPT_EMAIL:-}"
PANEL_PORT="${PANEL_PORT:-8443}"
INSTALL_DIR="${INSTALL_DIR:-/opt/rinpanel}"
REPO_URL="${REPO_URL:-https://github.com/rinebyte/rinpanel.git}"

log()  { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }

# --- system packages ---------------------------------------------------------
log "Memasang paket sistem (nginx, certbot, build tools, git, curl)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq \
  nginx certbot python3-certbot-nginx \
  git curl ca-certificates build-essential python3 \
  sqlite3 ufw openssl

# --- Node 20 -----------------------------------------------------------------
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
fi
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  log "Memasang Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
log "Node $(node -v) · npm $(npm -v)"

# --- clone / pull ------------------------------------------------------------
log "Mengambil kode rinpanel ke $INSTALL_DIR..."
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "$INSTALL_DIR sudah ada — pull saja."
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# --- npm install + build -----------------------------------------------------
log "Memasang dependensi npm (1-3 menit)..."
npm install --silent

log "Membangun aplikasi..."
npm run build

# --- .env.local --------------------------------------------------------------
ENV_FILE="$INSTALL_DIR/.env.local"
CREDS_GENERATED=0
ADMIN_PASSWORD=""
if [[ -f "$ENV_FILE" ]]; then
  warn ".env.local sudah ada — menyimpan nilai yang ada."
else
  log "Membuat .env.local + kredensial..."
  AUTH_SECRET="$(openssl rand -base64 32)"
  ADMIN_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
  cat > "$ENV_FILE" <<EOF
AUTH_SECRET=$AUTH_SECRET
AUTH_TRUST_HOST=true
USE_DOCKER=false
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
LETS_ENCRYPT_EMAIL=$LETS_ENCRYPT_EMAIL
CERTBOT_DRY_RUN=false
HOSTNAME=0.0.0.0
PORT=$PANEL_PORT
EOF
  chmod 600 "$ENV_FILE"
  CREDS_GENERATED=1
fi

# --- DB schema + seed --------------------------------------------------------
log "Menyiapkan database..."
npm run db:push
npm run db:seed

# --- systemd service ---------------------------------------------------------
log "Memasang layanan systemd..."
cp "$INSTALL_DIR/deploy/rinpanel.service" /etc/systemd/system/rinpanel.service
systemctl daemon-reload
systemctl enable --now rinpanel

# --- unbound page + nginx default server ------------------------------------
log "Memasang halaman default untuk domain belum terdaftar..."
mkdir -p /usr/share/rinpanel
cp "$INSTALL_DIR/docker/unbound.html" /usr/share/rinpanel/unbound.html
cat > /etc/nginx/sites-available/default <<'NGINX'
server {
    listen 80 default_server;
    server_name _;
    root /usr/share/rinpanel;

    server_tokens off;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    location / {
        try_files /unbound.html =404;
    }
}
NGINX
nginx -t >/dev/null && systemctl reload nginx

# --- firewall ----------------------------------------------------------------
log "Mengatur firewall (UFW)..."
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
yes | ufw --force enable >/dev/null 2>&1 || true

# --- wait for service --------------------------------------------------------
log "Menunggu rinpanel siap..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PANEL_PORT}/login" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- detect VPS IP -----------------------------------------------------------
VPS_IP="$(curl -fsS https://ifconfig.me 2>/dev/null || curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

# --- final report ------------------------------------------------------------
G="\033[1;32m"; B="\033[1;36m"; Y="\033[1;33m"; R="\033[0m"
cat <<EOF

${G}══════════════════════════════════════════════════════════════════════${R}
  ${G}rinpanel siap digunakan${R}
${G}══════════════════════════════════════════════════════════════════════${R}

  ${B}Akses panel${R}  : http://${VPS_IP}:${PANEL_PORT}/login
  ${B}Username${R}     : ${ADMIN_USERNAME}
EOF
if [[ "$CREDS_GENERATED" == "1" ]]; then
cat <<EOF
  ${B}Password${R}     : ${Y}${ADMIN_PASSWORD}${R}

  ${Y}↑ SIMPAN PASSWORD INI SEKARANG. Tidak akan ditampilkan lagi.${R}
EOF
else
cat <<EOF
  ${B}Password${R}     : (lihat ${ENV_FILE})
EOF
fi
cat <<EOF

  ${B}Lokasi${R}       : ${INSTALL_DIR}
  ${B}Konfigurasi${R}  : ${ENV_FILE}

  Periksa log:    journalctl -u rinpanel -f
  Status:         systemctl status rinpanel
  Update nanti:   cd ${INSTALL_DIR} && git pull && npm install && npm run build && systemctl restart rinpanel

${G}══════════════════════════════════════════════════════════════════════${R}
EOF
