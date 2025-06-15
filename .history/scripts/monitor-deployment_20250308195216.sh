#!/bin/bash
#
# Deployment Monitoring System
# Real-time monitoring of deployment status and metrics

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
DURATION=600 # 10 minutes
CHECK_INTERVAL=5
BACKGROUND=false
OUTPUT_DIR="logs/monitoring"
LOG_FILE="${OUTPUT_DIR}/monitor-$(date +%Y%m%d%H%M%S).log"

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
    --duration=*)
      DURATION="${1#*=}"
      shift
      ;;
    --interval=*)
      CHECK_INTERVAL="${1#*=}"
      shift
      ;;
    --background)
      BACKGROUND=true
      shift
      ;;
    --output=*)
      LOG_FILE="${1#*=}"
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --env=ENV        Target environment (production, staging, development)"
      echo "  --tag=TAG        Deployment tag to monitor"
      echo "  --duration=SEC   Monitoring duration in seconds (default: 600)"
      echo "  --interval=SEC   Check interval in seconds (default: 5)"
      echo "  --background     Run in background mode"
      echo "  --output=FILE    Output log file"
      echo "  --help           Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Log function
log() {
  local level=$1
  local message=$2
  local color=$BLUE
  local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
  
  case $level in
    "INFO") color=$BLUE ;;
    "SUCCESS") color=$GREEN ;;
    "WARN") color=$YELLOW ;;
    "ERROR") color=$RED ;;
  esac
  
  # Echo if not in background mode
  if [ "$BACKGROUND" = false ]; then
    echo -e "${color}[${timestamp}] [${level}]${NC} ${message}"
  fi
  
  # Always write to log file
  echo "[${timestamp}] [${level}] ${message}" >> "$LOG_FILE"
}

# Detect deployment mode
detect_mode() {
  if docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "swarm"
  elif command -v kubectl &>/dev/null && kubectl get nodes &>/dev/null; then
    echo "k8s"
  else
    echo "compose"
  fi
}

# Get container metrics based on mode
get_container_metrics() {
  local mode=$1
  local env=$2
  
  case $mode in
    swarm)
      # For Swarm mode
      docker service ls --filter name=documind-${env} || echo "No services found"
      docker service ps --filter name=documind-${env} --format "table {{.Name}}\t{{.CurrentState}}" || echo "No tasks found"
      ;;
      
    compose)
      # For Compose mode
      if command -v docker-compose &>/dev/null; then
        docker-compose ps || echo "No containers found"
      else
        docker compose ps || echo "No containers found"
      fi
      ;;
      
    k8s)
      # For Kubernetes mode
      kubectl get pods -n documind -o wide || echo "No pods found"
      kubectl get services -n documind || echo "No services found"
      ;;
  esac
}

# Get health and metrics data
get_health_data() {
  local url="http://localhost:3000/api/v1/health"
  curl -s "$url" 2>/dev/null || echo '{"status":"unavailable"}'
}

# Check if deployment is healthy
is_deployment_healthy() {
  local mode=$1
  
  case $mode in
    swarm)
      # For Swarm mode
      REPLICAS=$(docker service ls --filter name=documind-${ENV} --format "{{.Replicas}}")
      [[ "$REPLICAS" == *"/"* ]] && [[ "$REPLICAS" != *"0/"* ]]
      return $?
      ;;
      
    compose)
      # For Compose mode
      HEALTH_DATA=$(get_health_data)
      echo "$HEALTH_DATA" | grep -q '"status":"healthy"'
      return $?
      ;;
      
    k8s)
      # For Kubernetes mode
      READY_PODS=$(kubectl get pods -n documind -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}')
      [[ -n "$READY_PODS" ]]
      return $?
      ;;
  esac
}

# Format system metrics for display
format_metrics() {
  local data="$1"
  
  # Extract CPU usage
  CPU=$(echo "$data" | grep -o '"cpu":{[^}]*}' | grep -o '"utilization":[0-9.]*' | cut -d: -f2)
  
  # Extract memory usage
  MEM=$(echo "$data" | grep -o '"memory":{[^}]*}' | grep -o '"usedPercentage":[0-9.]*' | cut -d: -f2)
  
  # Extract uptime
  UPTIME=$(echo "$data" | grep -o '"uptime":"[^"]*"' | cut -d: -f2 | sed 's/"//g')
  
  echo "CPU: ${CPU}%, Memory: ${MEM}%, Uptime: ${UPTIME}"
}

# Main monitoring function
monitor_deployment() {
  local mode=$(detect_mode)
  log "INFO" "Starting deployment monitoring for ${ENV} environment (${mode} mode)"
  log "INFO" "Monitoring tag: ${TAG}, Duration: ${DURATION}s, Interval: ${CHECK_INTERVAL}s"
  
  local start_time=$(date +%s)
  local end_time=$((start_time + DURATION))
  local current_time=$start_time
  local healthy_streak=0
  local unhealthy_streak=0
  
  # Initial check
  log "INFO" "Performing initial deployment check..."
  
  # Main monitoring loop
  while [ $current_time -lt $end_time ]; do
    # Check if deployment is healthy
    if is_deployment_healthy "$mode"; then
      healthy_streak=$((healthy_streak+1))
      unhealthy_streak=0
      
      # Get health data for more details
      HEALTH_DATA=$(get_health_data)
      METRICS=$(format_metrics "$HEALTH_DATA")
      
      log "SUCCESS" "Deployment healthy ($healthy_streak consecutive checks) - $METRICS"
      
      # Get more detailed metrics
      if [ $((healthy_streak % 10)) -eq 0 ]; then
        log "INFO" "Collecting detailed metrics..."
        get_container_metrics "$mode" "$ENV" >> "$LOG_FILE" 2>&1
      fi
      
      # If stable for a while and not in background, notify
      if [ $healthy_streak -eq 10 ] && [ "$BACKGROUND" = false ]; then
        echo -e "\n${GREEN}${BOLD}✓ Deployment is stable and healthy!${NC}\n"
      fi
    else
      unhealthy_streak=$((unhealthy_streak+1))
      healthy_streak=0
      
      # Get detailed metrics when unhealthy
      if [ $unhealthy_streak -eq 1 ]; then
        get_container_metrics "$mode" "$ENV" >> "$LOG_FILE" 2>&1
      fi
      
      log "WARN" "Deployment unhealthy ($unhealthy_streak consecutive checks)"
      
      # Critical warning for consecutive failures
      if [ $unhealthy_streak -eq 5 ]; then
        log "ERROR" "Deployment may be failing! Check logs for details."
        
        if [ "$BACKGROUND" = false ]; then
          echo -e "\n${RED}${BOLD}! Critical: Deployment may be failing${NC}\n"
        fi
        
        # For background mode, could send notification here
      fi
    fi
    
    # Sleep for the check interval
    sleep $CHECK_INTERVAL
    current_time=$(date +%s)
  done
  
  # Final status
  if [ $healthy_streak -gt $unhealthy_streak ]; then
    log "SUCCESS" "Monitoring completed: Deployment is healthy (${healthy_streak}/${DURATION}s)"
    return 0
  else
    log "ERROR" "Monitoring completed: Deployment has issues (${unhealthy_streak}/${DURATION}s)"
    return 1
  fi
}

# If background mode, detach
if [ "$BACKGROUND" = true ]; then
  # Redirect stdout/stderr to log file and run in background
  nohup "$0" --env="$ENV" --tag="$TAG" --duration="$DURATION" --interval="$CHECK_INTERVAL" --output="$LOG_FILE" > /dev/null 2>&1 &
  echo "Monitoring started in background. PID: $!"
  echo "Log file: $LOG_FILE"
  exit 0
else
  # Run monitoring in foreground
  monitor_deployment
  exit $?
fi
