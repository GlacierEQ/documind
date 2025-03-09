#!/bin/bash
#
# Run Ninja Team Container
# Convenient script to run the Ninja Team Docker container with proper mounts

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default settings
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TAG="latest"
INTERACTIVE=false
ENV="production"
COMMAND="deploy"
COMMAND_ARGS=""

# Banner
echo -e "${BLUE}${BOLD}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║            NINJA TEAM CONTAINER RUNNER                         ║"
echo "║            Run Containerized Deployment System                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag=*)
      TAG="${1#*=}"
      shift
      ;;
    --interactive|-i)
      INTERACTIVE=true
      shift
      ;;
    --env=*)
      ENV="${1#*=}"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS] [COMMAND] [ARGS...]"
      echo "Options:"
      echo "  --tag=TAG        Docker image tag to use (default: latest)"
      echo "  --interactive, -i  Run in interactive mode"
      echo "  --env=ENV        Target environment (default: production)"
      echo "  --help, -h       Show this help message"
      echo
      echo "Commands:"
      echo "  deploy [TAG] [MODE]   Run deployment (default command)"
      echo "  monitor [DURATION]    Monitor deployment"
      echo "  scan                  Run security scan"
      echo "  setup                 Run setup"
      echo "  shell                 Start interactive shell"
      echo "  help                  Show container help"
      exit 0
      ;;
    deploy|monitor|scan|setup|shell|help)
      COMMAND=$1
      shift
      COMMAND_ARGS="$@"
      break
      ;;
    *)
      if [ -z "$COMMAND_ARGS" ]; then
        COMMAND_ARGS="$1"
      else
        COMMAND_ARGS="$COMMAND_ARGS $1"
      fi
      shift
      ;;
  esac
done

# Check Docker is installed
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
  exit 1
fi

# Determine Docker run options
DOCKER_OPTS="-v /var/run/docker.sock:/var/run/docker.sock"
DOCKER_OPTS="$DOCKER_OPTS -v $REPO_ROOT/deploy:/app/deploy:rw"
DOCKER_OPTS="$DOCKER_OPTS -v $REPO_ROOT/logs:/app/logs:rw"
DOCKER_OPTS="$DOCKER_OPTS -v $REPO_ROOT/backups:/app/backups:rw"
DOCKER_OPTS="$DOCKER_OPTS -e NINJA_ENV=$ENV"

# Add interactive flag if requested
if [ "$INTERACTIVE" = true ]; then
  DOCKER_OPTS="$DOCKER_OPTS -it"
else
  DOCKER_OPTS="$DOCKER_OPTS --rm"
fi

# Construct command
FULL_COMMAND="$COMMAND $COMMAND_ARGS"

echo -e "${YELLOW}Running Ninja Team container with command: ${CYAN}$FULL_COMMAND${NC}"

# Run docker
docker run $DOCKER_OPTS ninja-team:$TAG $FULL_COMMAND

exit $?
