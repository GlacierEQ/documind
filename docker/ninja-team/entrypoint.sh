#!/bin/bash
#
# Docker entrypoint for Ninja Team deployment system
# Provides a consistent interface for running the system inside a container

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
echo "║             NINJA TEAM DEPLOYMENT CONTAINER                    ║"
echo "║      Containerized High-Performance Deployment System          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Default environment variables
ENV=${NINJA_ENV:-production}
TAG=${NINJA_TAG:-latest}
MODE=${NINJA_MODE:-auto}

# Parse command-line arguments which override environment variables
case "$1" in
    deploy)
        # Deploy command
        if [ -n "$2" ]; then ENV="$2"; fi
        if [ -n "$3" ]; then TAG="$3"; fi
        if [ -n "$4" ]; then MODE="$4"; fi
        echo -e "${CYAN}Deploying to ${BOLD}$ENV${NC}${CYAN} environment with tag ${BOLD}$TAG${NC}${CYAN}...${NC}"
        exec /app/scripts/deploy-ninja-team.sh --env="$ENV" --tag="$TAG" --mode="$MODE" --yes
        ;;

    monitor)
        # Monitor command
        if [ -n "$2" ]; then ENV="$2"; fi
        DURATION=${3:-600}
        echo -e "${CYAN}Monitoring ${BOLD}$ENV${NC}${CYAN} deployment for $DURATION seconds...${NC}"
        exec /app/scripts/monitor-deployment.sh --env="$ENV" --duration="$DURATION"
        ;;

    scan)
        # Security scan command
        if [ -n "$2" ]; then ENV="$2"; fi
        echo -e "${CYAN}Running security scan on ${BOLD}$ENV${NC}${CYAN} environment...${NC}"
        exec /app/scripts/ninja-scan.sh --env="$ENV" --quick
        ;;

    setup)
        # Setup command
        if [ -n "$2" ]; then ENV="$2"; fi
        echo -e "${CYAN}Setting up Ninja Team for ${BOLD}$ENV${NC}${CYAN} environment...${NC}"
        exec /app/scripts/setup-ninja-team.sh --env="$ENV" --force
        ;;

    compile)
        # Compile command
        echo -e "${CYAN}Compiling Ninja Team deployment package...${NC}"
        exec /app/scripts/compile-ninja-team.sh --force
        ;;

    shell)
        # Interactive shell
        echo -e "${CYAN}Starting interactive shell...${NC}"
        exec /bin/bash
        ;;

    --help|-h|help)
        # Help message
        echo "Ninja Team Deployment Container"
        echo
        echo "Usage: docker run [OPTIONS] ninja-team COMMAND [ARGS...]"
        echo
        echo "Commands:"
        echo "  deploy ENV TAG [MODE]   Deploy to specified environment"
        echo "  monitor ENV [DURATION]  Monitor deployment in environment"
        echo "  scan ENV               Run security scan on environment"
        echo "  setup ENV              Set up Ninja Team for environment"
        echo "  compile                Create deployment package"
        echo "  shell                  Start interactive shell"
        echo "  help                   Show this help message"
        echo
        echo "Environment Variables:"
        echo "  NINJA_ENV              Default environment (default: production)"
        echo "  NINJA_TAG              Default tag (default: latest)"
        echo "  NINJA_MODE             Default deployment mode (default: auto)"
        echo
        echo "Examples:"
        echo "  docker run ninja-team deploy production v1.2.3 swarm"
        echo "  docker run -e NINJA_ENV=staging ninja-team monitor"
        exit 0
        ;;

    *)
        if [ -z "$1" ]; then
            # No arguments, show help
            $0 --help
        else
            # Assume it's a custom command to run
            echo -e "${YELLOW}Running custom command: $@${NC}"
            exec "$@"
        fi
        ;;
esac
