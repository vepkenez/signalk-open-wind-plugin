#!/usr/bin/env bash
# Stream Open Wind plugin log live from rpi.local.
# Usage: ./scripts/watch-pi-live.sh   (or: bash scripts/watch-pi-live.sh)

set -e
HOST="${1:-rpi.local}"
API="http://${HOST}:3000/open-wind/log"
echo "Watching plugin log at ${HOST}:3000 (Ctrl+C to stop)"
echo "---"

while true; do
  # Pretty-print if jq available, otherwise raw JSON
  curl -s "${API}?n=15" | (command -v jq >/dev/null && jq -r '.[]' || cat)
  echo "---"
  sleep 2
done
