#!/bin/bash
#
# Ninja Scout
# Analyzes environment and infrastructure before deployment

set -eo pipefail

# Load environment variables
if [ -z "$1" ]; then
  echo "Error: Environment file not provided"
  exit 1
fi

source "$1"

# Initialize
ninja_log "Scout" "Starting environment analysis" "INFO"
ninja_log "Scout" "Target environment: $DEPLOY_ENV" "INFO"
ninja_log "Scout" "Deployment mode: $DEPLOY_MODE" "INFO"

# Create output directory for scout findings
SCOUT_DIR="build/ninja-scout/$DEPLOY_ENV"
mkdir -p "$SCOUT_DIR"

# Check if config file exists
CONFIG_FILE="deploy/manifests/$DEPLOY_ENV.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
  ninja_log "Scout" "Configuration not found for $DEPLOY_ENV, creating default" "WARN"
  mkdir -p "deploy/manifests"
  
  # Create a default config based on environment
  cat > "$CONFIG_FILE" << EOF
name: $DEPLOY_ENV
description: $DEPLOY_ENV environment for Documind
deployment:
  strategy: rolling
  replicas: $([ "$DEPLOY_ENV" = "production" ] && echo "3" || echo "1")
  recursive: 1
EOF
fi

# Parse environment configuration
CONFIG_CONTENT=$(cat "$CONFIG_FILE")
echo "$CONFIG_CONTENT" > "$SCOUT_DIR/environment-config.yaml"

# Detect deployment strategy
if command -v yq &>/dev/null; then
  DEPLOY_STRATEGY=$(yq eval '.deployment.strategy' "$CONFIG_FILE")
  REPLICAS=$(yq eval '.deployment.replicas' "$CONFIG_FILE")
else
  # Fallback if yq is not available
  DEPLOY_STRATEGY=$(grep 'strategy:' "$CONFIG_FILE" | awk '{print $2}')
  REPLICAS=$(grep 'replicas:' "$CONFIG_FILE" | awk '{print $2}')
fi

ninja_log "Scout" "Detected deployment strategy: $DEPLOY_STRATEGY" "INFO"
ninja_log "Scout" "Detected replicas: $REPLICAS" "INFO"

# Save findings for other ninjas
cat > "$SCOUT_DIR/findings.json" << EOF
{
  "environment": "$DEPLOY_ENV",
  "strategy": "$DEPLOY_STRATEGY",
  "replicas": $REPLICAS,
  "mode": "$DEPLOY_MODE",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

# Check infrastructure based on deployment mode
ninja_log "Scout" "Analyzing infrastructure..." "INFO"

case $DEPLOY_MODE in
  swarm)
    # Check Docker Swarm status
    if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
      ninja_log "Scout" "Docker Swarm is not active" "ERROR"
      exit 1
    fi
    
    # Get node count and store info
    NODE_COUNT=$(docker node ls --format "{{.Hostname}}" | wc -l)
    MANAGER_COUNT=$(docker node ls --format "{{.ManagerStatus}}" | grep -v ^$ | wc -l)
    
    ninja_log "Scout" "Swarm has $NODE_COUNT nodes ($MANAGER_COUNT managers)" "INFO"
    
    # Check existing services
    SERVICE_COUNT=$(docker service ls --filter name=documind -q | wc -l)
    if [ $SERVICE_COUNT -gt 0 ]; then
      ninja_log "Scout" "Found $SERVICE_COUNT existing Documind services" "INFO"
      docker service ls --filter name=documind | tail -n +2 > "$SCOUT_DIR/existing-services.txt"
    fi
    
    # Store swarm details
    docker node ls > "$SCOUT_DIR/swarm-nodes.txt"
    docker network ls > "$SCOUT_DIR/swarm-networks.txt"
    ;;
    
  compose)
    # Check Docker Compose
    if command -v docker-compose &>/dev/null; then
      COMPOSE_CMD="docker-compose"
      ninja_log "Scout" "Using docker-compose command" "INFO"
    elif docker compose version &>/dev/null; then
      COMPOSE_CMD="docker compose"
      ninja_log "Scout" "Using docker compose plugin" "INFO"
    else
      ninja_log "Scout" "Neither docker-compose nor docker compose plugin found" "ERROR"
      exit 1
    fi
    
    # Check for existing containers
    if $COMPOSE_CMD ps -q &>/dev/null; then
      CONTAINER_COUNT=$($COMPOSE_CMD ps -q | wc -l)
      ninja_log "Scout" "Found $CONTAINER_COUNT existing containers" "INFO"
      $COMPOSE_CMD ps > "$SCOUT_DIR/existing-containers.txt"
    fi
    ;;
    
  k8s)
    # Check Kubernetes connection
    if ! kubectl get nodes &>/dev/null; then
      ninja_log "Scout" "Cannot connect to Kubernetes cluster" "ERROR"
      exit 1
    fi
    
    # Get cluster info and store it
    NODE_COUNT=$(kubectl get nodes -o name | wc -l)
    ninja_log "Scout" "Kubernetes cluster has $NODE_COUNT nodes" "INFO"
    kubectl get nodes -o wide > "$SCOUT_DIR/k8s-nodes.txt"
    
    # Check for existing deployments
    DEPLOYMENT_COUNT=$(kubectl get deployments -n documind --no-headers 2>/dev/null | wc -l || echo 0)
    if [ $DEPLOYMENT_COUNT -gt 0 ]; then
      ninja_log "Scout" "Found $DEPLOYMENT_COUNT existing deployments" "INFO"
      kubectl get deployments -n documind -o wide > "$SCOUT_DIR/existing-deployments.txt"
    fi
    ;;
    
  *)
    ninja_log "Scout" "Unsupported deployment mode: $DEPLOY_MODE" "ERROR"
    exit 1
    ;;
esac

# Run pre-deployment system health check
ninja_log "Scout" "Running system health check..." "INFO"

# Check disk space
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
  ninja_log "Scout" "Warning: Disk usage is high ($DISK_USAGE%)" "WARN"
fi

# Check memory usage
if [ -f "/proc/meminfo" ]; then
  TOTAL_MEM=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  FREE_MEM=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
  MEM_USAGE=$(( 100 - (FREE_MEM * 100 / TOTAL_MEM) ))
  
  if [ "$MEM_USAGE" -gt 90 ]; then
    ninja_log "Scout" "Warning: Memory usage is high ($MEM_USAGE%)" "WARN"
  fi
fi

# Check available ports
if [ "$DEPLOY_MODE" = "compose" ]; then
  ninja_log "Scout" "Checking if required ports are available..." "INFO"
  # Check if port 3000 is in use
  if netstat -ln | grep -q ':3000\s'; then
    ninja_log "Scout" "Port 3000 is already in use" "WARN"
  fi
fi

# Analyze code readiness
ninja_log "Scout" "Analyzing code readiness..." "INFO"
if [ -f "scripts/code-crawler.js" ]; then
  node scripts/code-crawler.js --silent > "$SCOUT_DIR/code-analysis.json"
  
  # Extract critical issues from code analysis
  CRITICAL_ISSUES=$(cat "$SCOUT_DIR/code-analysis.json" | grep -c "critical" || echo 0)
  if [ "$CRITICAL_ISSUES" -gt 0 ]; then
    ninja_log "Scout" "Found $CRITICAL_ISSUES critical code issues" "WARN"
  else
    ninja_log "Scout" "No critical code issues found" "INFO"
  fi
else
  ninja_log "Scout" "Code crawler not found, skipping code analysis" "WARN"
fi

# Detect remote targets for recursive deployment
if [ -f "deploy/ninja-config/targets.json" ]; then
  TARGETS=$(cat "deploy/ninja-config/targets.json" | jq -r ".${DEPLOY_ENV}[]" 2>/dev/null || echo "")
  TARGET_COUNT=$(echo "$TARGETS" | grep -v "^$" | wc -l)
  
  if [ "$TARGET_COUNT" -gt 0 ]; then
    ninja_log "Scout" "Found $TARGET_COUNT recursive deployment targets" "INFO"
    echo "$TARGETS" > "$SCOUT_DIR/deployment-targets.txt"
  else
    ninja_log "Scout" "No recursive deployment targets defined" "INFO"
  fi
fi

# Success - environment is ready
ninja_log "Scout" "Environment analysis complete" "SUCCESS"

# Generate report
cat > "$SCOUT_DIR/report.md" << EOF
# Scout Report: $DEPLOY_ENV Environment

- **Environment:** $DEPLOY_ENV
- **Deployment Mode:** $DEPLOY_MODE
- **Strategy:** $DEPLOY_STRATEGY
- **Replicas:** $REPLICAS

## Infrastructure Status

- Deployment Mode: $DEPLOY_MODE
$(case $DEPLOY_MODE in
  swarm) echo "- Swarm Nodes: $NODE_COUNT ($MANAGER_COUNT managers)" ;;
  compose) echo "- Existing Containers: $CONTAINER_COUNT" ;;
  k8s) echo "- Kubernetes Nodes: $NODE_COUNT" ;;
esac)

## System Health

- Disk Usage: $DISK_USAGE%
- Memory Usage: $MEM_USAGE%

## Code Readiness

- Critical Issues: $CRITICAL_ISSUES

EOF

# Alert if any warnings were detected
if grep -q "Warning" "$DEPLOY_LOG"; then
  ninja_log "Scout" "Environment analysis completed with warnings" "WARN"
else
  ninja_log "Scout" "Environment is ready for deployment" "SUCCESS"
fi

exit 0
