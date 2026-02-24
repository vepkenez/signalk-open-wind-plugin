#!/bin/bash

# Integration test: install and run the plugin in a clean SignalK Docker container.
# Usage: ./test-docker.sh
#   or:  npm test

set -e

CONTAINER="signalk-open-wind-test"
IMAGE="signalk/signalk-server:latest"
PORT=3100
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
WAIT_SECS=15
DATA_WAIT_SECS=5

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓ $1${NC}"; }
fail() { echo -e "  ${RED}✗ $1${NC}"; }

cleanup() {
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    docker rm -f "$CONTAINER" > /dev/null 2>&1
  fi
}

trap cleanup EXIT

echo ""
echo "=========================================="
echo " SignalK Open Wind Plugin — Docker Test"
echo "=========================================="
echo ""

# ── Preflight ────────────────────────────────────────────

echo -e "${YELLOW}[1/6] Preflight checks${NC}"

if ! docker info > /dev/null 2>&1; then
  fail "Docker is not running"
  exit 1
fi
pass "Docker is running"

node -c "$PLUGIN_DIR/plugin/index.js"
pass "plugin/index.js syntax OK"

cleanup

# ── Start container ──────────────────────────────────────

echo -e "${YELLOW}[2/6] Starting SignalK server${NC}"

docker run -d --name "$CONTAINER" \
  -p "$PORT":3000 \
  -v "$PLUGIN_DIR":/plugin-source:ro \
  "$IMAGE" > /dev/null 2>&1

echo -n "  Waiting for server "
for i in $(seq 1 "$WAIT_SECS"); do
  if curl -sf "http://localhost:$PORT/signalk/v1/api/" > /dev/null 2>&1; then
    echo ""
    pass "SignalK server is up"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq "$WAIT_SECS" ]; then
    echo ""
    fail "SignalK server did not start in ${WAIT_SECS}s"
    docker logs "$CONTAINER" 2>&1 | tail -20
    exit 1
  fi
done

# ── Install plugin ───────────────────────────────────────

echo -e "${YELLOW}[3/6] Installing plugin via npm${NC}"

OUTPUT=$(docker exec "$CONTAINER" bash -c \
  "cd /home/node/.signalk && npm install /plugin-source 2>&1")

if echo "$OUTPUT" | grep -qi "err!"; then
  fail "npm install failed"
  echo "$OUTPUT"
  exit 1
fi
pass "npm install succeeded"

if docker exec "$CONTAINER" \
  test -f /home/node/.signalk/node_modules/signalk-open-wind-plugin/plugin/index.js; then
  pass "Plugin files present in node_modules"
else
  fail "Plugin files missing"
  exit 1
fi

# ── Enable plugin and restart ────────────────────────────

echo -e "${YELLOW}[4/6] Enabling plugin and restarting${NC}"

docker exec "$CONTAINER" bash -c 'mkdir -p /home/node/.signalk/plugin-config-data && \
cat > /home/node/.signalk/plugin-config-data/open-wind.json << INNEREOF
{
  "enabled": true,
  "enableLogging": true,
  "configuration": {
    "amplitude": 10,
    "interval": 1000,
    "yawOffset": 0,
    "pythonPath": ""
  }
}
INNEREOF'

docker restart "$CONTAINER" > /dev/null 2>&1

echo -n "  Waiting for restart "
for i in $(seq 1 "$WAIT_SECS"); do
  if curl -sf "http://localhost:$PORT/signalk/v1/api/" > /dev/null 2>&1; then
    echo ""
    pass "Server restarted"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq "$WAIT_SECS" ]; then
    echo ""
    fail "Server did not restart in ${WAIT_SECS}s"
    docker logs "$CONTAINER" 2>&1 | tail -20
    exit 1
  fi
done

# ── Verify data paths ───────────────────────────────────

echo -e "${YELLOW}[5/6] Verifying plugin data paths${NC}"

sleep "$DATA_WAIT_SECS"

API_RESPONSE=$(curl -sf "http://localhost:$PORT/signalk/v1/api/vessels/self" 2>&1)

ERRORS=0
check_path() {
  if echo "$API_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
keys = '$1'.split('.')
node = data
for k in keys:
    node = node[k]
assert node.get('value') is not None
" 2>/dev/null; then
    pass "$1"
  else
    fail "$1 — missing or null"
    ERRORS=$((ERRORS + 1))
  fi
}

check_path "environment.wind.speedApparent"
check_path "environment.wind.angleApparent"
check_path "sensors.mast.yaw"
check_path "sensors.mast.rotation"
check_path "sensors.mast.windAngle"

# ── Verify webapp ────────────────────────────────────────

echo -e "${YELLOW}[6/6] Verifying webapp${NC}"

HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:$PORT/open-wind" 2>&1)
if [ "$HTTP_CODE" = "200" ]; then
  pass "/open-wind returns 200"
else
  fail "/open-wind returned $HTTP_CODE"
  ERRORS=$((ERRORS + 1))
fi

HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:$PORT/open-wind/" 2>&1)
if [ "$HTTP_CODE" = "200" ]; then
  pass "/open-wind/ returns 200"
else
  fail "/open-wind/ returned $HTTP_CODE"
  ERRORS=$((ERRORS + 1))
fi

# ── Summary ──────────────────────────────────────────────

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${GREEN}All tests passed.${NC}"
  exit 0
else
  echo -e "${RED}${ERRORS} test(s) failed.${NC}"
  echo ""
  echo "Container logs:"
  docker logs "$CONTAINER" 2>&1 | tail -20
  exit 1
fi
