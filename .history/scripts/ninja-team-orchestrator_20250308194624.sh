#!/bin/bash
#
# Ninja Team Orchestrator
# Master script that coordinates the specialized ninja team members for deployment
# Each ninja has a specific role in the deployment process

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

# Deployment configuration
DEPLOYMENT_ID="ninja-$(date +%Y%m%d%H%M%S)"
LOGS_DIR="logs/ninja-deployment"
CONFIG_DIR="deploy/ninja-config"
NINJA_TEAM_BASE="scripts/ninja-team"
ENV="production"
TAG="latest"
MODE="swarm"

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
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --env=ENV        Target environment (production, staging, development)"
      echo "  --tag=TAG        Docker image tag to deploy"
      echo "  --mode=MODE      Deployment mode (swarm, compose, k8s)"
      echo "  --help           Display this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Make sure logs directory exists
mkdir -p "${LOGS_DIR}/${ENV}"
LOG_FILE="${LOGS_DIR}/${ENV}/${DEPLOYMENT_ID}.log"
TEAM_CONFIG="${CONFIG_DIR}/team-config.json"

# Banner
echo -e "${BLUE}${BOLD}"
echo "╔═════════════════════════════════════════════════════════════╗"
echo "║           NINJA TEAM DEPLOYMENT SYSTEM                      ║"
echo "║           Coordinated Deployment Framework                  ║"
echo "╚═════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${YELLOW}Deployment ID:${NC} ${DEPLOYMENT_ID}"
echo -e "${YELLOW}Environment:${NC} ${ENV}"
echo -e "${YELLOW}Tag:${NC} ${TAG}"
echo -e "${YELLOW}Mode:${NC} ${MODE}"
echo -e "${YELLOW}Log File:${NC} ${LOG_FILE}"
echo

# Initialize the master log
log() {
  local role=$1
  local message=$2
  local level=${3:-"INFO"}
  local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
  
  echo -e "[${timestamp}] [${level}] [${role}] ${message}" | tee -a "$LOG_FILE"
}

log "Orchestrator" "Starting Ninja Team deployment process" "INFO"

# Make sure team config directory exists
mkdir -p "$CONFIG_DIR"

# Create team config if it doesn't exist
if [ ! -f "$TEAM_CONFIG" ]; then
  log "Orchestrator" "Creating default team configuration" "INFO"
  
  # Default ninja team configuration
  cat > "$TEAM_CONFIG" << EOF
{
  "team": [
    {
      "name": "Scout",
      "script": "ninja-scout.sh",
      "description": "Analyzes environment and infrastructure",
      "enabled": true,
      "timeout": 300,
      "order": 1
    },
    {
      "name": "Builder",
      "script": "ninja-builder.sh",
      "description": "Builds and packages application",
      "enabled": true,
      "timeout": 600,
      "order": 2
    },
    {
      "name": "Deployer",
      "script": "ninja-deployer.sh",
      "description": "Handles actual deployment",
      "enabled": true,
      "timeout": 900,
      "order": 3
    },
    {
      "name": "Monitor",
      "script": "ninja-monitor.sh",
      "description": "Monitors deployment health",
      "enabled": true,
      "timeout": 300,
      "order": 4
    },
    {
      "name": "Guardian",
      "script": "ninja-guardian.sh",
      "description": "Handles security and cleanup",
      "enabled": true,
      "timeout": 300,
      "order": 5
    }
  ],
  "strategies": {
    "production": {
      "health_check_retries": 20,
      "rollback_enabled": true,
      "verification_required": true,
      "notify_on_success": true,
      "notify_on_failure": true
    },
    "staging": {
      "health_check_retries": 10,
      "rollback_enabled": true,
      "verification_required": true,
      "notify_on_success": false,
      "notify_on_failure": true
    },
    "development": {
      "health_check_retries": 5,
      "rollback_enabled": false,
      "verification_required": false,
      "notify_on_success": false,
      "notify_on_failure": false
    }
  }
}
EOF
fi

# Load team configuration
TEAM_CONFIG_JSON=$(cat "$TEAM_CONFIG")

# Extract team members from config
TEAM_MEMBERS=$(echo "$TEAM_CONFIG_JSON" | jq -r '.team | sort_by(.order) | .[] | select(.enabled == true) | .name')
TEAM_COUNT=$(echo "$TEAM_MEMBERS" | wc -l)

log "Orchestrator" "Loading team of $TEAM_COUNT ninjas" "INFO"
echo "$TEAM_MEMBERS" | while read ninja; do
  log "Orchestrator" "Activated $ninja" "INFO"
done

# Prepare shared environment file for ninjas
NINJA_ENV_FILE="${LOGS_DIR}/${ENV}/ninja-env-${DEPLOYMENT_ID}.sh"

# Create environment file with deployment settings
cat > "$NINJA_ENV_FILE" << EOF
#!/bin/bash
# Ninja Team shared environment variables
# Generated for deployment ${DEPLOYMENT_ID}

# Deployment settings
export DEPLOYMENT_ID="${DEPLOYMENT_ID}"
export DEPLOY_ENV="${ENV}"
export DEPLOY_TAG="${TAG}"
export DEPLOY_MODE="${MODE}"
export DEPLOY_LOG="${LOG_FILE}"
export TEAM_CONFIG='${TEAM_CONFIG_JSON}'

# Generate timestamp
timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

# Shared logging function
ninja_log() {
  local role=\$1
  local message=\$2
  local level=\${3:-"INFO"}
  local color="\033[0m"
  
  case \$role in
    "Scout") color="\033[0;36m" ;;
    "Builder") color="\033[0;33m" ;;
    "Deployer") color="\033[0;32m" ;;
    "Monitor") color="\033[0;35m" ;;
    "Guardian") color="\033[0;31m" ;;
    *) color="\033[0;34m" ;;
  esac
  
  echo -e "\${color}[\$(timestamp)] [\$level] [\$role]\033[0m \$message" | tee -a "${LOG_FILE}"
}

# Shared health checking function
check_health() {
  local url=\$1
  local expected_status=\$2
  local max_retries=\$3
  local retry=0
  
  while [ \$retry -lt \$max_retries ]; do
    status_code=\$(curl -s -o /dev/null -w "%{http_code}" "\$url" || echo "failed")
    
    if [ "\$status_code" = "\$expected_status" ]; then
      return 0
    fi
    
    retry=\$((retry+1))
    sleep 5
  done
  
  return 1
}
EOF

chmod +x "$NINJA_ENV_FILE"

# Run each ninja script in sequence
OVERALL_STATUS=0
for ninja in $TEAM_MEMBERS; do
  # Get script name and timeout from config
  SCRIPT_NAME=$(echo "$TEAM_CONFIG_JSON" | jq -r ".team[] | select(.name == \"$ninja\") | .script")
  TIMEOUT=$(echo "$TEAM_CONFIG_JSON" | jq -r ".team[] | select(.name == \"$ninja\") | .timeout")
  DESCRIPTION=$(echo "$TEAM_CONFIG_JSON" | jq -r ".team[] | select(.name == \"$ninja\") | .description")
  
  # Check if script exists
  SCRIPT_PATH="${NINJA_TEAM_BASE}/${SCRIPT_NAME}"
  
  if [ ! -f "$SCRIPT_PATH" ]; then
    log "Orchestrator" "Missing ninja script: $SCRIPT_PATH" "ERROR"
    OVERALL_STATUS=1
    continue
  fi
  
  log "Orchestrator" "Dispatching $ninja ($DESCRIPTION)" "INFO"
  
  # Run the ninja script with timeout
  if timeout $TIMEOUT bash "$SCRIPT_PATH" "$NINJA_ENV_FILE"; then
    log "Orchestrator" "$ninja completed successfully" "SUCCESS"
  else
    STATUS=$?
    log "Orchestrator" "$ninja failed with status $STATUS" "ERROR"
    OVERALL_STATUS=1
    
    # Check if we should continue after failure
    CONTINUE_ON_ERROR=$(echo "$TEAM_CONFIG_JSON" | jq -r ".strategies.${ENV}.continue_on_error // false")
    
    if [ "$CONTINUE_ON_ERROR" != "true" ]; then
      log "Orchestrator" "Stopping deployment due to failure" "ERROR"
      break
    fi
  fi
done

# Final status report
if [ $OVERALL_STATUS -eq 0 ]; then
  log "Orchestrator" "Deployment completed successfully!" "SUCCESS"
  
  # Send success notification if configured
  NOTIFY_ON_SUCCESS=$(echo "$TEAM_CONFIG_JSON" | jq -r ".strategies.${ENV}.notify_on_success // false")
  
  if [ "$NOTIFY_ON_SUCCESS" = "true" ] && [ -n "$SLACK_WEBHOOK_URL" ]; then
    curl -s -X POST -H 'Content-type: application/json' --data "{
      \"text\": \"✅ Deployment completed successfully!\",
      \"attachments\": [
        {
          \"color\": \"good\",
          \"fields\": [
            {\"title\": \"Environment\", \"value\": \"${ENV}\", \"short\": true},
            {\"title\": \"Tag\", \"value\": \"${TAG}\", \"short\": true},
            {\"title\": \"Deployment ID\", \"value\": \"${DEPLOYMENT_ID}\", \"short\": true}
          ],
          \"footer\": \"Ninja Team Deployment\",
          \"ts\": $(date +%s)
        }
      ]
    }" $SLACK_WEBHOOK_URL > /dev/null
  fi
  
  exit 0
else
  log "Orchestrator" "Deployment failed!" "ERROR"
  
  # Send failure notification if configured
  NOTIFY_ON_FAILURE=$(echo "$TEAM_CONFIG_JSON" | jq -r ".strategies.${ENV}.notify_on_failure // true")
  
  if [ "$NOTIFY_ON_FAILURE" = "true" ] && [ -n "$SLACK_WEBHOOK_URL" ]; then
    curl -s -X POST -H 'Content-type: application/json' --data "{
      \"text\": \"❌ Deployment failed!\",
      \"attachments\": [
        {
          \"color\": \"danger\",
          \"fields\": [
            {\"title\": \"Environment\", \"value\": \"${ENV}\", \"short\": true},
            {\"title\": \"Tag\", \"value\": \"${TAG}\", \"short\": true}, 
            {\"title\": \"Deployment ID\", \"value\": \"${DEPLOYMENT_ID}\", \"short\": true},
            {\"title\": \"Log\", \"value\": \"${LOG_FILE}\", \"short\": false}
          ],
          \"footer\": \"Ninja Team Deployment\",
          \"ts\": $(date +%s)
        }
      ]
    }" $SLACK_WEBHOOK_URL > /dev/null
  fi
  
  exit 1
fi
