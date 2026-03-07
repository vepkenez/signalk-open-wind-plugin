#!/usr/bin/env bash
# Listen to the NMEA 2000 CAN bus and print frames.
# Run on the Pi, or via SSH from your Mac.
#
# Usage:
#   ./scripts/listen-can.sh              # stream all CAN traffic
#   ./scripts/listen-can.sh rpi.local    # SSH to rpi.local and run candump there
#   ./scripts/listen-can.sh --wind        # only lines containing wind PGN 130306 / 0x1FD02

set -e
HOST=""
FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --wind)  FILTER="grep -E '130306|1FD02'"; shift ;;
    -w)      FILTER="grep -E '130306|1FD02'"; shift ;;
    *)       HOST="$1"; shift ;;
  esac
done

IFACE="${CAN_INTERFACE:-can0}"

if [ -n "$HOST" ]; then
  echo "Listening on $HOST ($IFACE). Ctrl+C to stop."
  if [ -n "$FILTER" ]; then
    ssh "$HOST" "candump $IFACE 2>/dev/null" | $FILTER
  else
    ssh "$HOST" "candump $IFACE 2>/dev/null"
  fi
else
  echo "Listening on $IFACE. Ctrl+C to stop."
  if [ -n "$FILTER" ]; then
    candump "$IFACE" 2>/dev/null | $FILTER
  else
    candump "$IFACE" 2>/dev/null
  fi
fi
