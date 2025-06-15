#!/bin/bash
#
# Ninja Guardian
# Handles post-deployment tasks, security, and cleanup

set -eo pipefail

# Load environment variables
if [ -z "$1" ]; then
  echo "Error: Environment file not provided"
  exit 1
fi

source "$1"

# Initialize
ninja_log "Guardian" "Starting post-deployment guardian tasks" "INFO"
ninja_log "Guardian" "Target environment: $DEPLOY_ENV" "INFO"
ninja_log "Guardian" "Deployment mode: $DEPLOY_MODE" "INFO"

# Create output directory for guardian results
GUARDIAN_DIR="build/ninja-guardian/$DEPLOY_ENV"
mkdir -p "$GUARDIAN_DIR"

# Check deployment health from monitor
MONITOR_DIR="build/ninja-monitor/$DEPLOY_ENV"
MONITOR_SUMMARY="$MONITOR_DIR/monitor-summary.json"
DEPLOY_HEALTHY=false

if [ -f "$MONITOR_SUMMARY" ]; then
  HEALTH_STATUS=$(cat "$MONITOR_SUMMARY" | jq -r '.health.status')
  if [ "$HEALTH_STATUS" == "healthy" ]; then
    DEPLOY_HEALTHY=true
    ninja_log "Guardian" "Deployment is healthy according to monitor" "INFO"
  else
    ninja_log "Guardian" "Deployment has health issues according to monitor" "WARN"
  fi
else
  ninja_log "Guardian" "No monitoring summary found, assuming deployment is healthy" "WARN"
  DEPLOY_HEALTHY=true
fi

# Load rollback configuration
AUTO_ROLLBACK=$(echo $TEAM_CONFIG | jq -r ".strategies.${DEPLOY_ENV}.rollback_enabled // false")

# Handle unhealthy deployment
if [ "$DEPLOY_HEALTHY" != true ] && [ "$AUTO_ROLLBACK" = true ]; then
  ninja_log "Guardian" "Unhealthy deployment detected with auto-rollback enabled" "WARN"
  
  # Execute rollback based on deployment mode
  ninja_log "Guardian" "Initiating rollback procedure..." "INFO"
  
  # Get backup ID from deployer
  DEPLOYER_DIR="build/ninja-deployer/$DEPLOY_ENV"
  BACKUP_ID=$(cat "$DEPLOYER_DIR/deployment.json" | jq -r '.backup // ""')
  
  if [ -n "$BACKUP_ID" ]; then
    ninja_log "Guardian" "Rolling back to pre-deployment state: $BACKUP_ID" "INFO"
    
    case $DEPLOY_MODE in
      swarm)
        # For swarm, redeploy previous stack
        if docker stack ls | grep -q "documind-${DEPLOY_ENV}"; then
          ninja_log "Guardian" "Removing current stack..." "INFO"
          docker stack rm documind-${DEPLOY_ENV} > /dev/null 2>&1
          sleep 10
        fi
        
        # Check for previous stack definition
        BACKUP_DIR="backups/${DEPLOY_ENV}/${BACKUP_ID}"
        if [ -f "${BACKUP_DIR}/services.json" ]; then
          ninja_log "Guardian" "Redeploying previous stack configuration..." "INFO"
          # Recreate previous services
          docker stack deploy --with-registry-auth \
            -c docker-compose.yml \
            -c docker-compose.${DEPLOY_ENV}.yml \
            documind-${DEPLOY_ENV} > /dev/null 2>&1
        else
          ninja_log "Guardian" "No previous stack configuration found" "ERROR"
        fi
        ;;
        
      compose)
        # For compose, stop current and start previous
        ninja_log "Guardian" "Stopping current deployment..." "INFO"
        if command -v docker-compose &>/dev/null; then
          docker-compose down > /dev/null 2>&1
        else
          docker compose down > /dev/null 2>&1
        fi
        
        # Check for previous configuration backup
        BACKUP_DIR="backups/${DEPLOY_ENV}/${BACKUP_ID}"
        if [ -f "${BACKUP_DIR}/compose-config.yml" ]; then
          ninja_log "Guardian" "Restoring previous configuration..." "INFO"
          cp "${BACKUP_DIR}/compose-config.yml" docker-compose.override.yml
          
          if command -v docker-compose &>/dev/null; then
            docker-compose up -d > /dev/null 2>&1
          else
            docker compose up -d > /dev/null 2>&1
          fi
        else
          ninja_log "Guardian" "No previous configuration found to restore" "ERROR"
        fi
        ;;
        
      k8s)
        # For K8s, apply previous manifests
        BACKUP_DIR="backups/${DEPLOY_ENV}/${BACKUP_ID}"
        if [ -f "${BACKUP_DIR}/k8s-resources.yaml" ]; then
          ninja_log "Guardian" "Restoring previous Kubernetes resources..." "INFO"
          kubectl apply -f "${BACKUP_DIR}/k8s-resources.yaml" > /dev/null 2>&1
        else
          ninja_log "Guardian" "No previous K8s configuration found" "ERROR"
        fi
        ;;
    esac
    
    ninja_log "Guardian" "Rollback completed" "SUCCESS"
  else
    ninja_log "Guardian" "No backup ID found for rollback" "ERROR"
  fi
  
  ninja_log "Guardian" "Deployment guardian tasks completed with rollback" "WARN"
  exit 1
fi

# For healthy deployments, continue with post-deployment tasks
ninja_log "Guardian" "Running security scans..." "INFO"

# Check for security vulnerabilities
if command -v trivy &>/dev/null; then
  ninja_log "Guardian" "Running container security scan..." "INFO"
  mkdir -p "$GUARDIAN_DIR/security"
  
  # Run container scan on the deployed image
  trivy image --no-progress --format json --output "$GUARDIAN_DIR/security/container-scan.json" documind:${DEPLOY_TAG} > /dev/null 2>&1 || true
  
  # Check for critical vulnerabilities
  CRITICAL_VULNS=$(jq '.Results[].Vulnerabilities[] | select(.Severity=="CRITICAL") | .VulnerabilityID' "$GUARDIAN_DIR/security/container-scan.json" 2>/dev/null | wc -l || echo 0)
  
  if [ "$CRITICAL_VULNS" -gt 0 ]; then
    ninja_log "Guardian" "Found $CRITICAL_VULNS critical vulnerabilities in container image" "WARN"
    
    # If in production, send security alert
    if [ "$DEPLOY_ENV" = "production" ] && [ -n "$SLACK_WEBHOOK_URL" ]; then
      curl -s -X POST -H 'Content-type: application/json' --data "{
        \"text\": \"⚠️ Security Alert: $CRITICAL_VULNS critical vulnerabilities found in $DEPLOY_ENV deployment ($DEPLOYMENT_ID)\",
        \"attachments\": [
          {
            \"color\": \"danger\",
            \"title\": \"Security Scan Results\",
            \"text\": \"Container image has critical vulnerabilities that should be addressed immediately.\"
          }
        ]
      }" "$SLACK_WEBHOOK_URL" > /dev/null || true
    fi
  else
    ninja_log "Guardian" "No critical vulnerabilities found in container image" "SUCCESS"
  fi
else
  ninja_log "Guardian" "Trivy not available, skipping container scan" "WARN"
fi

# Run database migrations if needed
ninja_log "Guardian" "Running database migrations..." "INFO"
case $DEPLOY_MODE in
  swarm)
    # Create a one-time service for migrations
    docker service create --name documind-migrations-${DEPLOYMENT_ID} --replicas 1 \
      --restart-condition none --network documind-${DEPLOY_ENV}_default \
      documind:${DEPLOY_TAG} node /app/dist/migrations.js > /dev/null 2>&1 || \
      ninja_log "Guardian" "Migration service creation failed" "WARN"
    ;;
    
  compose)
    # Run migrations via docker-compose
    if command -v docker-compose &>/dev/null; then
      docker-compose exec -T app node /app/dist/migrations.js > /dev/null 2>&1 || \
      ninja_log "Guardian" "Migrations failed to run" "WARN"
    else
      docker compose exec -T app node /app/dist/migrations.js > /dev/null 2>&1 || \
      ninja_log "Guardian" "Migrations failed to run" "WARN"
    fi
    ;;
    
  k8s)
    # Create a Kubernetes job for migrations
    cat > "$GUARDIAN_DIR/migration-job.yaml" << EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: documind-migrations-${DEPLOYMENT_ID}
  namespace: documind
spec:
  template:
    spec:
      containers:
      - name: migrations
        image: documind:${DEPLOY_TAG}
        command: ["node", "/app/dist/migrations.js"]
      restartPolicy: Never
  backoffLimit: 1
EOF
    kubectl apply -f "$GUARDIAN_DIR/migration-job.yaml" > /dev/null 2>&1 || \
    ninja_log "Guardian" "Migration job creation failed" "WARN"
    ;;
esac

# Clean up old resources
ninja_log "Guardian" "Cleaning up old resources..." "INFO"

# Clean up based on deployment mode
case $DEPLOY_MODE in
  swarm)
    # Clean up old services and images
    docker system prune -f --filter "until=24h" > /dev/null 2>&1 || true
    
    # Remove completed migration jobs
    COMPLETED_SERVICES=$(docker service ls --filter name=documind-migrations --format "{{.ID}}" --filter "replicas=0/1")
    for SERVICE_ID in $COMPLETED_SERVICES; do
      docker service rm "$SERVICE_ID" > /dev/null 2>&1 || true
    done
    ;;
    
  compose)
    # Clean up old volumes and images
    docker system prune -f --filter "until=24h" > /dev/null 2>&1 || true
    
    # Remove orphaned volumes older than 7 days
    docker volume ls -qf dangling=true | xargs -r docker volume rm > /dev/null 2>&1 || true
    ;;
    
  k8s)
    # Clean up completed jobs
    kubectl delete jobs -n documind --field-selector status.successful=1 > /dev/null 2>&1 || true
    
    # Clean up old pods in Completed status
    kubectl delete pods -n documind --field-selector status.phase=Succeeded > /dev/null 2>&1 || true
    ;;
esac

# Rotate logs if needed
ninja_log "Guardian" "Rotating logs..." "INFO"
if [ -d "logs" ]; then
  find logs -name "*.log" -type f -size +10M -exec gzip {} \; 2>/dev/null || true
  
  # Delete logs older than 30 days
  find logs -name "*.gz" -type f -mtime +30 -delete 2>/dev/null || true
fi

# Update monitoring configuration
ninja_log "Guardian" "Updating monitoring configuration..." "INFO"
if [ -f "deploy/monitoring/${DEPLOY_ENV}.json" ]; then
  case $DEPLOY_MODE in
    swarm|compose)
      # Update local monitoring configuration
      if [ -f "docker-compose.monitoring.yml" ]; then
        if command -v docker-compose &>/dev/null; then
          docker-compose -f docker-compose.monitoring.yml up -d > /dev/null 2>&1 || true
        else
          docker compose -f docker-compose.monitoring.yml up -d > /dev/null 2>&1 || true
        fi
      fi
      ;;
      
    k8s)
      # Update Kubernetes monitoring
      if [ -d "deploy/monitoring/kubernetes" ]; then
        kubectl apply -k deploy/monitoring/kubernetes > /dev/null 2>&1 || true
      fi
      ;;
  esac
fi

# Write deployment completion marker
ninja_log "Guardian" "Creating deployment completion record..." "INFO"
cat > "$GUARDIAN_DIR/deployment-complete.json" << EOF
{
  "id": "$DEPLOYMENT_ID",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "environment": "$DEPLOY_ENV",
  "tag": "$DEPLOY_TAG",
  "status": "completed",
  "healthy": $DEPLOY_HEALTHY,
  "mode": "$DEPLOY_MODE"
}
EOF

# Send deployment completion notification
if [ -n "$SLACK_WEBHOOK_URL" ]; then
  ninja_log "Guardian" "Sending deployment completion notification..." "INFO"
  
  # Determine status emoji and color
  if [ "$DEPLOY_HEALTHY" = true ]; then
    STATUS_EMOJI="✅"
    STATUS_COLOR="good"
    STATUS_TEXT="Deployment completed successfully"
  else
    STATUS_EMOJI="⚠️"
    STATUS_COLOR="warning"
    STATUS_TEXT="Deployment completed with warnings"
  fi
  
  curl -s -X POST -H 'Content-type: application/json' --data "{
    \"text\": \"${STATUS_EMOJI} Documind deployment to ${DEPLOY_ENV} has been completed\",
    \"attachments\": [
      {
        \"color\": \"${STATUS_COLOR}\",
        \"title\": \"${STATUS_TEXT}\",
        \"fields\": [
          {\"title\": \"Environment\", \"value\": \"${DEPLOY_ENV}\", \"short\": true},
          {\"title\": \"Version\", \"value\": \"${DEPLOY_TAG}\", \"short\": true},
          {\"title\": \"Deployment ID\", \"value\": \"${DEPLOYMENT_ID}\", \"short\": true}
        ],
        \"footer\": \"Ninja Guardian\",
        \"ts\": $(date +%s)
      }
    ]
  }" "$SLACK_WEBHOOK_URL" > /dev/null || true
fi

ninja_log "Guardian" "All post-deployment tasks completed" "SUCCESS"
exit 0
