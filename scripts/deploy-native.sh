#!/usr/bin/env bash
# Production без Docker: системный BIND + Node.js + PM2 + nginx.
# Вызывается из scripts/deploy.sh --mode native
#
#   sudo PUBLIC_URL=https://dns.example.com bash scripts/deploy-native.sh
#
# Опции:
#   --url URL              публичный URL редактора (https://домен.ru)
#   --app-dir PATH         каталог проекта (по умолчанию — корень репозитория)
#   --skip-bind-install    не ставить пакет bind9 (если уже установлен)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
APP_USER="${APP_USER:-dnseditor}"
PUBLIC_URL="${PUBLIC_URL:-}"
SKIP_BIND_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) PUBLIC_URL="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --skip-bind-install) SKIP_BIND_INSTALL=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите с sudo: sudo bash scripts/deploy-native.sh" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/backend/main.py" ]]; then
  echo "Проект не найден в $APP_DIR" >&2
  exit 1
fi

echo "=== DNS Editor — native (PM2 + nginx) ==="
echo "Каталог: $APP_DIR"

# --- 1. Пакеты ---
echo "[1/9] apt..."
apt-get update -qq
PKGS="curl ca-certificates gnupg nginx python3 python3-pip python3-venv bind9utils bind9-dnsutils"
if [[ "$SKIP_BIND_INSTALL" -eq 0 ]]; then
  PKGS="$PKGS bind9"
fi
apt-get install -y -qq $PKGS

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  echo "[*] Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "[ok] node $(node -v) npm $(npm -v)"

# --- 2. Пользователь ---
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
usermod -aG bind "$APP_USER" 2>/dev/null || true

# --- 3. BIND zones ---
mkdir -p /etc/bind/zones/keys
chown -R root:bind /etc/bind/zones
chmod 775 /etc/bind/zones

if [[ -d "$APP_DIR/zones" ]]; then
  for f in "$APP_DIR"/zones/db.*; do
    [[ -f "$f" ]] || continue
    cp -n "$f" /etc/bind/zones/ 2>/dev/null || cp "$f" /etc/bind/zones/
  done
fi

if [[ -f "$APP_DIR/config/named.conf.local" ]] && [[ ! -s /etc/bind/named.conf.local ]]; then
  cp "$APP_DIR/config/named.conf.local" /etc/bind/named.conf.local
fi
chgrp bind /etc/bind/named.conf.local 2>/dev/null || true
chmod 664 /etc/bind/named.conf.local 2>/dev/null || true
chown -R "$APP_USER":bind "$APP_DIR"
chmod -R g+w /etc/bind/zones /etc/bind/named.conf.local 2>/dev/null || true

# --- 4. production.env ---
ENV_FILE="$APP_DIR/deploy/production.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$APP_DIR/deploy/production.env.example" "$ENV_FILE"
fi

if [[ -z "$PUBLIC_URL" ]]; then
  read -r -p "Публичный URL редактора (https://dns.example.com): " PUBLIC_URL
fi
PUBLIC_URL="${PUBLIC_URL%/}"
API_URL="${PUBLIC_URL}/api"

if grep -q 'CHANGE_ME' "$ENV_FILE"; then
  pw="$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)"
  sec="$(openssl rand -hex 32)"
  sed -i "s/CHANGE_ME_STRONG_PASSWORD/$pw/" "$ENV_FILE"
  sed -i "s/CHANGE_ME_OPENSSL_RAND_HEX_32/$sec/" "$ENV_FILE"
fi
sed -i "s|https://dns.example.com|$PUBLIC_URL|g" "$ENV_FILE"
sed -i "s|NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=$API_URL|" "$ENV_FILE"
sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=$PUBLIC_URL|" "$ENV_FILE"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# --- 5. Backend ---
echo "[5/9] Python venv..."
sudo -u "$APP_USER" python3 -m venv "$APP_DIR/backend/.venv"
sudo -u "$APP_USER" "$APP_DIR/backend/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"

# --- 6. Frontend ---
echo "[6/9] npm build..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
cd "$APP_DIR/frontend"
sudo -u "$APP_USER" env NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" npm ci
sudo -u "$APP_USER" env NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR/frontend"

# --- 7. PM2 ---
echo "[7/9] PM2..."
npm install -g pm2
sudo -u "$APP_USER" pm2 delete all 2>/dev/null || true
cd "$APP_DIR"
sudo -u "$APP_USER" pm2 start deploy/ecosystem.config.cjs
sudo -u "$APP_USER" pm2 save
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "$APP_DIR" | tail -1 | bash || true

# --- 8. nginx ---
echo "[8/9] nginx..."
NGINX_SITE="/etc/nginx/sites-available/dns-editor"
SERVER_NAME="${PUBLIC_URL#https://}"
SERVER_NAME="${SERVER_NAME#http://}"
SERVER_NAME="${SERVER_NAME%%/*}"
cp "$APP_DIR/deploy/nginx-dns-editor.conf" "$NGINX_SITE"
sed -i "s/dns.example.com/$SERVER_NAME/g" "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/dns-editor"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

# --- 9. BIND ---
echo "[9/9] named..."
systemctl enable named 2>/dev/null || systemctl enable bind9 2>/dev/null || true
systemctl restart named 2>/dev/null || systemctl restart bind9 2>/dev/null || true

echo ""
echo "============================================"
echo "  DNS Editor (native) развёрнут"
echo "  UI:     $PUBLIC_URL"
echo "  API:    $API_URL"
echo "  PM2:    sudo -u $APP_USER pm2 status"
echo "  Пароль: grep ADMIN_PASSWORD $ENV_FILE"
echo "  HTTPS:  sudo certbot --nginx -d $SERVER_NAME"
echo "============================================"
