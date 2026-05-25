#!/usr/bin/env bash
# Развёртывание DNS Editor в Docker Compose (BIND + API + UI в контейнерах).
# Вызывается из scripts/deploy.sh --mode docker
#
#   sudo bash scripts/deploy-docker.sh --ip 1.2.3.4
#
# Опции:
#   --ip IP                 публичный IP (иначе определится автоматически)
#   --skip-docker-install   не ставить Docker
#   --no-rndc-regen         не перезаписывать config/rndc.key

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_DOCKER=0
REGEN_RNDC=1
SERVER_IP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip) SERVER_IP="${2:-}"; shift 2 ;;
    --skip-docker-install) SKIP_DOCKER=1; shift ;;
    --no-rndc-regen) REGEN_RNDC=0; shift ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите с sudo: sudo bash scripts/deploy-docker.sh" >&2
  exit 1
fi

echo "=== DNS Editor — Docker ==="
echo "Каталог: $ROOT"

# Убрать CRLF (архив/Windows) — иначе source .env и bash падают
fix_crlf() {
  local f
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    if grep -q $'\r' "$f" 2>/dev/null; then
      sed -i 's/\r$//' "$f"
      echo "[*] Исправлены переводы строк: $f"
    fi
  done
}

fix_crlf scripts/*.sh scripts/production/*.sh 2>/dev/null || true
fix_crlf .env.production.example .env.example deploy/production.env.example 2>/dev/null || true

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "[ok] Docker уже установлен"
    return
  fi
  echo "[*] Установка Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "[ok] Docker установлен"
}

free_port_53() {
  if ! ss -ulnp 2>/dev/null | grep -q ':53 '; then
    echo "[ok] Порт 53 UDP свободен"
    return
  fi
  echo "[!] Порт 53 занят. Часто это systemd-resolved (stub DNS)."
  if systemctl is-active systemd-resolved >/dev/null 2>&1; then
    echo "[*] Отключаем stub-listener..."
    if [[ -f /etc/systemd/resolved.conf ]]; then
      cp -a /etc/systemd/resolved.conf "/etc/systemd/resolved.conf.bak.$(date +%Y%m%d%H%M%S)"
    fi
  fi
  if grep -q '^#*DNSStubListener=' /etc/systemd/resolved.conf 2>/dev/null; then
    sed -i 's/^#*DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
  else
    echo 'DNSStubListener=no' >> /etc/systemd/resolved.conf
  fi
  systemctl restart systemd-resolved 2>/dev/null || true
  sleep 1
  if ss -ulnp 2>/dev/null | grep -q ':53 '; then
    echo "[!] Порт 53 всё ещё занят. Остановите службу вручную или задайте DNS_PORT=5354 в .env"
    ss -ulnp | grep ':53 ' || true
  else
    echo "[ok] Порт 53 освобождён"
  fi
}

detect_ip() {
  if [[ -n "$SERVER_IP" ]]; then
    return
  fi
  SERVER_IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$SERVER_IP" ]]; then
    SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
}

setup_env() {
  if [[ ! -f .env ]]; then
    echo "[*] Создание .env из .env.production.example"
    cp .env.production.example .env
  fi
  fix_crlf .env
  detect_ip
  if [[ -z "$SERVER_IP" ]]; then
    read -r -p "Публичный IP сервера: " SERVER_IP
  fi
  echo "[*] IP сервера: $SERVER_IP"

  if grep -q 'YOUR_SERVER_IP' .env; then
    sed -i "s/YOUR_SERVER_IP/$SERVER_IP/g" .env
  fi
  if grep -q 'CHANGE_ME_STRONG_PASSWORD' .env; then
    pw="$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)"
    sed -i "s/CHANGE_ME_STRONG_PASSWORD/$pw/" .env
    echo "[*] Сгенерирован ADMIN_PASSWORD (см. .env)"
  fi
  if grep -q 'CHANGE_ME_RANDOM_SECRET' .env; then
    secret="$(openssl rand -hex 32)"
    sed -i "s/CHANGE_ME_RANDOM_SECRET/$secret/" .env
  fi

  # shellcheck disable=SC1091
  set -a && source .env && set +a
  if [[ "${NEXT_PUBLIC_API_URL:-}" == *"YOUR_SERVER_IP"* ]]; then
    echo "Задайте NEXT_PUBLIC_API_URL в .env" >&2
    exit 1
  fi
}

generate_rndc() {
  if [[ "$REGEN_RNDC" -eq 0 && -f config/rndc.key ]]; then
    echo "[ok] rndc.key без изменений"
    return
  fi
  echo "[*] Генерация config/rndc.key..."
  mkdir -p config
  # -c /dev/stdout в образе bind9 даёт «invalid file»; пишем ключ в смонтированный config/
  docker run --rm -v "$ROOT/config:/etc/bind" ubuntu/bind9:latest \
    rndc-confgen -a -A hmac-sha256 -c /etc/bind/rndc.key
  # named в контейнере работает от пользователя bind — ключ должен читаться
  chmod 644 config/rndc.key
  echo "[ok] rndc.key создан"
}

verify_bind_config() {
  echo "[*] Проверка named-checkconf / named-checkzone..."
  if ! docker run --rm \
    -v "$ROOT/config:/etc/bind" \
    -v "$ROOT/zones:/etc/bind/zones" \
    ubuntu/bind9:latest named-checkconf; then
    echo "[!] named-checkconf failed" >&2
    exit 1
  fi
  if ! docker run --rm \
    -v "$ROOT/config:/etc/bind" \
    -v "$ROOT/zones:/etc/bind/zones" \
    ubuntu/bind9:latest named-checkzone mydomain.ru /etc/bind/zones/db.mydomain.ru; then
    echo "[!] named-checkzone failed для mydomain.ru" >&2
    exit 1
  fi
  echo "[ok] конфигурация BIND валидна"
}

compose_up() {
  echo "[*] Сборка и запуск контейнеров..."
  docker compose --env-file .env build --no-cache frontend
  docker compose --env-file .env up -d --build
}

wait_healthy() {
  echo "[*] Ожидание готовности BIND..."
  for _ in $(seq 1 40); do
    if docker inspect -f '{{.State.Health.Status}}' dns-server 2>/dev/null | grep -q healthy; then
      echo "[ok] BIND healthy"
      return
    fi
    sleep 3
  done
  echo "[!] BIND не стал healthy. Логи: docker logs dns-server" >&2
  docker logs dns-server --tail 30 2>&1 || true
  exit 1
}

smoke_api() {
  # shellcheck disable=SC1091
  set -a && source .env && set +a
  local user="${ADMIN_USER:-admin}"
  local pass="${ADMIN_PASSWORD:-admin}"
  local api="http://127.0.0.1:${BACKEND_PORT:-8000}"
  echo "[*] Проверка API..."
  curl -fsS "$api/" >/dev/null
  token="$(curl -fsS -X POST "$api/auth/login" \
    -d "username=$user&password=$pass" \
    -H 'Content-Type: application/x-www-form-urlencoded' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
  if [[ -z "$token" ]]; then
    echo "[!] Не удалось войти в API" >&2
    exit 1
  fi
  curl -fsS -H "Authorization: Bearer $token" "$api/status" >/dev/null
  echo "[ok] API и BIND доступны"
}

print_summary() {
  # shellcheck disable=SC1091
  set -a && source .env && set +a
  local ip="$SERVER_IP"
  local ui_port="${FRONTEND_PORT:-3000}"
  local api_port="${BACKEND_PORT:-8000}"
  echo ""
  echo "============================================"
  echo "  DNS Editor (Docker) развёрнут"
  echo "============================================"
  echo "  Редактор:  http://${ip}:${ui_port}"
  echo "  API:       http://${ip}:${api_port}"
  echo "  Логин:     ${ADMIN_USER:-admin}"
  echo "  Пароль:    grep ADMIN_PASSWORD .env"
  echo ""
  echo "  dig @${ip} mydomain.ru A +short"
  echo "  Логи: docker compose logs -f"
  echo "============================================"
}

[[ "$SKIP_DOCKER" -eq 0 ]] && install_docker
free_port_53
setup_env
generate_rndc
verify_bind_config
compose_up
wait_healthy
smoke_api
print_summary
