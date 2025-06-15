#!/bin/bash
#
# Production Deployment Script for Documind
# This script handles automated deployment to production environments

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default settings
DEPLOY_ENV="production"
SWARM_MODE=true
ROLLING_UPDATE=true
HEALTHCHECK=true
BACKUP_BEFORE_DEPLOY=true
TAG="latest"
CONFIG_PATH=".env.production"

print_banner() {
  echo -e "${BLUE}${BOLD}"
  echo "╔═════════════════════════════════════════════════════╗"
  echo "║          DOCUMIND PRODUCTION DEPLOYMENT             ║"
  echo "╚═════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

# Process command-line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag=*)
      TAG="${1#*=}"
      shift
      ;;
    --env=*)
      DEPLOY_ENV="${1#*=}"
      shift
      ;;
    --config=*)
      CONFIG_PATH="${1#*=}"
      shift
      ;;
    --no-swarm)
      SWARM_MODE=false
      shift
      ;;
    --no-rolling)
      ROLLING_UPDATE=false
      shift
      ;;
    --no-healthcheck)
      HEALTHCHECK=false
      shift
      ;;
    --no-backup)
      BACKUP_BEFORE_DEPLOY=false
      shift
      ;;
    --help)
      echo -e "${BLUE}Usage:${NC} $0 [options]"
      echo "Options:"
      echo "  --tag=VERSION       Docker image tag to deploy (default: latest)"
      echo "  --env=ENV           Environment to deploy to (default: production)"
      echo "  --config=PATH       Environment file path (default: .env.production)"
      echo "  --no-swarm          Use docker-compose instead of swarm mode"
      echo "  --no-rolling        Disable rolling updates"
      echo "  --no-healthcheck    Skip health checks"
      echo "  --no-backup         Skip backup before deployment"
      echo "  --help              Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Validate environment
validate_environment() {
  echo -e "${YELLOW}Validating environment...${NC}"
  
  # Check if config file exists
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo -e "${RED}Error: Configuration file $CONFIG_PATH not found${NC}"
    exit 1
  fi
  
  # Check Docker
  if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
    exit 1
  fi
  
  # Check Docker Swarm if swarm mode is enabled
  if [[ "$SWARM_MODE" = true ]]; then
    if ! docker info | grep -q "Swarm: active"; then
      echo -e "${RED}Error: Docker Swarm is not active. Run 'docker swarm init' or use --no-swarm option${NC}"
      exit 1
    fi
  else
    # Check docker-compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
      echo -e "${RED}Error: Docker Compose is not installed${NC}"
      exit 1
    fi
  fi
  
  echo -e "${GREEN}Environment validated successfully${NC}"
}

# Create backup before deployment
create_backup() {
  if [[ "$BACKUP_BEFORE_DEPLOY" != true ]]; then
    echo -e "${YELLOW}Skipping pre-deployment backup${NC}"
    return 0
  fi
  
  echo -e "${YELLOW}Creating pre-deployment backup...${NC}"
  
  BACKUP_DIR="/var/backups/documind"
  BACKUP_NAME="documind_pre_deploy_$(date +%Y%m%d_%H%M%S)"
  
  # Ensure backup dir exists
  mkdir -p "$BACKUP_DIR"
  
  # Create a database dump
  if [[ "$SWARM_MODE" = true ]]; then
    # In swarm mode, use service name
    docker service logs documind_db > "$BACKUP_DIR/${BACKUP_NAME}_db_logs.txt" || true
    docker exec $(docker ps -q -f name=documind_db) pg_dump -U documind -d documind -f /tmp/backup.sql || true
    docker cp $(docker ps -q -f name=documind_db):/tmp/backup.sql "$BACKUP_DIR/${BACKUP_NAME}_db.sql" || true
  else
    # In compose mode, use container name
    docker-compose logs db > "$BACKUP_DIR/${BACKUP_NAME}_db_logs.txt" || true
    docker-compose exec db pg_dump -U documind -d documind -f /tmp/backup.sql || true
    docker cp $(docker-compose ps -q db):/tmp/backup.sql "$BACKUP_DIR/${BACKUP_NAME}_db.sql" || true
  fi
  
  # Run the backup container for application data
  echo -e "${YELLOW}Running application data backup...${NC}"
  if [[ "$SWARM_MODE" = true ]]; then
    docker service scale documind_backup=1
    # Wait for backup to complete - production backup service has its own scheduler
    sleep 30
  else
    # In compose mode, just run the backup script
    docker-compose run --rm backup /app/backup.sh
  fi
  
  echo -e "${GREEN}Pre-deployment backup completed: ${BACKUP_NAME}${NC}"
}

# Deploy the application
deploy_app() {
  echo -e "${YELLOW}Deploying Documind with tag: ${TAG}...${NC}"
  
  # Set the image tag for deployment
  export IMAGE_TAG="$TAG"
  
  if [[ "$SWARM_MODE" = true ]]; then
    # Deploy using Docker swarm
    echo -e "${BLUE}Deploying with Docker Swarm mode${NC}"
    
    # Set update config for rolling updates
    UPDATE_FLAGS=""
    if [[ "$ROLLING_UPDATE" = true ]]; then
      UPDATE_FLAGS="--update-parallelism 1 --update-delay 30s --update-order start-first"
    fi
    
    # Deploy the stack
    docker stack deploy --with-registry-auth $UPDATE_FLAGS -c docker-compose.yml -c docker-compose.prod.yml documind
    
    echo -e "${GREEN}Docker stack deployed successfully${NC}"
    
    # Monitor deployment if healthcheck is enabled
    if [[ "$HEALTHCHECK" = true ]]; then
      echo -e "${YELLOW}Monitoring service health...${NC}"
      sleep 10
      
      RETRIES=0
      MAX_RETRIES=12
      HEALTHY=false
      
      while [[ $RETRIES -lt $MAX_RETRIES ]]; do
        READY_SERVICES=$(docker service ls --format "{{.Replicas}}" --filter name=documind_app | grep -c "[0-9]/[0-9]")
        TOTAL_SERVICES=$(docker service ls --filter name=documind_app | wc -l)
        
        if [[ $READY_SERVICES -eq $TOTAL_SERVICES ]]; then
          HEALTHY=true
          break
        fi
        
        echo -e "${YELLOW}Waiting for services to be ready: $READY_SERVICES/$TOTAL_SERVICES...${NC}"
        RETRIES=$((RETRIES+1))
        sleep 30
      done
      
      if [[ "$HEALTHY" = true ]]; then
        echo -e "${GREEN}All services are healthy!${NC}"
      else
        echo -e "${RED}Warning: Not all services reached healthy state within timeout${NC}"
        echo -e "${YELLOW}Check service status with:${NC} docker service ls"
      fi
    fi
  else
    # Deploy using Docker compose
    echo -e "${BLUE}Deploying with Docker Compose${NC}"
    
    # Check if docker-compose is available or if we need to use docker compose
    if command -v docker-compose &> /dev/null; then
      COMPOSE_CMD="docker-compose"
    else
      COMPOSE_CMD="docker compose"
    fi
    
    # Pull latest images
    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml pull
    
    # Deploy with rolling update if enabled
    if [[ "$ROLLING_UPDATE" = true ]]; then
      # For each service, restart one by one
      for SERVICE in app db redis; do
        echo -e "${YELLOW}Updating service: $SERVICE${NC}"
        $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --build $SERVICE
        sleep 20 # Wait for service to stabilize
      done
      
      # Start remaining services
      $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml up -d
    else
      # Deploy all at once
      $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml up -d --build
    fi
    
    echo -e "${GREEN}Docker Compose deployment completed${NC}"
    
    # Monitor health if healthcheck is enabled
    if [[ "$HEALTHCHECK" = true ]]; then
      echo -e "${YELLOW}Checking application health...${NC}"
      sleep 10
      
      RETRIES=0
      MAX_RETRIES=12
      
      while [[ $RETRIES -lt $MAX_RETRIES ]]; do
        if curl -s http://localhost:3000/api/v1/health | grep -q "healthy"; then
          echo -e "${GREEN}Application is healthy!${NC}"
          break
        fi
        
        echo -e "${YELLOW}Waiting for application to become healthy...${NC}"
        RETRIES=$((RETRIES+1))
        sleep 10
      done
      
      if [[ $RETRIES -eq $MAX_RETRIES ]]; then
        echo -e "${RED}Warning: Application health check timed out${NC}"
      fi
    fi
  fi
}

# Clean up old resources
cleanup() {
  echo -e "${YELLOW}Running post-deployment cleanup...${NC}"
  
  # Prune unused Docker resources
  docker system prune -f
  
  echo -e "${GREEN}Cleanup completed${NC}"
}

# Main function
main() {
  print_banner
  
  echo -e "${BLUE}Starting Documind deployment to ${DEPLOY_ENV}${NC}"
  echo -e "Configuration:"
  echo -e "  - Image tag:   ${YELLOW}${TAG}${NC}"
  echo -e "  - Config file: ${YELLOW}${CONFIG_PATH}${NC}"
  echo -e "  - Swarm mode:  ${YELLOW}${SWARM_MODE}${NC}"
  echo -e "  - Environment: ${YELLOW}${DEPLOY_ENV}${NC}"
  echo
  
  # Load environment variables
  if [[ -f "$CONFIG_PATH" ]]; then
    export $(grep -v '^#' "$CONFIG_PATH" | xargs)
    echo -e "${GREEN}Loaded configuration from ${CONFIG_PATH}${NC}"
  fi
  
  # Run deployment steps
  validate_environment
  create_backup
  deploy_app
  cleanup
  
  echo -e "${GREEN}${BOLD}✓ Deployment to ${DEPLOY_ENV} completed successfully!${NC}"
  echo -e "${BLUE}Please check the application status and logs to verify operation.${NC}"
}

# Run the script
main
