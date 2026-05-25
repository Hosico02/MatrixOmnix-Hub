#!/usr/bin/env bash
set -euo pipefail

SMOKE_DB="/tmp/hub-smoke-$$.db"
ADMIN_TOKEN="smoke-admin"
HUB_PORT=3131

cleanup() {
  if [ -n "${HUB_PID:-}" ]; then
    kill "$HUB_PID" 2>/dev/null || true
  fi
  rm -f "$SMOKE_DB" "$SMOKE_DB-wal" "$SMOKE_DB-shm"
}
trap cleanup EXIT

# Seed
HUB_DB_PATH="$SMOKE_DB" pnpm hub:seed > /tmp/seed.out
HUB_TOKEN=$(grep "^HUB_TOKEN=" /tmp/seed.out | cut -d= -f2)
echo "got HUB_TOKEN: ${HUB_TOKEN:0:8}..."

# Start hub
HUB_ADMIN_TOKEN="$ADMIN_TOKEN" \
HUB_DB_PATH="$SMOKE_DB" \
HUB_PORT="$HUB_PORT" \
pnpm exec tsx src/hub/index.ts > /tmp/hub.log 2>&1 &
HUB_PID=$!
sleep 2

# Probe health
echo "== health =="
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:$HUB_PORT/admin/health"
echo

# Simulate d2p run via /api/events
RUN_ID=$(uuidgen)
echo "== run_started =="
curl -sf -X POST -H "content-type: application/json" \
  -H "Authorization: Bearer $HUB_TOKEN" \
  -d "{\"type\":\"run_started\",\"run_id\":\"$RUN_ID\",\"payload\":{\"project_path\":\"/tmp/smoke\",\"detected_archetype\":\"fastapi-api\",\"started_at\":\"$(date -u +%FT%TZ)\"}}" \
  "http://127.0.0.1:$HUB_PORT/api/events"
echo

echo "== finding =="
curl -sf -X POST -H "content-type: application/json" \
  -H "Authorization: Bearer $HUB_TOKEN" \
  -d "{\"type\":\"finding_recorded\",\"run_id\":\"$RUN_ID\",\"payload\":{\"iter_n\":1,\"category\":\"missing_env_example\",\"severity\":\"low\",\"is_new\":true}}" \
  "http://127.0.0.1:$HUB_PORT/api/events"
echo

# Verify in DB
echo "== runs in DB =="
sqlite3 "$SMOKE_DB" "SELECT id, project_path, detected_archetype, terminal_state FROM runs;"
echo

echo "== findings in DB =="
sqlite3 "$SMOKE_DB" "SELECT category, severity FROM findings;"
echo

echo "smoke OK"
