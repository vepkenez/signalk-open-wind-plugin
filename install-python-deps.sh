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
if command -v pip3 &> /dev/null; then
    pip3 install numpy bleak
    echo -e "${GREEN}✓ Python dependencies installed with pip3${NC}"
elif command -v pip &> /dev/null; then
    pip install numpy bleak
    echo -e "${GREEN}✓ Python dependencies installed with pip${NC}"
else
    echo -e "${YELLOW}Warning: pip not found. Please install Python dependencies manually:${NC}"
    echo "  pip install numpy bleak"
    exit 1
fi

echo -e "${GREEN}✓ Python dependencies installation complete${NC}"
