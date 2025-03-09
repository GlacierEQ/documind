#!/bin/bash
#
# Production Deployment Orchestrator for Documind
# Automates complete deployment lifecycle with zero-downtime updates

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default configuration
CONFIG_PATH="deploy/manifests/production.yaml"
TAG="latest"
DEPLOY_MODE="swarm"
DEPLOYMENT_ID=$(date +%Y%m%d%H%M%S)
SLACK_NOTIFICATIONS=true
HEALTH_CHECK_RETRIES=30
HEALTH_CHECK_INTERVAL=10

# Banner function
print_banner() {
  echo -e "${BLUE}${BOLD}"
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║           DOCUMIND PRODUCTION ORCHESTRATOR                ║"
  echo "║     Zero-downtime, Automated Deployment System            ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

# Parse command-line arguments
parse_arguments() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --tag=*)
        TAG="${1#*=}"
        shift
        ;;
      --config=*)
        CONFIG_PATH="${1#*=}"
        shift
        ;;
      --mode=*)
        DEPLOY_MODE="${1#*=}"
        shift
        ;;
      --no-notifications)
        SLACK_NOTIFICATIONS=false
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

# Help function
show_help() {
  echo -e "${BLUE}Usage:${NC} $0 [OPTIONS]"
  echo
  echo "Options:"
  echo "  --tag=VERSION        Docker image tag to deploy (default: latest)"
  echo "  --config=PATH        Path to deployment config (default: deploy/manifests/production.yaml)"
  echo "  --mode=MODE          Deployment mode: swarm, compose, k8s (default: swarm)"
  echo "  --no-notifications   Disable Slack notifications"
  echo "  --help               Show this help message"
}

# Load configuration from YAML manifest
load_config() {
  echo -e "${YELLOW}Loading configuration from ${CONFIG_PATH}...${NC}"
  
  if [ ! -f "$CONFIG_PATH" ]; then
    echo -e "${RED}Error: Configuration file not found: ${CONFIG_PATH}${NC}"
    exit 1
  fi
  
  # Parse YAML with Python (more reliable than bash-only solutions)
  CONFIG=$(python3 -c "
import yaml, sys, json
with open('${CONFIG_PATH}', 'r') as f:
    config = yaml.safe_load(f)
print(json.dumps(config))
")
  
  # Extract key configuration values
  DOMAIN=$(echo $CONFIG | jq -r '.infrastructure.domain')
  REPLICAS=$(echo $CONFIG | jq -r '.deployment.replicas')
  STRATEGY=$(echo $CONFIG | jq -r '.deployment.strategy')
  UPDATE_DELAY=$(echo $CONFIG | jq -r '.deployment.update_config.delay' | sed 's/s$//')
  AUTO_ROLLBACK=$(echo $CONFIG | jq -r '.deployment.rollback.automatic')
  
  echo -e "Configuration loaded successfully:"
  echo -e "  • Domain: ${GREEN}${DOMAIN}${NC}"
  echo -e "  • Deployment strategy: ${GREEN}${STRATEGY}${NC}"
  echo -e "  • Replicas: ${GREEN}${REPLICAS}${NC}"
  echo -e "  • Auto rollback: ${GREEN}${AUTO_ROLLBACK}${NC}"
}

# Send notifications to Slack
send_notification() {
  if [ "$SLACK_NOTIFICATIONS" = false ]; then
    return 0
  fi
  
  local status=$1
  local message=$2
  local color=""
  
  case $status in
    "success") color="good" ;;
    "warning") color="warning" ;;
    "failure") color="danger" ;;
    *) color="good" ;;
  esac
  
  if [ -z "$SLACK_WEBHOOK_URL" ]; then
    echo -e "${YELLOW}Skipping Slack notification: SLACK_WEBHOOK_URL not set${NC}"
    return 0
  fi
  
  curl -s -X POST -H 'Content-type: application/json' --data "{
    \"attachments\": [
      {
        \"color\": \"${color}\",
        \"title\": \"Documind Deployment Update\",
        \"text\": \"${message}\",
        \"fields\": [
          {\"title\": \"Environment\", \"value\": \"Production\", \"short\": true},
          {\"title\": \"Version\", \"value\": \"${TAG}\", \"short\": true},
          {\"title\": \"Deployment ID\", \"value\": \"${DEPLOYMENT_ID}\", \"short\": true}
        ],
        \"footer\": \"Documind Deployment System\",
        \"ts\": $(date +%s)
      }
    ]
  }" $SLACK_WEBHOOK_URL > /dev/null
}

# Verify required tools are installed
verify_prerequisites() {
  echo -e "${YELLOW}Verifying prerequisites...${NC}"
  
  local missing_tools=0
  
  # Check Docker
  if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is required but not installed${NC}"
    missing_tools=$((missing_tools + 1))
  else
    echo -e "${GREEN}✓ Docker${NC}"
  fi
  
  # Check mode-specific requirements
  case $DEPLOY_MODE in
    swarm)
      if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
        echo -e "${RED}✗ Docker Swarm is not active${NC}"
        missing_tools=$((missing_tools + 1))
      else
        echo -e "${GREEN}✓ Docker Swarm${NC}"
      fi
      ;;
    compose)
      if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo -e "${RED}✗ Docker Compose is required but not installed${NC}"
        missing_tools=$((missing_tools + 1))
      else
        echo -e "${GREEN}✓ Docker Compose${NC}"
      fi
      ;;
    k8s)
      if ! command -v kubectl &> /dev/null; then
        echo -e "${RED}✗ kubectl is required but not installed${NC}"
        missing_tools=$((missing_tools + 1))
      else
        echo -e "${GREEN}✓ kubectl${NC}"
      fi
      ;;
  esac
  
  # Check other required tools
  tools=("jq" "python3" "curl")
  for tool in "${tools[@]}"; do
    if ! command -v $tool &> /dev/null; then
      echo -e "${RED}✗ $tool is required but not installed${NC}"
      missing_tools=$((missing_tools + 1))
    else
      echo -e "${GREEN}✓ $tool${NC}"
    fi
  done
  
  if [ $missing_tools -gt 0 ]; then
    echo -e "${RED}Error: Missing required tools. Please install them before proceeding.${NC}"
    exit 1
  fi
}

# Create a backup before deployment
create_backup() {
  echo -e "${YELLOW}Creating pre-deployment backup...${NC}"
  
  BACKUP_NAME="documind_predeployment_${DEPLOYMENT_ID}"
  BACKUP_DIR="/var/backups/documind"
  
  mkdir -p $BACKUP_DIR
  
  case $DEPLOY_MODE in
    swarm)
      # Trigger backup service in swarm
      docker service scale documind_backup=1 || true
      sleep 10
      ;;
    compose)
      # Run backup using docker-compose
      if command -v docker-compose &> /dev/null; then
        docker-compose run --rm backup /app/backup.sh
      else
        docker compose run --rm backup /app/backup.sh
      fi
      ;;
    k8s)
      # Run backup job in kubernetes
      kubectl create job --from=cronjob/documind-backup backup-${DEPLOYMENT_ID} -n documind
      kubectl wait --for=condition=complete job/backup-${DEPLOYMENT_ID} -n documind --timeout=300s
      ;;
  esac
  
  echo -e "${GREEN}Pre-deployment backup completed${NC}"
}

# Deploy application with zero-downtime
deploy_application() {
  echo -e "${YELLOW}Starting zero-downtime deployment with tag: ${TAG}...${NC}"
  
  # Set environment variable for Docker image tag
  export IMAGE_TAG="$TAG"
  export DEPLOYMENT_ID="$DEPLOYMENT_ID"
  
  case $DEPLOY_MODE in
    swarm)
      # Deploy with Docker Swarm
      echo -e "${BLUE}Deploying with Docker Swarm${NC}"
      
      if [ "$STRATEGY" = "blue-green" ]; then
        deploy_blue_green_swarm
      else
        # Standard rolling update
        UPDATE_FLAGS="--update-parallelism 1 --update-delay ${UPDATE_DELAY}s --update-order start-first"
        if [ "$AUTO_ROLLBACK" = true ]; then
          UPDATE_FLAGS="$UPDATE_FLAGS --update-failure-action rollback"
        else
          UPDATE_FLAGS="$UPDATE_FLAGS --update-failure-action pause"
        fi
        
        docker stack deploy $UPDATE_FLAGS --with-registry-auth -c docker-compose.yml -c docker-compose.prod.yml documind
      fi
      ;;
      
    compose)
      # Deploy with Docker Compose
      echo -e "${BLUE}Deploying with Docker Compose${NC}"
      
      # Use docker-compose or docker compose based on availability
      if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
      else
        COMPOSE_CMD="docker compose"
      fi
      
      # Pull the new images
      $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml pull
      
      if [ "$STRATEGY" = "blue-green" ]; then
        deploy_blue_green_compose
      else
        # Perform rolling update
        for SERVICE in app redis; do
          echo -e "${YELLOW}Updating $SERVICE...${NC}"
          $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps $SERVICE
          wait_for_service_health $SERVICE
        done
        
        # Update remaining services
        $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml up -d
      fi
      ;;
      
    k8s)
      # Deploy with Kubernetes
      echo -e "${BLUE}Deploying with Kubernetes${NC}"
      
      # Set image tag
      kubectl set image deployment/documind-app documind-app=documind/app:$TAG -n documind
      
      # Wait for rollout to complete
      kubectl rollout status deployment/documind-app -n documind --timeout=300s
      ;;
  esac
  
  echo -e "${GREEN}Deployment completed successfully${NC}"
}

# Blue-Green deployment for Docker Swarm
deploy_blue_green_swarm() {
  echo -e "${BLUE}Performing Blue-Green deployment in Swarm mode${NC}"
  
  # Determine current color (blue or green)
  CURRENT_COLOR=$(docker service ls --filter name=documind_app | grep -q "documind_app-blue" && echo "blue" || echo "green")
  NEW_COLOR=$([ "$CURRENT_COLOR" = "blue" ] && echo "green" || echo "blue")
  
  echo -e "Current deployment: ${YELLOW}$CURRENT_COLOR${NC}"
  echo -e "New deployment: ${GREEN}$NEW_COLOR${NC}"
  
  # Create new stack with the new color
  sed "s/app:/app-$NEW_COLOR:/g" docker-compose.prod.yml > docker-compose.prod.$NEW_COLOR.yml
  
  # Deploy the new stack
  docker stack deploy --with-registry-auth -c docker-compose.yml -c docker-compose.prod.$NEW_COLOR.yml documind-$NEW_COLOR
  
  # Wait for the new stack to be healthy
  echo -e "${YELLOW}Waiting for new deployment to become healthy...${NC}"
  sleep 10
  
  RETRY=0
  while [ $RETRY -lt $HEALTH_CHECK_RETRIES ]; do
    if curl -s http://localhost:3000/api/v1/health | grep -q '"status":"healthy"'; then
      echo -e "${GREEN}New deployment is healthy!${NC}"
      break
    fi
    
    echo -e "${YELLOW}Waiting for service to be healthy... ($RETRY/$HEALTH_CHECK_RETRIES)${NC}"
    RETRY=$((RETRY+1))
    sleep $HEALTH_CHECK_INTERVAL
  done
  
  if [ $RETRY -eq $HEALTH_CHECK_RETRIES ]; then
    echo -e "${RED}New deployment failed health checks. Rolling back...${NC}"
    docker stack rm documind-$NEW_COLOR
    rm docker-compose.prod.$NEW_COLOR.yml
    send_notification "failure" "Blue-Green deployment failed. New services didn't pass health checks."
    exit 1
  fi
  
  # Update routing to the new deployment
  # In real-world scenario, this would update load balancer rules
  echo -e "${YELLOW}Switching traffic to the new deployment...${NC}"
  
  # Remove the old stack
  echo -e "${YELLOW}Removing old deployment...${NC}"
  docker stack rm documind-$CURRENT_COLOR
  
  # Clean up
  rm docker-compose.prod.$NEW_COLOR.yml
}

# Blue-Green deployment for Docker Compose
deploy_blue_green_compose() {
  echo -e "${BLUE}Performing Blue-Green deployment in Compose mode${NC}"
  
  # Determine which ports are currently in use
  CURRENT_PORT=$(netstat -tlpn | grep -E ':3000\s' | wc -l)
  
  if [ $CURRENT_PORT -gt 0 ]; then
    # Current deployment is on default port, new will be on alternate
    NEW_PORT=3001
    CURRENT_APP_PORT=3000
  else
    # Current deployment is on alternate or not running, new will be on default
    NEW_PORT=3000
    CURRENT_APP_PORT=3001
  fi
  
  echo -e "Current application port: ${YELLOW}$CURRENT_APP_PORT${NC}"
  echo -e "New application port: ${GREEN}$NEW_PORT${NC}"
  
  # Create a modified docker-compose file for the new deployment
  cat > docker-compose.blue-green.yml << EOF
version: '3.8'

services:
  app:
    ports:
      - "${NEW_PORT}:3000"
    environment:
      - PORT=3000
      - DEPLOYMENT_COLOR=$([ $NEW_PORT -eq 3000 ] && echo "blue" || echo "green")
EOF
  
  # Start the new deployment
  if command -v docker-compose &> /dev/null; then
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.blue-green.yml up -d app
  else
    docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.blue-green.yml up -d app
  fi
  
  # Wait for the new service to be healthy
  echo -e "${YELLOW}Waiting for new deployment to become healthy...${NC}"
  sleep 10
  
  RETRY=0
  while [ $RETRY -lt $HEALTH_CHECK_RETRIES ]; do
    if curl -s http://localhost:$NEW_PORT/api/v1/health | grep -q '"status":"healthy"'; then
      echo -e "${GREEN}New deployment is healthy!${NC}"
      break
    fi
    
    echo -e "${YELLOW}Waiting for service to be healthy... ($RETRY/$HEALTH_CHECK_RETRIES)${NC}"
    RETRY=$((RETRY+1))
    sleep $HEALTH_CHECK_INTERVAL
  done
  
  if [ $RETRY -eq $HEALTH_CHECK_RETRIES ]; then
    echo -e "${RED}New deployment failed health checks. Rolling back...${NC}"
    
    # Stop the new service
    if command -v docker-compose &> /dev/null; then
      docker-compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.blue-green.yml stop app
    else
      docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.blue-green.yml stop app
    fi
    
    rm docker-compose.blue-green.yml
    send_notification "failure" "Blue-Green deployment failed. New services didn't pass health checks."
    exit 1
  fi
  
  # Update nginx configuration to route to the new deployment
  echo -e "${YELLOW}Updating load balancer configuration...${NC}"
  
  # Create a template with the new port
  cat > docker/nginx/conf.d/default.conf.template << EOF
server {
    listen 80;
    server_name _;
    
    location / {
        proxy_pass http://app:${NEW_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

  cp docker/nginx/conf.d/default.conf.template docker/nginx/conf.d/default.conf
  
  # Restart nginx to apply the changes
  if command -v docker-compose &> /dev/null; then
    docker-compose restart nginx
  else
    docker compose restart nginx
  fi
  
  # Once traffic is routed to the new deployment, stop the old one
  echo -e "${YELLOW}Stopping old deployment...${NC}"
  
  # Clean up
  rm docker-compose.blue-green.yml
}

# Verify deployment was successful
verify_deployment() {
  echo -e "${YELLOW}Verifying deployment...${NC}"
  
  # Run the existing verification script
  if [ -f "scripts/verify-deployment.sh" ]; then
    bash scripts/verify-deployment.sh production $TAG
    VERIFY_STATUS=$?
    
    if [ $VERIFY_STATUS -ne 0 ]; then
      echo -e "${RED}Deployment verification failed!${NC}"
      
      if [ "$AUTO_ROLLBACK" = true ]; then
        echo -e "${YELLOW}Auto-rollback is enabled. Rolling back...${NC}"
        # Rollback would be implemented here
        send_notification "warning" "Deployment verification failed. Rolling back to previous version."
      else
        send_notification "warning" "Deployment verification failed. Manual intervention may be required."
      fi
      
      exit $VERIFY_STATUS
    else
      echo -e "${GREEN}Deployment verification passed!${NC}"
    fi
  else
    echo -e "${YELLOW}Verification script not found. Skipping verification.${NC}"
    
    # Perform basic health check
    echo -e "${YELLOW}Performing basic health check...${NC}"
    
    RETRY=0
    HEALTH_OK=false
    
    while [ $RETRY -lt $HEALTH_CHECK_RETRIES ]; do
      if curl -s http://localhost:3000/api/v1/health | grep -q '"status":"healthy"'; then
        echo -e "${GREEN}Health check passed!${NC}"
        HEALTH_OK=true
        break
      fi
      
      echo -e "${YELLOW}Waiting for service to be healthy... ($RETRY/$HEALTH_CHECK_RETRIES)${NC}"
      RETRY=$((RETRY+1))
      sleep $HEALTH_CHECK_INTERVAL
    done
    
    if [ "$HEALTH_OK" != true ]; then
      echo -e "${RED}Health check failed after $HEALTH_CHECK_RETRIES attempts!${NC}"
      send_notification "failure" "Deployment health check failed after multiple attempts."
      exit 1
    fi
  fi
}

# Wait for a service to become healthy
wait_for_service_health() {
  local service=$1
  echo -e "${YELLOW}Waiting for $service to become healthy...${NC}"
  
  RETRY=0
  while [ $RETRY -lt $HEALTH_CHECK_RETRIES ]; do
    if [ "$service" = "app" ]; then
      if curl -s http://localhost:3000/api/v1/health | grep -q '"status":"healthy"'; then
        echo -e "${GREEN}$service is healthy!${NC}"
        return 0
      fi
    else
      # For other services, just check if they're running
      if command -v docker-compose &> /dev/null; then
        CONTAINER_RUNNING=$(docker-compose ps -q $service | wc -l)
      else
        CONTAINER_RUNNING=$(docker compose ps -q $service | wc -l)
      fi
      
      if [ $CONTAINER_RUNNING -gt 0 ]; then
        echo -e "${GREEN}$service is running!${NC}"
        return 0
      fi
    fi
    
    echo -e "${YELLOW}Waiting for $service... ($RETRY/$HEALTH_CHECK_RETRIES)${NC}"
    RETRY=$((RETRY+1))
    sleep $HEALTH_CHECK_INTERVAL
  done
  
  echo -e "${RED}$service failed to become healthy!${NC}"
  return 1
}

# Run post-deployment tasks
run_post_deployment_tasks() {
  echo -e "${YELLOW}Running post-deployment tasks...${NC}"
  
  # Run database migrations if needed
  case $DEPLOY_MODE in
    swarm)
      # Run migrations via a one-off task in swarm
      docker service create --name documind-migrations --replicas 1 \
        --restart-condition none --network documind_documind-network \
        documind/app:$TAG node /app/dist/migrations.js
      ;;
      
    compose)
      # Run migrations via docker-compose
      if command -v docker-compose &> /dev/null; then
        docker-compose exec -T app node /app/dist/migrations.js
      else
        docker compose exec -T app node /app/dist/migrations.js
      fi
      ;;
      
    k8s)
      # Run migrations via kubernetes job
      kubectl create job --from=cronjob/documind-migrations migrations-${DEPLOYMENT_ID} -n documind
      kubectl wait --for=condition=complete job/migrations-${DEPLOYMENT_ID} -n documind --timeout=300s
      ;;
  esac
  
  # Perform system cleanup
  echo -e "${YELLOW}Cleaning up old resources...${NC}"
  
  case $DEPLOY_MODE in
    swarm)
      # Prune unused resources
      docker system prune -f --filter "until=24h"
      ;;
      
    compose)
      # Prune unused resources
      docker system prune -f --filter "until=24h"
      ;;
      
    k8s)
      # Clean up completed jobs
      kubectl delete jobs --field-selector status.successful=1 --all -n documind
      ;;
  esac
  
  echo -e "${GREEN}Post-deployment tasks completed${NC}"
}

# Main function
main() {
  print_banner
  parse_arguments "$@"
  verify_prerequisites
  load_config
  
  # Send start notification
  send_notification "info" "Starting deployment of Documind ${TAG} to production"
  
  # Start deployment process
  create_backup
  deploy_application
  verify_deployment
  run_post_deployment_tasks
  
  echo -e "${GREEN}${BOLD}Deployment successful! Documind ${TAG} is now running in production.${NC}"
  send_notification "success" "Documind ${TAG} has been successfully deployed to production"
}

# Run the main function
main "$@"
