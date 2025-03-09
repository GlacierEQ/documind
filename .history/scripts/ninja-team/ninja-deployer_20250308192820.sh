#!/bin/bash
#
# Ninja Deployer
# Handles the actual deployment process with zero downtime strategies

set -eo pipefail

# Load environment variables
if [ -z "$1" ]; then
  echo "Error: Environment file not provided"
  exit 1
fi

source "$1"

# Initialize
ninja_log "Deployer" "Starting deployment process" "INFO"
ninja_log "Deployer" "Target environment: $DEPLOY_ENV" "INFO"
ninja_log "Deployer" "Deployment tag: $DEPLOY_TAG" "INFO"
ninja_log "Deployer" "Deployment mode: $DEPLOY_MODE" "INFO"

# Create output directory for deployer artifacts
DEPLOYER_DIR="build/ninja-deployer/$DEPLOY_ENV"
mkdir -p "$DEPLOYER_DIR"

# Load scout and builder findings
SCOUT_DIR="build/ninja-scout/$DEPLOY_ENV"
BUILDER_DIR="build/ninja-builder/$DEPLOY_ENV"
FINDINGS_FILE="$SCOUT_DIR/findings.json"
BUILD_INFO_FILE="$BUILDER_DIR/build-info.json"

# Load configurations
if [ -f "$FINDINGS_FILE" ]; then
  ninja_log "Deployer" "Loading environment configuration" "INFO"
  DEPLOY_STRATEGY=$(cat "$FINDINGS_FILE" | jq -r '.strategy')
  REPLICAS=$(cat "$FINDINGS_FILE" | jq -r '.replicas')
else
  ninja_log "Deployer" "Environment configuration not available, using defaults" "WARN"
  DEPLOY_STRATEGY="rolling"
  REPLICAS=1
fi

if [ -f "$BUILD_INFO_FILE" ]; then
  ninja_log "Deployer" "Loading build information" "INFO"
  BUILD_TIMESTAMP=$(cat "$BUILD_INFO_FILE" | jq -r '.timestamp')
  BUILD_SIZE=$(cat "$BUILD_INFO_FILE" | jq -r '.size')
  ninja_log "Deployer" "Build timestamp: $BUILD_TIMESTAMP, Size: $BUILD_SIZE" "INFO"
else
  ninja_log "Deployer" "Build information not available" "WARN"
fi

# Create pre-deployment backup
ninja_log "Deployer" "Creating pre-deployment backup..." "INFO"
BACKUP_ID="pre-deploy-${DEPLOYMENT_ID}"
BACKUP_DIR="backups/$DEPLOY_ENV"
mkdir -p "$BACKUP_DIR"

# Determine backup command based on deployment mode
case $DEPLOY_MODE in
  swarm)
    # For Swarm mode, dump service configs and data where possible
    mkdir -p "$BACKUP_DIR/$BACKUP_ID"
    if docker service ls --filter name=documind -q &>/dev/null; then
      docker service inspect $(docker service ls --filter name=documind -q) > "$BACKUP_DIR/$BACKUP_ID/services.json" 2>/dev/null || true
    fi
    ;;
    
  compose)
    # For Compose mode, run the backup script if available
    if [ -f "scripts/backup.sh" ]; then
      bash scripts/backup.sh "$BACKUP_ID" > /dev/null || \
      ninja_log "Deployer" "Backup script execution failed, continuing deployment" "WARN"
    else
      # Manual backup of configuration and volumes
      mkdir -p "$BACKUP_DIR/$BACKUP_ID"
      if command -v docker-compose &>/dev/null; then
        docker-compose config > "$BACKUP_DIR/$BACKUP_ID/compose-config.yml" 2>/dev/null || true
      elif docker compose version &>/dev/null; then
        docker compose config > "$BACKUP_DIR/$BACKUP_ID/compose-config.yml" 2>/dev/null || true
      fi
    fi
    ;;
    
  k8s)
    # For Kubernetes mode, dump resources 
    mkdir -p "$BACKUP_DIR/$BACKUP_ID"
    kubectl get all -n documind -o yaml > "$BACKUP_DIR/$BACKUP_ID/k8s-resources.yaml" 2>/dev/null || true
    ;;
esac

# Write backup info file
cat > "$BACKUP_DIR/$BACKUP_ID/backup-info.json" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "environment": "$DEPLOY_ENV",
  "deploymentId": "$DEPLOYMENT_ID",
  "mode": "$DEPLOY_MODE"
}
EOF

ninja_log "Deployer" "Pre-deployment backup created: $BACKUP_ID" "SUCCESS"

# Execute deployment based on mode
ninja_log "Deployer" "Executing $DEPLOY_STRATEGY deployment..." "INFO"

case $DEPLOY_MODE in
  swarm)
    # Deploy with Docker Swarm
    ninja_log "Deployer" "Deploying with Docker Swarm" "INFO"
    
    # Check if Swarm is initialized
    if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
      ninja_log "Deployer" "Docker Swarm not active, initializing..." "WARN"
      docker swarm init --advertise-addr $(hostname -i) > /dev/null 2>&1 || true
    fi
    
    # Apply deployment strategy
    if [ "$DEPLOY_STRATEGY" == "blue-green" ]; then
      ninja_log "Deployer" "Using Blue-Green deployment strategy" "INFO"
      
      # Determine current color deployment (blue or green)
      CURRENT_COLOR="blue"
      if docker service ls | grep -q "documind_app-blue"; then
        CURRENT_COLOR="blue"
        NEW_COLOR="green"
      else
        CURRENT_COLOR="green"
        NEW_COLOR="blue"
      fi
      
      ninja_log "Deployer" "Current deployment: $CURRENT_COLOR, New deployment: $NEW_COLOR" "INFO"
      
      # Create a temporary compose file with the new color
      cp docker-compose.yml "$DEPLOYER_DIR/docker-compose.${NEW_COLOR}.yml"
      
      # Deploy the new stack
      ninja_log "Deployer" "Deploying new $NEW_COLOR stack..." "INFO"
      docker stack deploy --with-registry-auth \
        -c docker-compose.yml \
        -c docker-compose.${DEPLOY_ENV}.yml \
        documind-${NEW_COLOR} > /dev/null 2>&1
      
      # Record deployment info
      echo "$NEW_COLOR" > "$DEPLOYER_DIR/active-color.txt"
    else
      # Standard rolling update
      ninja_log "Deployer" "Using Rolling update strategy" "INFO"
      
      # Set update configs based on environment
      UPDATE_PARALLELISM=1
      UPDATE_DELAY=10s
      UPDATE_ORDER="start-first"
      
      if [ "$DEPLOY_ENV" = "production" ]; then
        UPDATE_DELAY=30s
      fi
      
      # Deploy stack
      ninja_log "Deployer" "Deploying stack documind-${DEPLOY_ENV}..." "INFO"
      docker stack deploy --with-registry-auth \
        --update-parallelism $UPDATE_PARALLELISM \
        --update-delay $UPDATE_DELAY \
        --update-order $UPDATE_ORDER \
        -c docker-compose.yml \
        -c docker-compose.${DEPLOY_ENV}.yml \
        documind-${DEPLOY_ENV} > /dev/null 2>&1
    fi
    ;;
    
  compose)
    # Deploy with Docker Compose
    ninja_log "Deployer" "Deploying with Docker Compose" "INFO"
    
    # Determine compose command
    if command -v docker-compose &>/dev/null; then
      COMPOSE_CMD="docker-compose"
      ninja_log "Deployer" "Using docker-compose command" "INFO"
    elif docker compose version &>/dev/null; then
      COMPOSE_CMD="docker compose"
      ninja_log "Deployer" "Using docker compose plugin" "INFO"
    else
      ninja_log "Deployer" "Docker Compose not found" "ERROR"
      exit 1
    fi
    
    # Pull images first
    ninja_log "Deployer" "Pulling latest images..." "INFO"
    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml pull > /dev/null 2>&1
    
    # Apply deployment strategy
    if [ "$DEPLOY_STRATEGY" == "blue-green" ]; then
      ninja_log "Deployer" "Using Blue-Green deployment strategy" "INFO"
      
      # Determine current and new ports
      CURRENT_PORT=3000
      NEW_PORT=3001
      
      if netstat -ln | grep -q ":3001"; then
        CURRENT_PORT=3001
        NEW_PORT=3000
      fi
      
      ninja_log "Deployer" "Current port: $CURRENT_PORT, New port: $NEW_PORT" "INFO"
      
      # Create a modified docker-compose file for the new port
      cat > "$DEPLOYER_DIR/docker-compose.override.yml" << EOF
version: '3.8'

services:
  app:
    ports:
      - "${NEW_PORT}:3000"
EOF
      
      # Start the new deployment
      ninja_log "Deployer" "Starting new app instance on port $NEW_PORT" "INFO"
      $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml \
        -f $DEPLOYER_DIR/docker-compose.override.yml up -d > /dev/null 2>&1
        
      # Record the deployment info
      echo "$NEW_PORT" > "$DEPLOYER_DIR/active-port.txt"
    else
      # Standard deployment
      ninja_log "Deployer" "Using standard deployment" "INFO"
      
      if [ "$DEPLOY_ENV" = "production" ]; then
        # Deploy services one by one for production
        ninja_log "Deployer" "Deploying services individually for zero downtime" "INFO"
        
        # Deploy database first if present
        if $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml config --services | grep -q "db"; then
          ninja_log "Deployer" "Deploying database..." "INFO"
          $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml up -d db > /dev/null 2>&1
          sleep 5
        fi
        
        # Deploy other dependencies
        if $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml config --services | grep -q "redis"; then
          ninja_log "Deployer" "Deploying Redis..." "INFO"
          $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml up -d redis > /dev/null 2>&1
          sleep 3
        fi
        
        # Deploy the app
        ninja_log "Deployer" "Deploying application..." "INFO"
        $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml up -d app > /dev/null 2>&1
      else
        # Deploy everything at once for non-production
        $COMPOSE_CMD -f docker-compose.yml -f docker-compose.${DEPLOY_ENV}.yml up -d > /dev/null 2>&1
      fi
    fi
    ;;
    
  k8s)
    # Deploy with Kubernetes
    ninja_log "Deployer" "Deploying with Kubernetes" "INFO"
    
    # Create the namespace if it doesn't exist
    kubectl get namespace documind > /dev/null 2>&1 || kubectl create namespace documind > /dev/null 2>&1
    
    # Apply deployment configs
    if [ -d "deploy/kubernetes/${DEPLOY_ENV}" ]; then
      ninja_log "Deployer" "Applying Kubernetes manifests from deploy/kubernetes/${DEPLOY_ENV}" "INFO"
      kubectl apply -k deploy/kubernetes/${DEPLOY_ENV} > /dev/null 2>&1
    else
      # Generate and apply basic deployment
      ninja_log "Deployer" "No Kubernetes manifests found, generating basic deployment" "WARN"
      mkdir -p "$DEPLOYER_DIR/kubernetes"
      
      # Create a basic deployment manifest
      cat > "$DEPLOYER_DIR/kubernetes/deployment.yaml" << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: documind
  namespace: documind
spec:
  replicas: $REPLICAS
  selector:
    matchLabels:
      app: documind
  template:
    metadata:
      labels:
        app: documind
    spec:
      containers:
      - name: documind
        image: documind:${DEPLOY_TAG}
        ports:
        - containerPort: 3000
        resources:
          limits:
            cpu: "1"
            memory: "1Gi"
          requests:
            cpu: "0.5"
            memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: documind
  namespace: documind
spec:
  selector:
    app: documind
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
EOF
      
      # Apply the manifest
      kubectl apply -f "$DEPLOYER_DIR/kubernetes/deployment.yaml" > /dev/null 2>&1
    fi
    ;;
esac

ninja_log "Deployer" "Deployment initiated successfully" "SUCCESS"

# Record deployment details
cat > "$DEPLOYER_DIR/deployment.json" << EOF
{
  "id": "$DEPLOYMENT_ID",
  "environment": "$DEPLOY_ENV",
  "tag": "$DEPLOY_TAG",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "strategy": "$DEPLOY_STRATEGY",
  "mode": "$DEPLOY_MODE",
  "backup": "$BACKUP_ID"
}
EOF

# Signal successful completion
ninja_log "Deployer" "Deployment process completed" "SUCCESS"
exit 0
