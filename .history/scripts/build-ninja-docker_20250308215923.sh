#!/bin/bash
#
# Build Ninja Team Docker Image
# Compiles and packages the Ninja Team deployment system into a Docker image

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}${BOLD}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║        NINJA TEAM DOCKER IMAGE BUILDER                         ║"
echo "║      Package Deployment System as Docker Container             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Default settings
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$REPO_ROOT/docker/ninja-team"
TAG="latest"
PUSH=false
REGISTRY=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag=*)
      TAG="${1#*=}"
      shift
      ;;
    --push)
      PUSH=true
      shift
      ;;
    --registry=*)
      REGISTRY="${1#*=}"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --tag=TAG        Set Docker image tag (default: latest)"
      echo "  --push           Push image to registry"
      echo "  --registry=URL   Registry URL (e.g., ghcr.io/username)"
      echo "  --help, -h       Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Check Docker is installed
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
  exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
  echo -e "${YELLOW}Warning: Docker Compose not found, continuing with Docker only${NC}"
  HAS_COMPOSE=false
else
  HAS_COMPOSE=true
  # Determine Docker Compose command
  if command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    COMPOSE_CMD="docker compose"
  fi
fi

# Step 1: Ensure all required files exist
echo -e "\n${CYAN}Step 1: Checking for required files${NC}"

if [ ! -d "$DOCKER_DIR" ]; then
  echo -e "${YELLOW}Creating Docker directory...${NC}"
  mkdir -p "$DOCKER_DIR"
fi

if [ ! -f "$DOCKER_DIR/Dockerfile" ]; then
  echo -e "${RED}Error: Dockerfile not found at $DOCKER_DIR/Dockerfile${NC}"
  echo -e "${YELLOW}Run scripts/compile-ninja-team.sh first to prepare the required files${NC}"
  exit 1
fi

# Step 2: Build Docker image
echo -e "\n${CYAN}Step 2: Building Ninja Team Docker image${NC}"

echo -e "${YELLOW}Building ninja-team:$TAG...${NC}"
docker build -t "ninja-team:$TAG" -f "$DOCKER_DIR/Dockerfile" "$REPO_ROOT"

# Tag with registry if specified
if [ -n "$REGISTRY" ]; then
  REGISTRY_TAG="$REGISTRY/ninja-team:$TAG"
  echo -e "${YELLOW}Tagging image as $REGISTRY_TAG${NC}"
  docker tag "ninja-team:$TAG" "$REGISTRY_TAG"
fi

echo -e "${GREEN}Docker image built successfully: ninja-team:$TAG${NC}"

# Step 3: Push image if requested
if [ "$PUSH" = true ]; then
  echo -e "\n${CYAN}Step 3: Pushing Docker image to registry${NC}"
  
  if [ -z "$REGISTRY" ]; then
    echo -e "${RED}Error: No registry specified. Use --registry=URL to specify a registry.${NC}"
    exit 1
  fi
  
  echo -e "${YELLOW}Pushing $REGISTRY_TAG to registry...${NC}"
  docker push "$REGISTRY_TAG"
  echo -e "${GREEN}Image pushed successfully!${NC}"
fi

# Step 4: Build Docker Compose if available
if [ "$HAS_COMPOSE" = true ] && [ -f "$DOCKER_DIR/docker-compose.yml" ]; then
  echo -e "\n${CYAN}Step 4: Building with Docker Compose${NC}"
  
  cd "$DOCKER_DIR"
  $COMPOSE_CMD build
  
  echo -e "${GREEN}Docker Compose build completed!${NC}"
  
  # Show instructions for running with compose
  echo -e "\n${YELLOW}To run with Docker Compose:${NC}"
  echo -e "cd $DOCKER_DIR"
  echo -e "$COMPOSE_CMD up -d"
fi

# Print usage instructions
echo -e "\n${GREEN}${BOLD}Ninja Team Docker image built successfully!${NC}"
echo -e "\n${CYAN}Usage Examples:${NC}"
echo -e "${YELLOW}# Deploy to production:${NC}"
echo -e "docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ninja-team:$TAG deploy production latest"
echo
echo -e "${YELLOW}# Run security scan:${NC}"
echo -e "docker run --rm ninja-team:$TAG scan production"
echo
echo -e "${YELLOW}# Start interactive shell:${NC}"
echo -e "docker run --rm -it ninja-team:$TAG shell"

exit 0
