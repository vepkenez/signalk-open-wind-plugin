#!/bin/bash

# Signal K Open Wind Plugin - Python Dependencies Installer
# This script installs only the Python dependencies required by the plugin

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Installing Python dependencies for Signal K Open Wind Plugin...${NC}"

# Install Python dependencies
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

# Try different installation methods
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
                exit 1
            fi
        else
            echo -e "${YELLOW}Warning: pip not found. Please install Python dependencies manually:${NC}"
            echo "  pip3 install numpy bleak"
            exit 1
        fi
    fi
elif command -v pip &> /dev/null; then
    if install_python_deps "pip"; then
        echo -e "${GREEN}✓ Python dependencies installation complete${NC}"
    else
        echo -e "${YELLOW}Warning: Failed to install with pip. Please install manually:${NC}"
        echo "  pip install numpy bleak"
        exit 1
    fi
else
    echo -e "${YELLOW}Warning: pip not found. Please install Python dependencies manually:${NC}"
    echo "  pip3 install numpy bleak"
    exit 1
fi

echo -e "${GREEN}✓ Python dependencies installation complete${NC}"
