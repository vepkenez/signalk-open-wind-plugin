#!/bin/bash

# Signal K Open Wind Plugin Installation Script
# This script installs the plugin and sets up automatic reinstallation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default Signal K directory
SIGNALK_DIR="${SIGNALK_DIR:-$HOME/.signalk}"
PLUGIN_NAME="open-wind"
PLUGIN_SOURCE="$(pwd)"

echo -e "${GREEN}Signal K Open Wind Plugin Installer${NC}"
echo "========================================"

# Check if Signal K directory exists
if [ ! -d "$SIGNALK_DIR" ]; then
    echo -e "${RED}Error: Signal K directory not found at $SIGNALK_DIR${NC}"
    echo "Please install Signal K server first or set SIGNALK_DIR environment variable"
    exit 1
fi

# Check if we're in the plugin directory
if [ ! -f "plugin/index.js" ]; then
    echo -e "${RED}Error: Please run this script from the plugin root directory${NC}"
    exit 1
fi

echo -e "${YELLOW}Installing plugin to Signal K server...${NC}"

# Check if we're already installed via Signal K app store
if [ -f "$SIGNALK_DIR/node_modules/signalk-open-wind-plugin/package.json" ]; then
    echo -e "${GREEN}✓ Plugin already installed via Signal K app store${NC}"
else
    # Install the plugin manually
    cd "$SIGNALK_DIR"
    npm install "$PLUGIN_SOURCE"
    echo -e "${GREEN}✓ Plugin installed successfully${NC}"
fi

# Install Python dependencies
echo -e "${YELLOW}Installing Python dependencies...${NC}"

install_python_deps() {
    local pip_cmd="$1"
    echo "Attempting to install with $pip_cmd..."
    
    # Try normal installation first
    if $pip_cmd install numpy bleak; then
        echo -e "${GREEN}✓ Python dependencies installed with $pip_cmd${NC}"
        return 0
    fi
    
    # If that fails, try with --break-system-packages (for externally managed environments)
    echo "Normal installation failed, trying with --break-system-packages..."
    if $pip_cmd install --break-system-packages numpy bleak; then
        echo -e "${GREEN}✓ Python dependencies installed with $pip_cmd (using --break-system-packages)${NC}"
        return 0
    fi
    
    # If that fails, try with --user flag
    echo "System installation failed, trying with --user flag..."
    if $pip_cmd install --user numpy bleak; then
        echo -e "${GREEN}✓ Python dependencies installed with $pip_cmd (user installation)${NC}"
        return 0
    fi
    
    return 1
}

if command -v pip3 &> /dev/null; then
    if install_python_deps "pip3"; then
        echo -e "${GREEN}✓ Python dependencies installation complete${NC}"
    else
        echo -e "${YELLOW}Warning: Failed to install with pip3. Trying pip...${NC}"
        if command -v pip &> /dev/null; then
            if install_python_deps "pip"; then
                echo -e "${GREEN}✓ Python dependencies installation complete${NC}"
            else
                echo -e "${YELLOW}Warning: All pip installation methods failed.${NC}"
                echo -e "${YELLOW}Please install Python dependencies manually:${NC}"
                echo "  pip3 install numpy bleak"
                echo "  # or if that fails:"
                echo "  pip3 install --break-system-packages numpy bleak"
                echo "  # or for user installation:"
                echo "  pip3 install --user numpy bleak"
            fi
        else
            echo -e "${YELLOW}Warning: pip not found. Please install Python dependencies manually:${NC}"
            echo "  pip3 install numpy bleak"
        fi
    fi
elif command -v pip &> /dev/null; then
    if install_python_deps "pip"; then
        echo -e "${GREEN}✓ Python dependencies installation complete${NC}"
    else
        echo -e "${YELLOW}Warning: Failed to install with pip. Please install manually:${NC}"
        echo "  pip install numpy bleak"
    fi
else
    echo -e "${YELLOW}Warning: pip not found. Please install Python dependencies manually:${NC}"
    echo "  pip3 install numpy bleak"
fi

# Create startup script if it doesn't exist
STARTUP_SCRIPT="$SIGNALK_DIR/startup-plugins.sh"
if [ ! -f "$STARTUP_SCRIPT" ]; then
    echo -e "${YELLOW}Creating automatic plugin installation script...${NC}"
    
    cat > "$STARTUP_SCRIPT" << 'EOF'
#!/bin/bash

# Signal K Plugin Auto-Installation Script
# This script ensures custom plugins are properly linked after server updates

SIGNALK_DIR="/home/damon/.signalk"
PLUGIN_SOURCE="/home/damon/windplug"

# Function to check if plugin is installed
check_plugin() {
    local plugin_name="$1"
    
    if [ -f "$SIGNALK_DIR/node_modules/$plugin_name/package.json" ]; then
        echo "Plugin $plugin_name is installed"
        return 0
    else
        echo "Plugin $plugin_name not found"
        return 1
    fi
}

# Function to install plugin if not already present
install_plugin() {
    local plugin_name="$1"
    local plugin_path="$2"
    
    if ! check_plugin "$plugin_name"; then
        echo "Installing plugin: $plugin_name"
        cd "$SIGNALK_DIR"
        npm install "$plugin_path"
        echo "Plugin $plugin_name installed successfully"
    else
        echo "Plugin $plugin_name already installed"
    fi
}

# Check and install custom plugins
if [ -d "$PLUGIN_SOURCE" ]; then
    install_plugin "signalk-open-wind-plugin" "$PLUGIN_SOURCE"
else
    echo "Plugin source not found at $PLUGIN_SOURCE"
    echo "Plugin may be installed via Signal K app store"
fi

echo "Plugin installation check complete"
EOF

    chmod +x "$STARTUP_SCRIPT"
    echo -e "${GREEN}✓ Startup script created${NC}"
fi

# Backup original signalk-server script
SERVER_SCRIPT="$SIGNALK_DIR/signalk-server"
if [ -f "$SERVER_SCRIPT" ] && ! grep -q "startup-plugins.sh" "$SERVER_SCRIPT"; then
    echo -e "${YELLOW}Backing up and modifying Signal K server startup script...${NC}"
    
    # Backup original
    cp "$SERVER_SCRIPT" "$SERVER_SCRIPT.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Create new startup script
    cat > "$SERVER_SCRIPT" << 'EOF'
#!/bin/sh

# Auto-install custom plugins before starting server
/home/damon/.signalk/startup-plugins.sh

# Start Signal K server
/usr/local/lib/node_modules/signalk-server/bin/signalk-server -c /home/damon/.signalk $*
EOF

    chmod +x "$SERVER_SCRIPT"
    echo -e "${GREEN}✓ Signal K server startup script modified${NC}"
fi

# Create systemd service file (optional)
SERVICE_FILE="$SIGNALK_DIR/signalk-with-plugins.service"
if [ ! -f "$SERVICE_FILE" ]; then
    echo -e "${YELLOW}Creating systemd service file...${NC}"
    
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Signal K Server with Auto-Plugin Installation
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$SIGNALK_DIR
ExecStartPre=$STARTUP_SCRIPT
ExecStart=/usr/local/lib/node_modules/signalk-server/bin/signalk-server -c $SIGNALK_DIR
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    echo -e "${GREEN}✓ Systemd service file created at $SERVICE_FILE${NC}"
    echo -e "${YELLOW}To use systemd service:${NC}"
    echo "  sudo cp $SERVICE_FILE /etc/systemd/system/"
    echo "  sudo systemctl enable signalk-with-plugins"
    echo "  sudo systemctl start signalk-with-plugins"
fi

echo ""
echo -e "${GREEN}Installation Complete!${NC}"
echo "========================"
echo ""
echo "Your Signal K Open Wind Plugin is now installed with automatic reinstallation."
echo ""
echo "Features:"
echo "• Plugin will be automatically reinstalled after Signal K server updates"
echo "• Robust startup script ensures plugin is always available"
echo "• Optional systemd service for production use"
echo ""
echo "To start Signal K server:"
echo "  $SIGNALK_DIR/signalk-server"
echo ""
echo "To check plugin status:"
echo "  curl http://localhost:3000/signalk/v1/api/vessels/self | grep open-wind"
echo ""
echo -e "${GREEN}Happy sailing! ⛵${NC}"
