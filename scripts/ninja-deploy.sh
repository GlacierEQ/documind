#!/bin/bash
#
# Ninja Team Deployment Script
# High-performance deployment system with recursive capabilities
# Organizes deployment as a specialized ninja team operation

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default settings
ENV="staging"
TAG="latest"
RECURSIVE_DEPTH=2
PARALLEL_JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
DEPLOY_MODE="swarm"
CONFIG_DIR="deploy/manifests"
NINJA_TEAM_SIZE=5
DEPLOYMENT_ID="ninja-$(date +%Y%m%d%H%M%S)"
LOGS_DIR="logs/ninja-deployment"

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
    --recursive=*)
      RECURSIVE_DEPTH="${1#*=}"
      shift
      ;;
    --parallel=*)
      PARALLEL_JOBS="${1#*=}"
      shift
      ;;
    --mode=*)
      DEPLOY_MODE="${1#*=}"
      shift
      ;;
    --silent)
      SILENT=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Usage: $0 --env=[environment] --tag=[version] --recursive=[depth] --parallel=[jobs]"
      exit 1
      ;;
  esac
done

# Ninja team roles
NINJA_ROLES=("Scout" "Builder" "Deployer" "Monitor" "Guardian")

# Create logs directory
mkdir -p "${LOGS_DIR}/${ENV}"
LOG_FILE="${LOGS_DIR}/${ENV}/${DEPLOYMENT_ID}.log"

# Log function
log() {
  local role=$1
  local message=$2
  local level=${3:-"INFO"}
  local color=$BLUE
  
  case $role in
    "Scout") color=$CYAN ;;
    "Builder") color=$YELLOW ;;
    "Deployer") color=$GREEN ;;
    "Monitor") color=$MAGENTA ;;
    "Guardian") color=$RED ;;
  esac
  
  echo -e "${color}[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] [${role}]${NC} ${message}" | tee -a "$LOG_FILE"
}

print_banner() {
  echo -e "${BLUE}${BOLD}"
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║             NINJA TEAM DEPLOYMENT SYSTEM                       ║"
  echo "║      High-Performance, Recursive Deployment Framework          ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo -e "${YELLOW}Deployment ID:${NC} ${DEPLOYMENT_ID}"
  echo -e "${YELLOW}Environment:${NC} ${ENV}"
  echo -e "${YELLOW}Tag:${NC} ${TAG}"
  echo -e "${YELLOW}Recursive Depth:${NC} ${RECURSIVE_DEPTH}"
  echo -e "${YELLOW}Parallel Jobs:${NC} ${PARALLEL_JOBS}"
  echo -e "${YELLOW}Ninja Team Size:${NC} ${NINJA_TEAM_SIZE}"
  echo -e "${YELLOW}Log File:${NC} ${LOG_FILE}"
  echo ""
}

# Scout: Analyze environment and detect infrastructure
scout_analyze_environment() {
  log "Scout" "Analyzing ${ENV} environment..."
  
  # Check if config file exists
  CONFIG_FILE="${CONFIG_DIR}/${ENV}.yaml"
  if [ ! -f "$CONFIG_FILE" ]; then
    log "Scout" "Configuration not found for ${ENV}, creating default" "WARN"
    mkdir -p "$CONFIG_DIR"
    
    # Create a default config based on environment
    cat > "$CONFIG_FILE" << EOF
name: ${ENV}
description: ${ENV} environment for Documind
deployment:
  strategy: rolling
  replicas: $([ "$ENV" = "production" ] && echo "3" || echo "1")
  recursive: ${RECURSIVE_DEPTH}
EOF
  fi
  
  # Parse environment configuration
  if command -v yq &>/dev/null; then
    DEPLOY_STRATEGY=$(yq eval '.deployment.strategy' "$CONFIG_FILE")
    REPLICAS=$(yq eval '.deployment.replicas' "$CONFIG_FILE")
  else
    # Fallback if yq is not available
    DEPLOY_STRATEGY=$(grep 'strategy:' "$CONFIG_FILE" | awk '{print $2}')
    REPLICAS=$(grep 'replicas:' "$CONFIG_FILE" | awk '{print $2}')
  fi
  
  log "Scout" "Detected deployment strategy: ${DEPLOY_STRATEGY}"
  log "Scout" "Detected replicas: ${REPLICAS}"
  
  # Detect remote targets for recursive deployment
  if [ "$RECURSIVE_DEPTH" -gt 0 ]; then
    log "Scout" "Scanning for recursive deployment targets (depth: ${RECURSIVE_DEPTH})..."
    
    # Read targets from config or use defaults
    if [ -f "${CONFIG_DIR}/recursive.yaml" ]; then
      # Read remote targets from config
      TARGETS=($(grep "${ENV}:" -A 10 "${CONFIG_DIR}/recursive.yaml" | grep -v "${ENV}:" | grep -v "^\s*$" | sed 's/^\s*-\s*//'))
      log "Scout" "Found ${#TARGETS[@]} recursive targets for ${ENV}"
    else
      # No targets specified, using environment name for single deployment
      TARGETS=("${ENV}")
      log "Scout" "No recursive targets defined, using single target" "WARN"
    fi
  fi
  
  log "Scout" "Environment analysis complete" "SUCCESS"
}

# Builder: Prepare and build artifacts
builder_prepare_artifacts() {
  log "Builder" "Preparing deployment artifacts for ${ENV}..."
  
  # Export required environment variables
  export DEPLOY_ENV="$ENV"
  export IMAGE_TAG="$TAG"
  export BUILD_ID="$DEPLOYMENT_ID"
  
  # Build Docker image if needed
  if [ -f "docker/Dockerfile" ]; then
    log "Builder" "Building Docker image documind:${TAG}..."
    docker build -t "documind:${TAG}" -f docker/Dockerfile \
      --build-arg BUILD_ID="$DEPLOYMENT_ID" \
      --build-arg NODE_ENV="$ENV" \
      --build-arg BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      . >> "$LOG_FILE" 2>&1
    
    # Tag for registry if specified
    if [ -n "$DOCKER_REGISTRY" ]; then
      log "Builder" "Tagging and pushing to registry ${DOCKER_REGISTRY}..."
      docker tag "documind:${TAG}" "${DOCKER_REGISTRY}/documind:${TAG}"
      docker push "${DOCKER_REGISTRY}/documind:${TAG}" >> "$LOG_FILE" 2>&1
    fi
  fi
  
  # Prepare compose files
  if [ -f "docker-compose.${ENV}.yml" ]; then
    log "Builder" "Using environment-specific compose file: docker-compose.${ENV}.yml"
    COMPOSE_FILE="docker-compose.${ENV}.yml"
  elif [ -f "docker-compose.yml" ]; then
    log "Builder" "Using default compose file: docker-compose.yml"
    COMPOSE_FILE="docker-compose.yml"
  else
    log "Builder" "No compose file found" "ERROR"
    exit 1
  fi
  
  log "Builder" "Artifacts preparation complete" "SUCCESS"
}

# Deployer: Execute the deployment
deployer_execute_deployment() {
  log "Deployer" "Executing deployment to ${ENV}..."
  
  # Create pre-deployment backup
  log "Deployer" "Creating pre-deployment backup..."
  bash scripts/backup.sh pre-deploy-${DEPLOYMENT_ID} >> "$LOG_FILE" 2>&1 || true
  
  # Deploy based on mode
  case $DEPLOY_MODE in
    swarm)
      log "Deployer" "Deploying with Docker Swarm"
      
      # Check if Swarm is initialized
      if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
        log "Deployer" "Docker Swarm not active, initializing..." "WARN"
        docker swarm init >> "$LOG_FILE" 2>&1 || true
      fi
      
      # Deploy stack
      log "Deployer" "Deploying stack documind-${ENV}..."
      docker stack deploy --with-registry-auth \
        -c docker-compose.yml \
        -c docker-compose.${ENV}.yml \
        documind-${ENV} >> "$LOG_FILE" 2>&1
      ;;
      
    compose)
      log "Deployer" "Deploying with Docker Compose"
      
      # Determine compose command
      if command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
      else
        COMPOSE_CMD="docker compose"
      fi
      
      # Pull images
      log "Deployer" "Pulling latest images..."
      $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${ENV}.yml pull >> "$LOG_FILE" 2>&1
      
      # Deploy with zero downtime if possible
      if [ "$DEPLOY_STRATEGY" == "blue-green" ]; then
        log "Deployer" "Using Blue-Green deployment strategy"
        bash scripts/production-orchestrator.sh --tag=${TAG} --config=${CONFIG_FILE} --mode=compose >> "$LOG_FILE" 2>&1
      else
        log "Deployer" "Using Rolling update strategy"
        $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${ENV}.yml up -d >> "$LOG_FILE" 2>&1
      fi
      ;;
      
    k8s)
      log "Deployer" "Deploying with Kubernetes"
      kubectl apply -k deploy/${ENV} >> "$LOG_FILE" 2>&1
      ;;
  esac
  
  log "Deployer" "Primary deployment complete" "SUCCESS"
  
  # Execute recursive deployments if enabled
  if [ "$RECURSIVE_DEPTH" -gt 0 ] && [ ${#TARGETS[@]} -gt 0 ]; then
    log "Deployer" "Starting recursive deployments (${#TARGETS[@]} targets)..."
    
    # Track deployment success
    local success_count=0
    
    # Deploy to each target in parallel if requested
    if [ "$PARALLEL_JOBS" -gt 1 ]; then
      log "Deployer" "Executing ${PARALLEL_JOBS} parallel deployments..."
      
      # Use xargs for parallel execution with a limit
      printf '%s\n' "${TARGETS[@]}" | xargs -I{} -P "${PARALLEL_JOBS}" \
        bash -c "ssh {} 'cd /opt/documind && scripts/ninja-deploy.sh --env=${ENV} --tag=${TAG} --recursive=$((RECURSIVE_DEPTH-1)) --silent' >> $LOG_FILE 2>&1 && echo -e '${GREEN}✓ Recursive deployment to {} successful${NC}' || echo -e '${RED}✗ Recursive deployment to {} failed${NC}'" \
        >> "$LOG_FILE" 2>&1
    else
      # Sequential deployments
      for target in "${TARGETS[@]}"; do
        log "Deployer" "Recursive deployment to ${target}..."
        if ssh "$target" "cd /opt/documind && scripts/ninja-deploy.sh --env=${ENV} --tag=${TAG} --recursive=$((RECURSIVE_DEPTH-1)) --silent" >> "$LOG_FILE" 2>&1; then
          log "Deployer" "Recursive deployment to ${target} successful" "SUCCESS"
          ((success_count++))
        else
          log "Deployer" "Recursive deployment to ${target} failed" "ERROR"
        fi
      done
    fi
    
    log "Deployer" "Recursive deployments completed (${success_count}/${#TARGETS[@]} successful)" "SUCCESS"
  fi
}

# Monitor: Track deployment progress and health
monitor_deployment() {
  log "Monitor" "Starting deployment monitoring..."
  
  # Wait for services to become available
  local retry=0
  local max_retries=30
  local healthy=false
  
  log "Monitor" "Waiting for services to become healthy..."
  while [ $retry -lt $max_retries ]; do
    # Different health check based on deployment mode
    case $DEPLOY_MODE in
      swarm)
        # Check service status
        local ready_services=$(docker service ls --filter name=documind-${ENV} | grep -c "[0-9]/[0-9]")
        local total_services=$(docker service ls --filter name=documind-${ENV} | wc -l)
        
        if [ "$ready_services" -eq "$total_services" ]; then
          healthy=true
          break
        fi
        ;;
        
      compose)
        # Check application health endpoint
        if curl -s http://localhost:3000/api/v1/health | grep -q '"status":"healthy"'; then
          healthy=true
          break
        fi
        ;;
        
      k8s)
        # Check kubernetes deployments
        if kubectl get deployments -n documind -o json | jq '.items[].status | .replicas == .readyReplicas' | grep -q true; then
          healthy=true
          break
        fi
        ;;
    esac
    
    log "Monitor" "Waiting for services... (${retry}/${max_retries})"
    ((retry++))
    sleep 10
  done
  
  if [ "$healthy" = true ]; then
    log "Monitor" "All services are healthy" "SUCCESS"
    
    # Collect performance metrics
    log "Monitor" "Collecting initial performance metrics..."
    case $DEPLOY_MODE in
      swarm|compose)
        # Get container stats
        docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep documind >> "$LOG_FILE"
        ;;
        
      k8s)
        # Get pod resource usage
        kubectl top pods -n documind >> "$LOG_FILE"
        ;;
    esac
    
    # Run functional tests if available
    if [ -f "scripts/functional-tests.sh" ]; then
      log "Monitor" "Running functional tests..."
      bash scripts/functional-tests.sh --env=$ENV >> "$LOG_FILE" 2>&1 || log "Monitor" "Functional tests failed" "WARN"
    fi
  else
    log "Monitor" "Services failed to become healthy within timeout" "ERROR"
    
    # Collect logs for debugging
    log "Monitor" "Collecting logs for troubleshooting..."
    case $DEPLOY_MODE in
      swarm)
        docker service logs --tail 100 documind-${ENV}_app >> "${LOG_FILE}.app.log" 2>&1
        ;;
        
      compose)
        if command -v docker-compose &>/dev/null; then
          docker-compose logs --tail 100 app >> "${LOG_FILE}.app.log" 2>&1
        else
          docker compose logs --tail 100 app >> "${LOG_FILE}.app.log" 2>&1
        fi
        ;;
        
      k8s)
        kubectl logs -n documind -l app=documind --tail=100 >> "${LOG_FILE}.app.log" 2>&1
        ;;
    esac
    
    # Consider rollback
    if [ "$ENV" = "production" ]; then
      log "Monitor" "Recommending rollback for production environment" "WARN"
      # Would trigger auto-rollback here if configured
    fi
  fi
}

# Guardian: Handle security, post-deployment tasks, and cleanup
guardian_post_deployment() {
  log "Guardian" "Running post-deployment tasks..."
  
  # Run security scan if available
  if [ -f "scripts/ninja-scan.sh" ]; then
    log "Guardian" "Running security scan..."
    bash scripts/ninja-scan.sh --env=$ENV --quick >> "$LOG_FILE" 2>&1 || log "Guardian" "Security issues detected" "WARN"
  fi
  
  # Run database migrations if needed
  log "Guardian" "Running database migrations..."
  case $DEPLOY_MODE in
    swarm)
      docker service create --name documind-migrations-${DEPLOYMENT_ID} --replicas 1 \
        --restart-condition none --network documind-${ENV}_default \
        documind:${TAG} node /app/dist/migrations.js >> "$LOG_FILE" 2>&1 || true
      ;;
      
    compose)
      if command -v docker-compose &>/dev/null; then
        docker-compose exec -T app node /app/dist/migrations.js >> "$LOG_FILE" 2>&1 || true
      else
        docker compose exec -T app node /app/dist/migrations.js >> "$LOG_FILE" 2>&1 || true
      fi
      ;;
      
    k8s)
      kubectl create job --from=cronjob/documind-migrations migrations-${DEPLOYMENT_ID} -n documind >> "$LOG_FILE" 2>&1 || true
      ;;
  esac
  
  # Clean up old resources
  log "Guardian" "Cleaning up old resources..."
  docker system prune -f --filter "until=24h" >> "$LOG_FILE" 2>&1 || true
  
  # Send deployment notification
  if [ -n "$SLACK_WEBHOOK_URL" ]; then
    log "Guardian" "Sending deployment notification..."
    
    # Determine status emoji
    if [ "$healthy" = true ]; then
      STATUS_EMOJI="✅"
      STATUS="successful"
    else
      STATUS_EMOJI="⚠️"
      STATUS="completed with warnings"
    fi
    
    curl -s -X POST -H 'Content-type: application/json' --data "{
      \"text\": \"${STATUS_EMOJI} Documind deployment ${STATUS} to ${ENV}\",
      \"attachments\": [
        {
          \"color\": \"${healthy:+good}${healthy:-warning}\",
          \"fields\": [
            {\"title\": \"Environment\", \"value\": \"${ENV}\", \"short\": true},
            {\"title\": \"Version\", \"value\": \"${TAG}\", \"short\": true},
            {\"title\": \"Deployment ID\", \"value\": \"${DEPLOYMENT_ID}\", \"short\": true},
            {\"title\": \"Mode\", \"value\": \"${DEPLOY_MODE}\", \"short\": true}
          ]
        }
      ]
    }" "${SLACK_WEBHOOK_URL}" > /dev/null || true
  fi
  
  log "Guardian" "Post-deployment tasks complete" "SUCCESS"
}

# Main function to orchestrate the ninja team
main() {
  # Skip banner in silent mode
  if [ -z "$SILENT" ]; then
    print_banner
  fi
  
  # Execute each ninja role
  scout_analyze_environment
  builder_prepare_artifacts
  deployer_execute_deployment
  monitor_deployment
  guardian_post_deployment
  
  log "System" "Ninja team deployment completed" "SUCCESS"
  echo -e "\n${GREEN}${BOLD}Deployment completed! Check ${LOG_FILE} for details.${NC}"
}

# Execute main function
main
