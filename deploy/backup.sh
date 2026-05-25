#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dns-editor}"
BACKUP_DIR="${BACKUP_DIR:-/opt/dns-editor-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/dns-editor-$STAMP.tar.gz"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

tar -czf "$OUT" \
  .env \
  config \
  zones \
  deploy/Caddyfile

chmod 600 "$OUT"
echo "Backup written to $OUT"
