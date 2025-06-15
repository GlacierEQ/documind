#!/bin/bash
#
# Ninja Team deployment workflow script
# Provides a simple interface to deploy using the ninja team system

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default settings
ENV="production"
TAG="latest"
MODE="auto" # auto, swarm, compose, k8s
RECURSIVE=2
PARALLEL=2
CONFIRM=false
SECURITY_SCAN=true

# Banner function
print_banner() {
  echo -e "${BLUE}${BOLD}"
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║             NINJA TEAM DEPLOYMENT WORKFLOW                     ║"
  echo "║   Complete Deployment Pipeline with Enhanced Security          ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo "Documind - High Performance Deployment System"
  echo
}

# Parse arguments
parse_arguments() {
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
      --mode=*)
        MODE="${1#*=}"
        shift
        ;;
      --recursive=*)
        RECURSIVE="${1#*=}"
        shift
        ;;
      --parallel=*)
        PARALLEL="${1#*=}"
        shift
        ;;
      --yes)
        CONFIRM=true
        shift
        ;;
      --no-security)
        SECURITY_SCAN=false
        shift
        ;;
      --help)
        show_help
        exit 0
        ;;
      *)
        echo -e "${RED}Unknown option: $1${NC}"
        show_help
        exit 1
        ;;
    esac
  done
}

# Show help message
show_help() {
  echo "Usage: $0 [OPTIONS]"
  echo
  echo "Options:"
  echo "  --env=ENV          Target environment (production, staging, development)"
  echo "                     Default: production"
  echo "  --tag=TAG          Docker image tag to deploy"
  echo "                     Default: latest"
  echo "  --mode=MODE        Deployment mode (auto, swarm, compose, k8s)"
  echo "                     Default: auto (detects best mode)"
  echo "  --recursive=N      Recursive deployment depth"
  echo "                     Default: 2"
  echo "  --parallel=N       Number of parallel operations"
  echo "                     Default: 2"
  echo "  --yes              Skip confirmation prompts"
  echo "  --no-security      Skip security scans"
  echo "  --help             Show this help message"
  echo
  echo "Example:"
  echo "  $0 --env=staging --tag=v1.2.3 --mode=compose"
}

# Detect best deployment mode
detect_deployment_mode() {
  if [ "$MODE" = "auto" ]; then
    echo -e "${YELLOW}Auto-detecting deployment mode...${NC}"
    
    # Try to detect Docker Swarm
    if docker info 2>/dev/null | grep -q "Swarm: active"; then
      echo -e "Detected ${GREEN}Docker Swarm${NC} mode"
      MODE="swarm"
    # Try to detect Kubernetes
    elif command -v kubectl &>/dev/null && kubectl get nodes &>/dev/null; then
      echo -e "Detected ${GREEN}Kubernetes${NC} mode"
      MODE="k8s"
    # Fallback to Docker Compose
    elif command -v docker-compose &>/dev/null || docker compose version &>/dev/null; then
      echo -e "Detected ${GREEN}Docker Compose${NC} mode"
      MODE="compose"
    else
      echo -e "${RED}Could not detect a valid deployment mode. Please specify one manually.${NC}"
      exit 1
    fi
  fi
}

# Confirm deployment
confirm_deployment() {
  if [ "$CONFIRM" = false ]; then
    echo -e "${YELLOW}You are about to deploy to ${BOLD}${ENV}${NC}${YELLOW} environment with tag ${BOLD}${TAG}${NC}"
    echo -e "${YELLOW}Deployment mode: ${MODE}, Recursive: ${RECURSIVE}, Parallel: ${PARALLEL}${NC}"
    echo
    echo -e "${YELLOW}Are you sure you want to continue? (y/n)${NC}"
    read -r response
    
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
      echo -e "${RED}Deployment cancelled.${NC}"
      exit 0
    fi
  fi
}

# Run security scan before deployment
run_security_scan() {
  if [ "$SECURITY_SCAN" = true ]; then
    echo -e "${YELLOW}Running pre-deployment security scan...${NC}"
    
    SCAN_SCRIPT="scripts/ninja-scan.sh"
    if [ ! -f "$SCAN_SCRIPT" ]; then
      echo -e "${RED}Security scan script not found. Skipping.${NC}"
      return
    fi
    
    # Execute security scan
    bash "$SCAN_SCRIPT" --env="$ENV" --quick
    SCAN_STATUS=$?
    
    # Check scan results
    if [ $SCAN_STATUS -eq 2 ]; then
      echo -e "${RED}${BOLD}Critical security issues detected!${NC}"
      
      if [ "$CONFIRM" = false ]; then
        echo -e "${YELLOW}Do you want to continue deployment despite security issues? (y/n)${NC}"
        read -r response
        
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
          echo -e "${RED}Deployment cancelled due to security concerns.${NC}"
          exit 1
        fi
      fi
    elif [ $SCAN_STATUS -eq 1 ]; then
      echo -e "${YELLOW}${BOLD}Security issues detected but none are critical.${NC}"
      echo -e "${YELLOW}Deployment will proceed, but please review the security report.${NC}"
    else
      echo -e "${GREEN}Security scan passed!${NC}"
    fi
  else
    echo -e "${YELLOW}Security scan skipped.${NC}"
  fi
}

# Start monitoring in background
start_background_monitoring() {
  echo -e "${YELLOW}Starting background monitoring...${NC}"
  
  MONITOR_SCRIPT="scripts/monitor-deployment.sh"
  if [ -f "$MONITOR_SCRIPT" ]; then
    bash "$MONITOR_SCRIPT" --env="$ENV" --tag="$TAG" --background &
    MONITOR_PID=$!
    echo -e "${GREEN}Monitoring started (PID: $MONITOR_PID)${NC}"
  else
    echo -e "${YELLOW}Monitoring script not found, skipping background monitoring.${NC}"
  fi
}

# Run the deployment with ninja-team-orchestrator
run_deployment() {
  echo -e "${YELLOW}Executing Ninja Team deployment...${NC}"
  
  ORCHESTRATOR_SCRIPT="scripts/ninja-team-orchestrator.sh"
  if [ ! -f "$ORCHESTRATOR_SCRIPT" ]; then
    echo -e "${RED}Ninja Team Orchestrator script not found!${NC}"
    exit 1
  }
  
  # Execute the orchestrator with all the parameters
  bash "$ORCHESTRATOR_SCRIPT" \
    --env="$ENV" \
    --tag="$TAG" \
    --mode="$MODE"
    
  DEPLOY_STATUS=$?
  
  if [ $DEPLOY_STATUS -eq 0 ]; then
    echo -e "${GREEN}${BOLD}Deployment completed successfully!${NC}"
    return 0
  else
    echo -e "${RED}${BOLD}Deployment failed with status $DEPLOY_STATUS${NC}"
    return $DEPLOY_STATUS
  fi
}

# Run post-deployment verification
verify_deployment() {
  echo -e "${YELLOW}Running deployment verification...${NC}"
  
  VERIFY_SCRIPT="scripts/verify-deployment.sh"
  if [ -f "$VERIFY_SCRIPT" ]; then
    bash "$VERIFY_SCRIPT" "$ENV" "$TAG"
    VERIFY_STATUS=$?
    
    if [ $VERIFY_STATUS -eq 0 ]; then
      echo -e "${GREEN}${BOLD}Deployment verification successful!${NC}"
    else
      echo -e "${RED}${BOLD}Deployment verification failed!${NC}"
      # Even if verification fails, we continue with cleanup
    fi
    
    return $VERIFY_STATUS
  else
    echo -e "${YELLOW}Verification script not found, skipping verification.${NC}"
    return 0
  fi
}

# Main function
main() {
  print_banner
  parse_arguments "$@"
  detect_deployment_mode
  confirm_deployment
  run_security_scan
  start_background_monitoring
  run_deployment
  DEPLOYMENT_STATUS=$?
  verify_deployment
  VERIFY_STATUS=$?
  
  echo
  echo -e "${BLUE}${BOLD}Deployment Summary${NC}"
  echo -e "${BLUE}────────────────────${NC}"
  echo -e "Environment: ${CYAN}$ENV${NC}"
  echo -e "Tag:         ${CYAN}$TAG${NC}"
  echo -e "Mode:        ${CYAN}$MODE${NC}"
  
  if [ $DEPLOYMENT_STATUS -eq 0 ] && [ $VERIFY_STATUS -eq 0 ]; then
    echo -e "Status:      ${GREEN}✓ Success${NC}"
    echo -e "${GREEN}Ninja Team deployment completed successfully!${NC}"
    exit 0
  elif [ $DEPLOYMENT_STATUS -ne 0 ]; then
    echo -e "Status:      ${RED}✗ Failed (Deployment Error)${NC}"
    echo -e "${RED}Deployment encountered errors. Check logs for details.${NC}"
    exit $DEPLOYMENT_STATUS
  else
    echo -e "Status:      ${YELLOW}! Warning (Verification Issues)${NC}"
    echo -e "${YELLOW}Deployment succeeded but verification had issues.${NC}"
    exit $VERIFY_STATUS
  fi
}

# Execute the main function
main "$@"
