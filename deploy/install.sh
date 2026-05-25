#!/usr/bin/env bash
# Self-hosted installer for DNS Editor.
#
# Example:
#   curl -fsSL https://raw.githubusercontent.com/hop333/dns-editor/main/deploy/install.sh \
#     | sudo bash -s -- --repo https://github.com/hop333/dns-editor.git --domain dns.example.com --email admin@example.com

set -euo pipefail

APP_DIR="/opt/dns-editor"
REPO_URL="${REPO_URL:-}"
PANEL_DOMAIN=""
SITE_DOMAIN=""
ACME_EMAIL=""
ADMIN_USER="admin"
HTTP_ONLY=0
SKIP_DOCKER=0
FREE_PORT_53=0

usage() {
  cat <<'EOF'
DNS Editor installer

Required:
  --repo URL              Git repository URL to clone or update

Recommended:
  --domain NAME           Panel domain, for example dns.example.com
  --email EMAIL           Let's Encrypt email for Caddy

Optional:
  --app-dir PATH          Install directory, default: /opt/dns-editor
  --admin USER            Admin username, default: admin
  --site-domain NAME      Public site domain, for example example.com
  --http-only             Use plain HTTP in Caddy
  --free-port-53          Disable systemd-resolved stub listener if it blocks port 53
  --skip-docker-install   Do not install Docker automatically

Examples:
  sudo bash deploy/install.sh --repo https://github.com/hop333/dns-editor.git --domain dns.example.com --site-domain example.com --email admin@example.com
  sudo bash deploy/install.sh --repo https://github.com/hop333/dns-editor.git --domain 203.0.113.10 --http-only
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --domain) PANEL_DOMAIN="${2:-}"; shift 2 ;;
    --site-domain) SITE_DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --admin) ADMIN_USER="${2:-}"; shift 2 ;;
    --http-only) HTTP_ONLY=1; shift ;;
    --free-port-53) FREE_PORT_53=1; shift ;;
    --skip-docker-install) SKIP_DOCKER=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

if [[ -z "$REPO_URL" ]]; then
  echo "--repo is required until the project has a final GitHub URL." >&2
  usage
  exit 1
fi

install_prereqs() {
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git openssl
}

install_docker() {
  if [[ "$SKIP_DOCKER" -eq 1 ]]; then
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
}

fix_crlf() {
  cd "$APP_DIR"
  find scripts deploy -name '*.sh' -type f -exec sed -i 's/\r$//' {} + 2>/dev/null || true
  [[ -f .env ]] && sed -i 's/\r$//' .env
}

prepare_port_53() {
  if [[ "$FREE_PORT_53" -ne 1 ]]; then
    return
  fi
  if ! ss -lntup 2>/dev/null | grep -q ':53 '; then
    return
  fi
  if systemctl is-active systemd-resolved >/dev/null 2>&1; then
    cp -a /etc/systemd/resolved.conf "/etc/systemd/resolved.conf.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    if grep -q '^#*DNSStubListener=' /etc/systemd/resolved.conf 2>/dev/null; then
      sed -i 's/^#*DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
    else
      printf '\nDNSStubListener=no\n' >> /etc/systemd/resolved.conf
    fi
    systemctl restart systemd-resolved || true
  fi
}

checkout_project() {
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" pull --ff-only
  elif [[ -d "$APP_DIR" ]]; then
    echo "$APP_DIR exists but is not a git repository." >&2
    exit 1
  else
    git clone "$REPO_URL" "$APP_DIR"
  fi
}

detect_domain() {
  if [[ -n "$PANEL_DOMAIN" ]]; then
    return
  fi
  PANEL_DOMAIN="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$PANEL_DOMAIN" ]]; then
    read -r -p "Panel domain or server IP: " PANEL_DOMAIN
  fi
}

warn_panel_domain() {
  if [[ -n "$SITE_DOMAIN" && "$PANEL_DOMAIN" == "$SITE_DOMAIN" ]]; then
    echo "Panel domain and site domain are the same." >&2
    echo "Use a subdomain for the panel, for example dns.${SITE_DOMAIN}, so visitors of ${SITE_DOMAIN} do not see the login page." >&2
    exit 1
  fi
}

normalize_http_mode() {
  if [[ "$PANEL_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$HTTP_ONLY" -eq 0 ]]; then
    echo "Panel target looks like an IPv4 address; switching to --http-only because Let's Encrypt needs a domain."
    HTTP_ONLY=1
  fi
}

write_env() {
  cd "$APP_DIR"
  if [[ -f .env ]]; then
    echo ".env already exists, keeping it."
    return
  fi

  local scheme="https"
  if [[ "$HTTP_ONLY" -eq 1 ]]; then
    scheme="http"
  fi

  local password secret
  password="$(openssl rand -base64 24 | tr -d '/+=' | head -c 20)"
  secret="$(openssl rand -hex 32)"

  cat > .env <<EOF
DNS_PORT=53
HTTP_PORT=80
HTTPS_PORT=443

PANEL_DOMAIN=${PANEL_DOMAIN}
SITE_DOMAIN=${SITE_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}

NEXT_PUBLIC_API_URL=/api
CORS_ORIGINS=${scheme}://${PANEL_DOMAIN}

ADMIN_USER=${ADMIN_USER}
ADMIN_PASSWORD=${password}
SECRET_KEY=${secret}
JWT_EXPIRE_HOURS=24
EOF

  chmod 600 .env
  echo "Generated .env. Admin password is stored in $APP_DIR/.env"
}

write_caddyfile() {
  cd "$APP_DIR"
  local scheme=""
  if [[ "$HTTP_ONLY" -eq 1 ]]; then
    scheme="http://"
  fi
  : > deploy/Caddyfile
  if [[ -n "$ACME_EMAIL" && "$HTTP_ONLY" -eq 0 ]]; then
    printf '{\n    email %s\n}\n\n' "$ACME_EMAIL" >> deploy/Caddyfile
  fi

  cat >> deploy/Caddyfile <<EOF
${scheme}${PANEL_DOMAIN} {
    encode gzip zstd

    handle_path /api/* {
        reverse_proxy backend:8000
    }

    handle {
        reverse_proxy frontend:3000
    }
}
EOF

  if [[ -n "$SITE_DOMAIN" ]]; then
    cat >> deploy/Caddyfile <<EOF

${scheme}${SITE_DOMAIN} {
    root * /srv/site
    encode gzip zstd
    file_server
}
EOF
  fi
}

generate_rndc_key() {
  cd "$APP_DIR"
  mkdir -p config zones
  docker run --rm -v "$APP_DIR/config:/etc/bind" ubuntu/bind9:latest \
    rndc-confgen -a -A hmac-sha256 -c /etc/bind/rndc.key
  chmod 644 config/rndc.key
}

start_stack() {
  cd "$APP_DIR"
  docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
}

print_summary() {
  local scheme="https"
  if [[ "$HTTP_ONLY" -eq 1 ]]; then
    scheme="http"
  fi

  echo ""
  echo "DNS Editor is installed."
  echo "Panel: ${scheme}://${PANEL_DOMAIN}"
  echo "Admin user: ${ADMIN_USER}"
  echo "Admin password: sudo grep ADMIN_PASSWORD ${APP_DIR}/.env"
  echo "Logs: cd ${APP_DIR} && sudo docker compose --env-file .env -f deploy/docker-compose.prod.yml logs -f"
  echo "DNS test: dig @${PANEL_DOMAIN} mydomain.ru A +short"
}

install_prereqs
install_docker
checkout_project
fix_crlf
detect_domain
warn_panel_domain
normalize_http_mode
prepare_port_53
write_env
write_caddyfile
generate_rndc_key
start_stack
print_summary
