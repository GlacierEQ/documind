#!/bin/bash
#
# Ninja Monitor
# Watches deployment health and collects metrics

set -eo pipefail

# Load environment variables
if [ -z "$1" ]; then
  echo "Error: Environment file not provided"
  exit 1
fi

source "$1"

# Initialize
ninja_log "Monitor" "Starting deployment monitoring" "INFO"
ninja_log "Monitor" "Target environment: $DEPLOY_ENV" "INFO"
ninja_log "Monitor" "Deployment mode: $DEPLOY_MODE" "INFO"

# Create output directory for monitor artifacts
MONITOR_DIR="build/ninja-monitor/$DEPLOY_ENV"
mkdir -p "$MONITOR_DIR"

# Load configuration from team config
HEALTH_CHECK_RETRIES=$(echo $TEAM_CONFIG | jq -r ".strategies.${DEPLOY_ENV}.health_check_retries // 10")
HEALTH_CHECK_INTERVAL=10 # seconds
VERIFICATION_REQUIRED=$(echo $TEAM_CONFIG | jq -r ".strategies.${DEPLOY_ENV}.verification_required // false")

# Determine service check URL
SERVICE_URL="http://localhost:3000"
API_HEALTH_ENDPOINT="/api/v1/health"

# Get deployment information
DEPLOYER_DIR="build/ninja-deployer/$DEPLOY_ENV"
if [ -f "$DEPLOYER_DIR/deployment.json" ]; then
  DEPLOY_TIMESTAMP=$(cat "$DEPLOYER_DIR/deployment.json" | jq -r '.timestamp')
  ninja_log "Monitor" "Monitoring deployment from: $DEPLOY_TIMESTAMP" "INFO"
  
  # Check for blue-green deployment
  if [ -f "$DEPLOYER_DIR/active-color.txt" ]; then
    ACTIVE_COLOR=$(cat "$DEPLOYER_DIR/active-color.txt")
    ninja_log "Monitor" "Monitoring $ACTIVE_COLOR deployment" "INFO"
  elif [ -f "$DEPLOYER_DIR/active-port.txt" ]; then
    ACTIVE_PORT=$(cat "$DEPLOYER_DIR/active-port.txt")
    SERVICE_URL="http://localhost:$ACTIVE_PORT"
    ninja_log "Monitor" "Monitoring deployment on port: $ACTIVE_PORT" "INFO"
  fi
fi

# Wait for services to become available
ninja_log "Monitor" "Starting health checks (max retries: $HEALTH_CHECK_RETRIES)" "INFO"
ninja_log "Monitor" "Health check endpoint: ${SERVICE_URL}${API_HEALTH_ENDPOINT}" "INFO"

# Initialize variables
RETRY=0
HEALTHY=false
START_TIME=$(date +%s)

# Health check loop
while [ $RETRY -lt $HEALTH_CHECK_RETRIES ]; do
  # Display progress
  ninja_log "Monitor" "Health check attempt $((RETRY+1))/$HEALTH_CHECK_RETRIES..." "INFO"
  
  # Perform health check based on deployment mode
  case $DEPLOY_MODE in
    swarm)
      # Check service status
      if docker service ls --filter name=documind | grep -q "[0-9]/[0-9]"; then
        SERVICE_REPLICAS=$(docker service ls --filter name=documind --format "{{.Replicas}}")
        if [[ "$SERVICE_REPLICAS" != *"0/"* ]]; then
          # Service appears healthy in swarm, now check API
          HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}${API_HEALTH_ENDPOINT}" || echo "failed")
          if [[ "$HEALTH_STATUS" == "200" ]]; then
            HEALTHY=true
            break
          fi
        fi
      fi
      ;;
      
    compose)
      # For compose, just check API health endpoint
      HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}${API_HEALTH_ENDPOINT}" || echo "failed")
      if [[ "$HEALTH_STATUS" == "200" ]]; then
        # Verify it returns healthy status
        HEALTH_RESPONSE=$(curl -s "${SERVICE_URL}${API_HEALTH_ENDPOINT}" || echo '{"status":"error"}')
        if echo "$HEALTH_RESPONSE" | grep -q '"status":"healthy"'; then
          HEALTHY=true
          break
        fi
      fi
      ;;
      
    k8s)
      # For kubernetes, check pod status and then API
      READY_PODS=$(kubectl get pods -n documind -l app=documind -o jsonpath='{.items[*].status.containerStatuses[*].ready}' | tr ' ' '\n' | grep -c "true" || echo "0")
      TOTAL_PODS=$(kubectl get pods -n documind -l app=documind --no-headers | wc -l || echo "0")
      
      if [ "$READY_PODS" -gt 0 ] && [ "$READY_PODS" -eq "$TOTAL_PODS" ]; then
        # Pods are ready, check API health via service
        SERVICE_IP=$(kubectl get service documind -n documind -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
        
        if [ -n "$SERVICE_IP" ]; then
          # Use kubectl port-forward to access the service
          kubectl port-forward service/documind -n documind 3000:80 &>/dev/null &
          PF_PID=$!
          sleep 2
          
          HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${API_HEALTH_ENDPOINT}" || echo "failed")
          if [[ "$HEALTH_STATUS" == "200" ]]; then
            HEALTHY=true
            kill $PF_PID 2>/dev/null || true
            break
          fi
          
          kill $PF_PID 2>/dev/null || true
        fi
      fi
      ;;
  esac
  
  # Increment retry counter and wait
  RETRY=$((RETRY+1))
  sleep $HEALTH_CHECK_INTERVAL
done

# Record elapsed time
END_TIME=$(date +%s)
ELAPSED_TIME=$((END_TIME - START_TIME))

# Handle health check result
if [ "$HEALTHY" = true ]; then
  ninja_log "Monitor" "Services are healthy after $ELAPSED_TIME seconds" "SUCCESS"
  
  # Get detailed health info
  if [ "$DEPLOY_MODE" != "k8s" ] || [ -n "$(kubectl get service documind -n documind -o jsonpath='{.spec.clusterIP}' 2>/dev/null)" ]; then
    HEALTH_RESPONSE=$(curl -s "${SERVICE_URL}${API_HEALTH_ENDPOINT}" || echo '{"status":"error"}')
    echo "$HEALTH_RESPONSE" > "$MONITOR_DIR/health.json"
    
    # Extract version info if available
    if echo "$HEALTH_RESPONSE" | grep -q "version"; then
      APP_VERSION=$(echo "$HEALTH_RESPONSE" | jq -r '.version // "unknown"')
      ninja_log "Monitor" "Deployed application version: $APP_VERSION" "INFO"
    fi
  fi
  
  # Collect performance metrics
  ninja_log "Monitor" "Collecting performance metrics..." "INFO"
  
  case $DEPLOY_MODE in
    swarm|compose)
      # Docker stats for container metrics
      mkdir -p "$MONITOR_DIR/metrics"
      docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep -i documind > "$MONITOR_DIR/metrics/container-stats.txt"
      
      # Get container IDs
      CONTAINER_IDS=$(docker ps --filter name=documind -q)
      if [ -n "$CONTAINER_IDS" ]; then
        # Container logs
        for CONTAINER_ID in $CONTAINER_IDS; do
          CONTAINER_NAME=$(docker inspect --format '{{.Name}}' $CONTAINER_ID | sed 's/\///')
          docker logs --tail 50 $CONTAINER_ID > "$MONITOR_DIR/metrics/${CONTAINER_NAME}-logs.txt" 2>&1
        done
      fi
      ;;
      
    k8s)
      # Kubernetes metrics
      mkdir -p "$MONITOR_DIR/metrics"
      kubectl describe pods -n documind -l app=documind > "$MONITOR_DIR/metrics/pod-details.txt"
      kubectl logs -n documind -l app=documind --tail=50 > "$MONITOR_DIR/metrics/pod-logs.txt" 2>&1
      if command -v kubectl-top &>/dev/null || kubectl top pods -h &>/dev/null; then
        kubectl top pods -n documind -l app=documind > "$MONITOR_DIR/metrics/pod-resources.txt" 2>&1 || true
      fi
      ;;
  esac
  
  # Run smoke tests if requested and available 
  if [ "$VERIFICATION_REQUIRED" = true ]; then
    if [ -f "scripts/smoke-test.sh" ]; then
      ninja_log "Monitor" "Running smoke tests..." "INFO"
      if bash scripts/smoke-test.sh "${SERVICE_URL}"; then
        ninja_log "Monitor" "Smoke tests passed" "SUCCESS"
      else
        ninja_log "Monitor" "Smoke tests failed" "ERROR"
        # Continue deployment but mark as warning
        echo "smoke_tests_failed" > "$MONITOR_DIR/warnings.txt"
      fi
    else
      ninja_log "Monitor" "No smoke tests found, skipping verification" "WARN"
    fi
  fi
  
  # Generate summary report
  ninja_log "Monitor" "Generating monitoring summary..." "INFO"
  
  cat > "$MONITOR_DIR/monitor-summary.json" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "environment": "$DEPLOY_ENV",
  "deploymentId": "$DEPLOYMENT_ID",
  "health": {
    "status": "healthy",
    "responseTime": $ELAPSED_TIME,
    "checkAttempts": $RETRY
  },
  "mode": "$DEPLOY_MODE"
}
EOF

  # Generate markdown summary
  cat > "$MONITOR_DIR/monitor-summary.md" << EOF
# Deployment Monitoring Summary

- **Environment:** $DEPLOY_ENV
- **Deployment ID:** $DEPLOYMENT_ID
- **Health Status:** ✅ Healthy
- **Response Time:** $ELAPSED_TIME seconds
- **Check Attempts:** $RETRY/$HEALTH_CHECK_RETRIES

## Resource Utilization

$(case $DEPLOY_MODE in
  swarm|compose)
    CPU_USAGE=$(grep "%" "$MONITOR_DIR/metrics/container-stats.txt" | awk '{print $2}' | head -1)
    MEM_USAGE=$(grep -o "[0-9.]*MiB / [0-9.]*MiB" "$MONITOR_DIR/metrics/container-stats.txt" | head -1)
    echo "- **CPU Usage:** $CPU_USAGE"
    echo "- **Memory Usage:** $MEM_USAGE"
    ;;
  k8s)
    if [ -f "$MONITOR_DIR/metrics/pod-resources.txt" ]; then
      CPU=$(grep -o "[0-9]*m" "$MONITOR_DIR/metrics/pod-resources.txt" | head -1)
      MEM=$(grep -o "[0-9]*Mi" "$MONITOR_DIR/metrics/pod-resources.txt" | head -1)
      echo "- **CPU Usage:** $CPU"
      echo "- **Memory Usage:** $MEM"
    else
      echo "- Resource metrics not available"
    fi
    ;;
esac)

## Service Status

- **Version:** $APP_VERSION
- **Uptime:** $(echo $HEALTH_RESPONSE | jq -r '.uptime // "N/A"')
EOF

  ninja_log "Monitor" "Monitoring completed successfully" "SUCCESS"
  exit 0
else
  ninja_log "Monitor" "Health checks failed after $HEALTH_CHECK_RETRIES attempts ($ELAPSED_TIME seconds)" "ERROR"
  
  # Collect failure diagnostics
  ninja_log "Monitor" "Collecting failure diagnostics..." "INFO"
  mkdir -p "$MONITOR_DIR/diagnostics"
  
  case $DEPLOY_MODE in
    swarm)
      docker service ls --filter name=documind > "$MONITOR_DIR/diagnostics/service-list.txt"
      for SERVICE in $(docker service ls --filter name=documind -q); do
        docker service logs --tail 100 $SERVICE > "$MONITOR_DIR/diagnostics/service-logs-$SERVICE.txt" 2>&1 || true
      done
      ;;
      
    compose)
      if command -v docker-compose &>/dev/null; then
        docker-compose ps > "$MONITOR_DIR/diagnostics/compose-status.txt"
        docker-compose logs --tail 100 > "$MONITOR_DIR/diagnostics/compose-logs.txt" 2>&1
      elif docker compose version &>/dev/null; then
        docker compose ps > "$MONITOR_DIR/diagnostics/compose-status.txt"
        docker compose logs --tail 100 > "$MONITOR_DIR/diagnostics/compose-logs.txt" 2>&1
      fi
      ;;
      
    k8s)
      kubectl get all -n documind > "$MONITOR_DIR/diagnostics/k8s-resources.txt"
      kubectl describe all -n documind > "$MONITOR_DIR/diagnostics/k8s-describe.txt"
      kubectl logs -n documind -l app=documind --tail=100 > "$MONITOR_DIR/diagnostics/k8s-logs.txt" 2>&1 || true
      kubectl get events -n documind --sort-by='.metadata.creationTimestamp' > "$MONITOR_DIR/diagnostics/k8s-events.txt"
      ;;
  esac
  
  # Write failure report
  cat > "$MONITOR_DIR/failure-report.json" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "environment": "$DEPLOY_ENV",
  "deploymentId": "$DEPLOYMENT_ID",
  "health": {
    "status": "unhealthy",
    "elapsedTime": $ELAPSED_TIME,
    "checkAttempts": $HEALTH_CHECK_RETRIES
  },
  "mode": "$DEPLOY_MODE"
}
EOF

  ninja_log "Monitor" "Deployment health verification failed" "ERROR"
  exit 1
fi
