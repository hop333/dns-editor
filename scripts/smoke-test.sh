#!/usr/bin/env bash
# Smoke-тест на Linux (VPS или WSL). Перед запуском: docker compose up -d
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

BASE="${SMOKE_API_URL:-http://127.0.0.1:${BACKEND_PORT:-8000}}"
USER="${ADMIN_USER:-admin}"
PASS="${ADMIN_PASSWORD:-admin}"
ZONE="smoke-test.local"
PASSED=0
FAILED=0

run_test() {
  local name="$1"
  shift
  if "$@"; then
    echo "[OK] $name"
    PASSED=$((PASSED + 1))
  else
    echo "[FAIL] $name"
    FAILED=$((FAILED + 1))
  fi
}

echo ""
echo "=== DNS Editor smoke test ==="
echo "API: $BASE"
echo ""

run_test "GET / (health)" bash -c "curl -fsS '$BASE/' | grep -q '\"status\":\"ok\"'"

run_test "GET /zones without auth -> 401" bash -c "
  code=\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/zones')
  [[ \"\$code\" == '401' ]]
"

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" \
  -d "username=$USER&password=$PASS" \
  -H 'Content-Type: application/x-www-form-urlencoded' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

if [[ -n "$TOKEN" ]]; then
  echo "[OK] POST /auth/login"
  PASSED=$((PASSED + 1))
else
  echo "[FAIL] POST /auth/login"
  FAILED=$((FAILED + 1))
fi

AUTH=(-H "Authorization: Bearer $TOKEN")

run_test "GET /zones (auth)" bash -c "curl -fsS '${AUTH[*]}' '$BASE/zones' | grep -q zones"

run_test "GET /status (BIND)" bash -c "curl -fsS '${AUTH[*]}' '$BASE/status' | grep -q 'bind_running\":true'"

PAYLOAD=$(cat <<EOF
{
  "name": "$ZONE",
  "type": "master",
  "ttl": 3600,
  "adminEmail": "admin@$ZONE",
  "primaryNs": "ns1.$ZONE",
  "records": [
    {"name": "@", "type": "NS", "value": "ns1.$ZONE", "ttl": 3600},
    {"name": "ns1", "type": "A", "value": "192.0.2.100", "ttl": 3600},
    {"name": "@", "type": "A", "value": "192.0.2.50", "ttl": 3600}
  ]
}
EOF
)

run_test "PUT create zone" bash -c "curl -fsS -X PUT '${AUTH[*]}' -H 'Content-Type: application/json' -d '$PAYLOAD' '$BASE/zones/$ZONE/records' | grep -q '$ZONE'"

run_test "POST reload zone" bash -c "curl -fsS -X POST '${AUTH[*]}' '$BASE/zones/$ZONE/reload' | grep -q ok"

run_test "DNS dig A record" bash -c "
  out=\$(docker exec dns-backend dig @dns-server $ZONE A +short 2>&1)
  echo \"\$out\" | grep -q '192.0.2.50'
"

run_test "DELETE zone" bash -c "curl -fsS -X DELETE '${AUTH[*]}' '$BASE/zones/$ZONE' | grep -q ok"

echo ""
echo "=== Results: $PASSED passed, $FAILED failed ==="
[[ "$FAILED" -eq 0 ]]
