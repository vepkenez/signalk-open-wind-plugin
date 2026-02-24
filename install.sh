#!/bin/bash

# Signal K Open Wind Plugin - Manual Setup Script
# Run this AFTER installing the plugin via the SignalK app store or npm.
# This script sets up automatic reinstallation to survive server updates.
#
# Usage: npm run setup
#   or:  ./install.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SIGNALK_DIR="${SIGNALK_DIR:-$HOME/.signalk}"
PLUGIN_NAME="signalk-open-wind-plugin"

echo -e "${GREEN}Signal K Open Wind Plugin Setup${NC}"
echo "========================================"

if [ ! -d "$SIGNALK_DIR" ]; then
    echo -e "${RED}Error: Signal K directory not found at $SIGNALK_DIR${NC}"
    echo "Set SIGNALK_DIR if your Signal K config is elsewhere."
    exit 1
fi

# Detect signalk-server binary
SIGNALK_SERVER=""
for candidate in \
    /usr/lib/node_modules/signalk-server/bin/signalk-server \
    /usr/local/lib/node_modules/signalk-server/bin/signalk-server \
    "$(which signalk-server 2>/dev/null || true)"; do
    if [ -x "$candidate" ]; then
        SIGNALK_SERVER="$candidate"
        break
    fi
done

if [ -z "$SIGNALK_SERVER" ]; then
    echo -e "${YELLOW}Warning: Could not find signalk-server binary.${NC}"
    echo "The startup script will use 'signalk-server' from PATH."
    SIGNALK_SERVER="signalk-server"
fi

echo "Signal K directory: $SIGNALK_DIR"
echo "Signal K server:    $SIGNALK_SERVER"

# Create startup script that re-installs the plugin if missing after a server update
STARTUP_SCRIPT="$SIGNALK_DIR/startup-plugins.sh"
if [ ! -f "$STARTUP_SCRIPT" ]; then
    echo -e "${YELLOW}Creating automatic plugin reinstallation script...${NC}"

    cat > "$STARTUP_SCRIPT" << EOF
#!/bin/bash

# Signal K Plugin Auto-Installation Script
# Ensures custom plugins survive server updates

SIGNALK_DIR="$SIGNALK_DIR"

check_and_install() {
    local pkg="\$1"
    if [ ! -d "\$SIGNALK_DIR/node_modules/\$pkg" ]; then
        echo "Reinstalling \$pkg..."
        cd "\$SIGNALK_DIR"
        npm install "\$pkg"
    fi
}

check_and_install "$PLUGIN_NAME"

echo "Plugin installation check complete"
EOF

    chmod +x "$STARTUP_SCRIPT"
    echo -e "${GREEN}✓ Startup script created at $STARTUP_SCRIPT${NC}"
else
    echo -e "${GREEN}✓ Startup script already exists${NC}"
fi

# Optionally modify the signalk-server wrapper to call the startup script
SERVER_SCRIPT="$SIGNALK_DIR/signalk-server"
if [ -f "$SERVER_SCRIPT" ] && ! grep -q "startup-plugins.sh" "$SERVER_SCRIPT"; then
    echo -e "${YELLOW}Modifying Signal K server startup script to auto-check plugins...${NC}"
    cp "$SERVER_SCRIPT" "$SERVER_SCRIPT.backup.$(date +%Y%m%d_%H%M%S)"

    cat > "$SERVER_SCRIPT" << EOF
#!/bin/sh

# Auto-install custom plugins before starting server
$SIGNALK_DIR/startup-plugins.sh

# Start Signal K server
$SIGNALK_SERVER -c $SIGNALK_DIR \$*
EOF

    chmod +x "$SERVER_SCRIPT"
    echo -e "${GREEN}✓ Server startup script updated (backup saved)${NC}"
else
    if [ -f "$SERVER_SCRIPT" ]; then
        echo -e "${GREEN}✓ Server startup script already configured${NC}"
    fi
fi

echo ""
echo -e "${GREEN}Setup Complete!${NC}"
echo ""
echo "The plugin will be automatically reinstalled if removed by a server update."
echo ""
echo "To start Signal K server:"
echo "  $SIGNALK_DIR/signalk-server"
