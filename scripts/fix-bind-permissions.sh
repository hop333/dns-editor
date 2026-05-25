#!/usr/bin/env bash
# Права на rndc.key для пользователя bind в контейнере (permission denied).
# Запуск: sudo bash scripts/fix-bind-permissions.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$ROOT/config/rndc.key"
if [[ ! -f "$KEY" ]]; then
  echo "Нет $KEY — сначала: docker run --rm -v \"$ROOT/config:/etc/bind\" ubuntu/bind9:latest rndc-confgen -a -A hmac-sha256 -c /etc/bind/rndc.key"
  exit 1
fi
chmod 644 "$KEY"
echo "[ok] chmod 644 $KEY"
cd "$ROOT"
docker compose down 2>/dev/null || true
docker compose --env-file .env up -d
echo "[*] Подождите 30 с, затем: docker compose ps"
