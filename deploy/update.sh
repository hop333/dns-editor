#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dns-editor}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -d .git ]]; then
  echo "$APP_DIR is not a git repository." >&2
  exit 1
fi

git pull --ff-only
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
docker compose --env-file .env -f deploy/docker-compose.prod.yml ps
