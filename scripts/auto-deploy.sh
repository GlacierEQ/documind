#!/bin/bash
#
# Ninja Team Auto-Deployment
# Simplified script for automated deployments from CI/CD systems or local development

set -eo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Parse arguments
ENV="production"
TAG="latest"
MODE="auto"
SECURITY_SCAN=true
VERBOSE=false

print_usage() {
  echo -e "${BLUE}Ninja Team Auto-Deploy Utility${NC}"
  echo
  echo -e "Usage: $0 [options]"
  echo -e "Options:"
  echo -e "  -e, --env ENV       Set deployment environment (production, staging, development)"
  echo -e "                      Default: production"
  echo -e "  -t, --tag TAG       Set Docker image tag to deploy"
  echo -e "                      Default: latest"
  echo -e "  -m, --mode MODE     Set deployment mode (auto, swarm, compose, k8s)"
  echo -e "                      Default: auto (auto-detect)"
  echo -e "  -s, --skip-scan     Skip security scan"
  echo -e "  -v, --verbose       Enable verbose output"
  echo -e "  -h, --help          Show this help message"
  echo
  echo -e "Examples:"
  echo -e "  $0 --env staging --tag v1.2.3"
  echo -e "  $0 --env production --skip-scan"
  echo -e "  $0 --env development --mode compose"
}

# Parse command-line options
while [[ $# -gt 0 ]]; do
  case $1 in
    -e|--env)
      ENV="$2"
      shift 2
      ;;
    --env=*)
      ENV="${1#*=}"
      shift
      ;;
    -t|--tag)
      TAG="$2"
      shift 2
      ;;
    --tag=*)
      TAG="${1#*=}"
      shift
      ;;
    -m|--mode)
      MODE="$2"
      shift 2
      ;;
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    -s|--skip-scan)
      SECURITY_SCAN=false
      shift
      ;;
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      print_usage
      exit 1
      ;;
  esac
done

# Validate environment
case $ENV in
  production|staging|development)
    # Valid environment
    ;;
  *)
    echo -e "${RED}Invalid environment: $ENV${NC}"
    echo -e "Valid options: production, staging, development"
    exit 1
    ;;
esac

# Validate mode
case $MODE in
  auto|swarm|compose|k8s)
    # Valid mode
    ;;
  *)
    echo -e "${RED}Invalid deployment mode: $MODE${NC}"
    echo -e "Valid options: auto, swarm, compose, k8s"
    exit 1
    ;;
esac

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to repository root
cd "$REPO_ROOT"

# Banner
echo -e "${CYAN}${BOLD}"
echo "╔════════════════════════════════════════════════════════╗"
echo "║            NINJA TEAM AUTO-DEPLOYMENT                  ║"
echo "╚════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${YELLOW}Environment:${NC} ${ENV}"
echo -e "${YELLOW}Tag:${NC} ${TAG}"
echo -e "${YELLOW}Mode:${NC} ${MODE}"
echo -e "${YELLOW}Security Scan:${NC} ${SECURITY_SCAN}"
echo

# Check if scripts exist
if [[ ! -f "$SCRIPT_DIR/ninja-team-orchestrator.sh" ]]; then
  echo -e "${RED}Error: Ninja Team orchestrator not found!${NC}"
  echo -e "Please run setup-ninja-team.sh first to initialize the system."
  exit 1
fi

# Ensure scripts are executable
chmod +x "$SCRIPT_DIR/ninja-team-orchestrator.sh"
chmod +x "$SCRIPT_DIR/deploy-ninja-team.sh"
chmod +x "$SCRIPT_DIR/ninja-scan.sh"
if [[ -d "$SCRIPT_DIR/ninja-team" ]]; then
  chmod +x "$SCRIPT_DIR/ninja-team/"*.sh
fi

# Run security scan if enabled
if [[ "$SECURITY_SCAN" == "true" ]]; then
  echo -e "${YELLOW}Running security scan...${NC}"
  if [[ "$VERBOSE" == "true" ]]; then
    "$SCRIPT_DIR/ninja-scan.sh" --env="$ENV" --quick
  else
    "$SCRIPT_DIR/ninja-scan.sh" --env="$ENV" --quick &>/dev/null || {
      echo -e "${YELLOW}⚠️ Security scan detected issues.${NC}"
    }
  fi
  echo -e "${GREEN}Security scan completed.${NC}"
fi

# Run deployment
echo -e "${YELLOW}Starting deployment process...${NC}"

# Set verbosity for deployment
if [[ "$VERBOSE" == "true" ]]; then
  "$SCRIPT_DIR/deploy-ninja-team.sh" --env="$ENV" --tag="$TAG" --mode="$MODE" --yes
else
  echo -e "${YELLOW}Deploying, please wait...${NC}"
  "$SCRIPT_DIR/deploy-ninja-team.sh" --env="$ENV" --tag="$TAG" --mode="$MODE" --yes
fi

echo -e "${GREEN}${BOLD}Deployment completed! 🚀${NC}"

# Show log file location
LOG_DIR="logs/ninja-deployment/$ENV"
if [[ -d "$LOG_DIR" ]]; then
  LATEST_LOG=$(find "$LOG_DIR" -name "ninja-*.log" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -f2- -d" ")
  if [[ -n "$LATEST_LOG" ]]; then
    echo -e "${CYAN}Deployment log: ${LATEST_LOG}${NC}"
  fi
fi

exit 0
