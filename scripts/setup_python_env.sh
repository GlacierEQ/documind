#!/bin/bash

# Setup Python environment for Documind's local AI features
# This script creates a Python virtual environment and installs the required dependencies

# Set the base directory to the project root
BASE_DIR=$(dirname "$(dirname "$0")")
VENV_DIR="$BASE_DIR/python_env"
REQUIREMENTS_FILE="$BASE_DIR/src/ai/python/requirements.txt"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Setting up Python environment for Documind AI features...${NC}"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python 3 could not be found. Please install Python 3.8 or newer.${NC}"
    exit 1
fi

# Get Python version
PYTHON_VERSION=$(python3 --version)
echo -e "${GREEN}Using $PYTHON_VERSION${NC}"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Creating virtual environment in $VENV_DIR...${NC}"
    python3 -m venv "$VENV_DIR"
else
    echo -e "${GREEN}Virtual environment already exists in $VENV_DIR${NC}"
fi

# Activate virtual environment
echo -e "${YELLOW}Activating virtual environment...${NC}"
source "$VENV_DIR/bin/activate"

# Install/upgrade pip
echo -e "${YELLOW}Upgrading pip...${NC}"
pip install --upgrade pip

# Install requirements
echo -e "${YELLOW}Installing required packages...${NC}"
pip install -r "$REQUIREMENTS_FILE"

# Test importing torch and transformers
echo -e "${YELLOW}Testing installation...${NC}"
if python -c "import torch; import transformers; print('PyTorch version:', torch.__version__, '\nTransformers version:', transformers.__version__)"; then
    echo -e "${GREEN}Python environment setup successfully!${NC}"
else
    echo -e "${RED}Failed to import required packages. Check installation logs.${NC}"
    exit 1
fi

# Update .env file if it exists
ENV_FILE="$BASE_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}Updating .env file with Python path...${NC}"
    PYTHON_PATH="$VENV_DIR/bin/python"
    
    # Check if DOCUMIND_AI_PYTHON_PATH already exists in .env
    if grep -q "DOCUMIND_AI_PYTHON_PATH" "$ENV_FILE"; then
        # Update existing entry
        sed -i "s|DOCUMIND_AI_PYTHON_PATH=.*|DOCUMIND_AI_PYTHON_PATH=$PYTHON_PATH|" "$ENV_FILE"
    else
        # Add new entry
        echo "DOCUMIND_AI_PYTHON_PATH=$PYTHON_PATH" >> "$ENV_FILE"
    fi
    
    echo -e "${GREEN}Updated .env file with Python path: $PYTHON_PATH${NC}"
fi

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}Python environment setup complete!${NC}"
echo -e "${YELLOW}To use the local AI models:${NC}"
echo -e "1. Set ${YELLOW}DOCUMIND_AI_PROVIDER=local${NC} in your .env file"
echo -e "2. Set ${YELLOW}DOCUMIND_AI_LOCAL_MODEL_TYPE=deepseek${NC} in your .env file"
echo -e "3. Restart the Documind server"
echo -e "${GREEN}============================================${NC}"

# Deactivate virtual environment
deactivate
