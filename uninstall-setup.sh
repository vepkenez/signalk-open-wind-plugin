#!/bin/bash

# Signal K Open Wind Plugin - Undo Setup Script
# Reverts the changes made by install.sh so the plugin can be uninstalled
# via the Signal K app store and stay uninstalled.
#
# Usage: ./uninstall-setup.sh
#
# After running this, uninstall the plugin from the app store (or run
# npm uninstall signalk-open-wind-plugin in ~/.signalk) and restart Signal K.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SIGNALK_DIR="${SIGNALK_DIR:-$HOME/.signalk}"
SERVER_SCRIPT="$SIGNALK_DIR/signalk-server"
STARTUP_SCRIPT="$SIGNALK_DIR/startup-plugins.sh"

echo "Open Wind Plugin - Undo Setup"
echo "============================="
echo "Signal K directory: $SIGNALK_DIR"
echo ""

if [ ! -d "$SIGNALK_DIR" ]; then
    echo -e "${RED}Error: Signal K directory not found at $SIGNALK_DIR${NC}"
    echo "Set SIGNALK_DIR if your Signal K config is elsewhere."
    exit 1
fi

# Restore original signalk-server from backup if we have one
if [ -f "$SERVER_SCRIPT" ] && grep -q "startup-plugins.sh" "$SERVER_SCRIPT" 2>/dev/null; then
    LATEST_BACKUP=""
    for f in "$SIGNALK_DIR"/signalk-server.backup.*; do
        [ -f "$f" ] || continue
        if [ -z "$LATEST_BACKUP" ] || [ "$f" -nt "$LATEST_BACKUP" ]; then
            LATEST_BACKUP="$f"
        fi
    done
    if [ -n "$LATEST_BACKUP" ]; then
        cp "$LATEST_BACKUP" "$SERVER_SCRIPT"
        chmod +x "$SERVER_SCRIPT"
        echo -e "${GREEN}✓ Restored $SERVER_SCRIPT from $LATEST_BACKUP${NC}"
    else
        echo -e "${YELLOW}No signalk-server.backup.* found. Removing custom wrapper (Signal K may need to be started another way).${NC}"
        rm -f "$SERVER_SCRIPT"
        echo -e "${GREEN}✓ Removed custom $SERVER_SCRIPT${NC}"
    fi
else
    if [ -f "$SERVER_SCRIPT" ]; then
        echo -e "${GREEN}✓ $SERVER_SCRIPT is not the custom wrapper; leaving it unchanged.${NC}"
    else
        echo "  (no signalk-server file present)"
    fi
fi

# Remove or neuter startup-plugins.sh so it doesn't reinstall this plugin
if [ -f "$STARTUP_SCRIPT" ]; then
    if grep -q 'check_and_install "signalk-open-wind-plugin"' "$STARTUP_SCRIPT" 2>/dev/null; then
        # Check if this is the only check_and_install line (aside from boilerplate)
        if [ "$(grep -c 'check_and_install "' "$STARTUP_SCRIPT" 2>/dev/null)" = "1" ]; then
            rm -f "$STARTUP_SCRIPT"
            echo -e "${GREEN}✓ Removed $STARTUP_SCRIPT${NC}"
        else
            # Other plugins use it; remove only the open-wind line
            sed -i.bak '/check_and_install "signalk-open-wind-plugin"/d' "$STARTUP_SCRIPT"
            rm -f "${STARTUP_SCRIPT}.bak"
            echo -e "${GREEN}✓ Removed signalk-open-wind-plugin from $STARTUP_SCRIPT${NC}"
        fi
    else
        echo -e "${GREEN}✓ $STARTUP_SCRIPT does not reference this plugin; leaving it unchanged.${NC}"
    fi
else
    echo "  (no startup-plugins.sh present)"
fi

echo ""
echo -e "${GREEN}Done.${NC} Uninstall the plugin from the Signal K app store (or run: cd $SIGNALK_DIR && npm uninstall signalk-open-wind-plugin), then restart Signal K."
