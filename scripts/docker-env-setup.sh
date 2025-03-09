#!/bin/bash
#
# Docker Environment Setup for Ninja Team
# Configures Docker-specific settings for the Ninja Team deployment system

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}${BOLD}"
echo "╔═════════════════════════════════════════════════════════════════╗"
echo "║           DOCKER ENVIRONMENT SETUP FOR NINJA TEAM               ║"
echo "╚═════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Default settings
ENV="docker"
TAG="latest"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
NETWORK_NAME="documind-network"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --env=*)
      ENV="${1#*=}"
      shift
      ;;
    --tag=*)
      TAG="${1#*=}"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --env=ENV     Docker environment name (default: docker)"
      echo "  --tag=TAG     Docker image tag to use (default: latest)"
      echo "  --help, -h    Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Check if Docker is installed
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
  exit 1
fi

# Create Docker network if it doesn't exist
if ! docker network inspect "$NETWORK_NAME" &>/dev/null; then
  echo -e "${YELLOW}Creating Docker network '$NETWORK_NAME'...${NC}"
  docker network create "$NETWORK_NAME"
  echo -e "${GREEN}Network created successfully${NC}"
else
  echo -e "${YELLOW}Docker network '$NETWORK_NAME' already exists${NC}"
fi

# Create environment directory
ENV_DIR="$REPO_ROOT/deploy/environments/$ENV"
mkdir -p "$ENV_DIR"

# Create environment settings
echo -e "${YELLOW}Creating environment settings...${NC}"
cat > "$ENV_DIR/settings.json" << EOF
{
  "name": "$ENV",
  "description": "Docker environment for Ninja Team deployment",
  "type": "docker",
  "tag": "$TAG",
  "network": "$NETWORK_NAME",
  "services": [
    {
      "name": "app",
      "image": "documind:$TAG",
      "ports": ["3000:3000"],
      "environment": [
        "NODE_ENV=development",
        "PORT=3000"
      ],
      "volumes": [],
      "restart": "unless-stopped"
    }
  ]
}
EOF

# Create Docker Compose file
echo -e "${YELLOW}Creating Docker Compose file...${NC}"
cat > "$REPO_ROOT/docker-compose.$ENV.yml" << EOF
version: '3.8'

services:
  app:
    image: documind:$TAG
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - PORT=3000
    networks:
      - $NETWORK_NAME
    restart: unless-stopped

networks:
  $NETWORK_NAME:
    external: true
EOF

# Create environment manifest for Ninja Team
echo -e "${YELLOW}Creating environment manifest for Ninja Team...${NC}"
mkdir -p "$REPO_ROOT/deploy/manifests"
cat > "$REPO_ROOT/deploy/manifests/$ENV.yaml" << EOF
name: $ENV
description: Docker environment for Documind
infrastructure:
  domain: localhost
  network: $NETWORK_NAME
deployment:
  strategy: rolling
  replicas: 1
  recursive: 0
  update_config:
    parallelism: 1
    delay: 5s
    order: start-first
  rollback:
    automatic: true
    monitor_seconds: 30
  resources:
    cpu_limit: 1
    memory_limit: 512Mi
EOF

# Ensure Ninja Team is set up
echo -e "${YELLOW}Checking Ninja Team setup...${NC}"
if [ ! -f "$SCRIPT_DIR/setup-ninja-team.sh" ]; then
  echo -e "${RED}Error: Ninja Team setup script not found${NC}"
  exit 1
fi

# Run Ninja Team setup
echo -e "${YELLOW}Setting up Ninja Team for Docker environment...${NC}"
bash "$SCRIPT_DIR/setup-ninja-team.sh" --env="$ENV" --force

echo -e "${GREEN}${BOLD}Docker environment setup completed!${NC}"
echo -e "${YELLOW}You can now deploy to Docker using:${NC}"
echo -e "  ${GREEN}./scripts/deploy-ninja-team.sh --env=$ENV --tag=$TAG --mode=compose${NC}"
echo
echo -e "${YELLOW}To test the deployment:${NC}"
echo -e "  ${GREEN}./scripts/test-ninja-docker.sh --env=$ENV --tag=$TAG${NC}"

exit 0
