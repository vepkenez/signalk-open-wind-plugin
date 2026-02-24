#!/bin/bash
# Deploy plugin to a Raspberry Pi running Signal K.
# Usage: ./deploy-pi.sh [host]    (default: rpi.local)
#        npm run deploy            (uses default host)

set -e

HOST="${1:-rpi.local}"
USER="${DEPLOY_USER:-damon}"
REMOTE_DIR="/home/${USER}/.signalk/node_modules/signalk-open-wind-plugin"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Deploying to ${USER}@${HOST}...${NC}"

rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude venv \
  --exclude __pycache__ \
  --exclude '*.pyc' \
  -e ssh \
  ./ "${USER}@${HOST}:${REMOTE_DIR}/"

echo -e "${GREEN}Files synced.${NC}"
echo -e "${YELLOW}Restarting Signal K...${NC}"

ssh "${USER}@${HOST}" "sudo systemctl restart signalk" 2>/dev/null \
  || ssh "${USER}@${HOST}" "sudo systemctl restart signalk-server" 2>/dev/null \
  || echo -e "${YELLOW}Could not restart service automatically. Restart Signal K manually.${NC}"

echo -e "${GREEN}Done. Open http://${HOST}:3000/open-wind to test.${NC}"
