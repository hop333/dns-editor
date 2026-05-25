#!/usr/bin/env bash
# Единая точка входа для развёртывания DNS Editor на Ubuntu VPS.
#
# Два режима (Docker НЕ удалён — это основной способ для диплома):
#
#   docker  — BIND + API + UI в Docker Compose (проще, всё из коробки)
#   native  — системный BIND + PM2 + nginx (production, если BIND уже на VPS)
#
# Примеры:
#   sudo bash scripts/deploy.sh
#   sudo bash scripts/deploy.sh --mode docker --ip 1.2.3.4
#   sudo bash scripts/deploy.sh --mode native --url https://dns.example.com
#
# Справка:
#   bash scripts/deploy.sh --help

set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

show_help() {
  cat <<'EOF'
DNS Editor — скрипт развёртывания

Использование:
  sudo bash scripts/deploy.sh [--mode docker|native] [опции]

Режимы:
  docker   (по умолчанию)  Всё в Docker: BIND + FastAPI + Next.js
  native                   Системный BIND + Node.js + PM2 + nginx

Docker — опции (scripts/deploy-docker.sh):
  --ip IP                  публичный IP сервера
  --skip-docker-install    не устанавливать Docker
  --no-rndc-regen          не перегенерировать config/rndc.key

Native — опции (scripts/deploy-native.sh):
  --url URL                https://ваш-домен.ru
  --app-dir PATH           каталог проекта
  --skip-bind-install      BIND9 уже установлен

Примеры:
  sudo bash scripts/deploy.sh --mode docker --ip 185.12.34.56
  sudo bash scripts/deploy.sh --mode native --url https://dns.mydomain.ru

Подробнее: docs/production-ubuntu24.md (native), README.md (docker)
EOF
}

MODE=""
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      PASSTHRU+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo ""
  echo "DNS Editor — выберите режим развёртывания:"
  echo ""
  echo "  1) docker  — BIND + API + UI в Docker (рекомендуется для начала)"
  echo "  2) native  — системный BIND + PM2 + nginx (production на Ubuntu)"
  echo ""
  read -r -p "Ваш выбор [1/2] (Enter = 1): " choice
  case "${choice:-1}" in
    1|docker|Docker) MODE=docker ;;
    2|native|Native) MODE=native ;;
    *)
      echo "Неверный выбор" >&2
      exit 1
      ;;
  esac
  echo ""
fi

case "$MODE" in
  docker)
    exec bash "$SCRIPTS/deploy-docker.sh" "${PASSTHRU[@]}"
    ;;
  native)
    exec bash "$SCRIPTS/deploy-native.sh" "${PASSTHRU[@]}"
    ;;
  *)
    echo "Неизвестный режим: $MODE (используйте docker или native)" >&2
    exit 1
    ;;
esac
