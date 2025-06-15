#!/bin/bash
#
# Ninja Team System Setup Script
# Sets up the entire ninja team deployment infrastructure

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}${BOLD}"
echo "╔═════════════════════════════════════════════════════════════════╗"
echo "║           NINJA TEAM DEPLOYMENT SYSTEM SETUP                    ║"
echo "║      High-Performance Deployment Framework Installation         ║"
echo "╚═════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Default setup configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
NINJA_TEAM_DIR="$SCRIPT_DIR/ninja-team"
CONFIG_DIR="$REPO_ROOT/deploy/ninja-config"
LOG_DIR="$REPO_ROOT/logs/ninja-deployment"
DEFAULT_ENV="production"

# Required tools
REQUIRED_TOOLS=("docker" "jq" "curl" "npm")

# Parse arguments
ADVANCED_SETUP=false
FORCE_SETUP=false
SKIP_DEPS=false
TARGET_ENV="$DEFAULT_ENV"

while [[ $# -gt 0 ]]; do
  case $1 in
    --advanced)
      ADVANCED_SETUP=true
      shift
      ;;
    --force)
      FORCE_SETUP=true
      shift
      ;;
    --skip-dependencies)
      SKIP_DEPS=true
      shift
      ;;
    --env=*)
      TARGET_ENV="${1#*=}"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --advanced           Enable advanced setup with additional features"
      echo "  --force              Force reinstallation of existing components"
      echo "  --skip-dependencies  Skip dependency installation"
      echo "  --env=ENV            Target environment (default: production)"
      echo "  --help, -h           Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Check for required tools
check_requirements() {
  echo -e "${YELLOW}Checking for required tools...${NC}"
  local missing_tools=0

  for tool in "${REQUIRED_TOOLS[@]}"; do
    if ! command -v "$tool" &>/dev/null; then
      echo -e "${RED}✗ Missing required tool: $tool${NC}"
      missing_tools=$((missing_tools + 1))
    else
      echo -e "${GREEN}✓ Found tool: $tool${NC}"
    fi
  done

  # Check for optional but recommended tools
  if ! command -v yq &>/dev/null; then
    echo -e "${YELLOW}⚠️ Optional tool 'yq' not found. Some features may be limited.${NC}"
  else
    echo -e "${GREEN}✓ Found tool: yq${NC}"
  fi

  if [ $missing_tools -gt 0 ]; then
    echo -e "${RED}Error: Missing required tools. Please install them before proceeding.${NC}"
    exit 1
  fi
}

# Create directory structure
create_directory_structure() {
  echo -e "${YELLOW}Creating ninja team directory structure...${NC}"
  
  # Create necessary directories
  mkdir -p "$NINJA_TEAM_DIR"
  mkdir -p "$CONFIG_DIR"
  mkdir -p "$LOG_DIR/$TARGET_ENV"
  mkdir -p "$REPO_ROOT/build/ninja-scout/$TARGET_ENV"
  mkdir -p "$REPO_ROOT/build/ninja-builder/$TARGET_ENV"
  mkdir -p "$REPO_ROOT/build/ninja-deployer/$TARGET_ENV"
  mkdir -p "$REPO_ROOT/build/ninja-monitor/$TARGET_ENV"
  mkdir -p "$REPO_ROOT/build/ninja-guardian/$TARGET_ENV"
  mkdir -p "$REPO_ROOT/backups/$TARGET_ENV"
  mkdir -p "$REPO_ROOT/deploy/manifests"
  
  echo -e "${GREEN}Directory structure created successfully${NC}"
}

# Install required dependencies (skip if using --skip-dependencies)
install_dependencies() {
  if [ "$SKIP_DEPS" = true ]; then
    echo -e "${YELLOW}Skipping dependency installation as requested${NC}"
    return 0
  fi

  echo -e "${YELLOW}Installing required dependencies...${NC}"

  # Install node dependencies for scripts
  if [ -f "$REPO_ROOT/package.json" ]; then
    npm install --no-save jq madge eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
  fi
  
  # Install yq if not present and we're in advanced mode
  if [ "$ADVANCED_SETUP" = true ] && ! command -v yq &>/dev/null; then
    echo -e "${YELLOW}Installing yq for YAML processing...${NC}"
    if command -v pip3 &>/dev/null; then
      pip3 install yq
    elif command -v brew &>/dev/null; then
      brew install yq
    else
      echo -e "${YELLOW}Could not install yq. Please install manually for full functionality.${NC}"
    fi
  fi
  
  echo -e "${GREEN}Dependencies installed successfully${NC}"
}

# Make sure all ninja scripts are executable
ensure_executable_scripts() {
  echo -e "${YELLOW}Making ninja scripts executable...${NC}"
  
  # Make orchestrator executable
  chmod +x "$SCRIPT_DIR/ninja-team-orchestrator.sh"
  chmod +x "$SCRIPT_DIR/deploy-ninja-team.sh"
  chmod +x "$SCRIPT_DIR/monitor-deployment.sh"
  chmod +x "$SCRIPT_DIR/ninja-scan.sh"
  
  # Make all ninja team scripts executable
  if [ -d "$NINJA_TEAM_DIR" ]; then
    find "$NINJA_TEAM_DIR" -name "*.sh" -exec chmod +x {} \;
  fi
  
  echo -e "${GREEN}Scripts are now executable${NC}"
}

# Create default configuration files if they don't exist
create_default_configs() {
  echo -e "${YELLOW}Creating default configuration files...${NC}"
  
  # Team configuration
  TEAM_CONFIG="$CONFIG_DIR/team-config.json"
  if [ ! -f "$TEAM_CONFIG" ] || [ "$FORCE_SETUP" = true ]; then
    echo -e "${CYAN}Creating team configuration...${NC}"
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
      "notify_on_failure": true,
      "continue_on_error": false
    },
    "staging": {
      "health_check_retries": 10,
      "rollback_enabled": true,
      "verification_required": true,
      "notify_on_success": false,
      "notify_on_failure": true,
      "continue_on_error": true
    },
    "development": {
      "health_check_retries": 5,
      "rollback_enabled": false,
      "verification_required": false,
      "notify_on_success": false,
      "notify_on_failure": false,
      "continue_on_error": true
    }
  }
}
EOF
  fi
  
  # Environment manifest config
  ENV_CONFIG="$REPO_ROOT/deploy/manifests/$TARGET_ENV.yaml"
  if [ ! -f "$ENV_CONFIG" ] || [ "$FORCE_SETUP" = true ]; then
    echo -e "${CYAN}Creating environment configuration for $TARGET_ENV...${NC}"
    cat > "$ENV_CONFIG" << EOF
name: $TARGET_ENV
description: $TARGET_ENV environment for Documind
infrastructure:
  domain: documind.${TARGET_ENV}.example.com
deployment:
  strategy: $([ "$TARGET_ENV" = "production" ] && echo "blue-green" || echo "rolling")
  replicas: $([ "$TARGET_ENV" = "production" ] && echo "3" || echo "1")
  recursive: $([ "$TARGET_ENV" = "production" ] && echo "2" || echo "1")
  update_config:
    parallelism: 1
    delay: $([ "$TARGET_ENV" = "production" ] && echo "30s" || echo "10s")
    order: start-first
  rollback:
    automatic: true
    monitor_seconds: 60
  resources:
    cpu_limit: $([ "$TARGET_ENV" = "production" ] && echo "2" || echo "1")
    memory_limit: $([ "$TARGET_ENV" = "production" ] && echo "2Gi" || echo "1Gi")
EOF
  fi
  
  # Create recursive deployment targets config
  if [ "$ADVANCED_SETUP" = true ]; then
    TARGETS_CONFIG="$CONFIG_DIR/targets.json"
    if [ ! -f "$TARGETS_CONFIG" ] || [ "$FORCE_SETUP" = true ]; then
      echo -e "${CYAN}Creating recursive deployment targets configuration...${NC}"
      cat > "$TARGETS_CONFIG" << EOF
{
  "production": [
    "app-server-1.example.com",
    "app-server-2.example.com",
    "app-server-3.example.com"
  ],
  "staging": [
    "staging-server.example.com"
  ],
  "development": []
}
EOF
    fi
  fi
  
  echo -e "${GREEN}Configuration files created successfully${NC}"
}

# Create a sample CI/CD integration file
create_ci_cd_integration() {
  if [ "$ADVANCED_SETUP" = true ]; then
    echo -e "${YELLOW}Creating CI/CD integration files...${NC}"
    
    # Create GitHub Actions workflow
    GITHUB_WORKFLOW_DIR="$REPO_ROOT/.github/workflows"
    mkdir -p "$GITHUB_WORKFLOW_DIR"
    
    WORKFLOW_FILE="$GITHUB_WORKFLOW_DIR/ninja-deploy.yml"
    if [ ! -f "$WORKFLOW_FILE" ] || [ "$FORCE_SETUP" = true ]; then
      echo -e "${CYAN}Creating GitHub Actions workflow for Ninja Team deployment...${NC}"
      cat > "$WORKFLOW_FILE" << EOF
name: Ninja Team Deployment

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'staging'
        type: choice
        options:
          - production
          - staging
          - development
      tag:
        description: 'Docker image tag'
        required: true
        default: 'latest'
      mode:
        description: 'Deployment mode'
        required: true
        default: 'compose'
        type: choice
        options:
          - swarm
          - compose
          - k8s
          - auto

jobs:
  deploy:
    name: Deploy with Ninja Team
    runs-on: ubuntu-latest
    environment: \${{ inputs.environment }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        
      - name: Setup environment
        run: |
          chmod +x ./scripts/*.sh
          chmod +x ./scripts/ninja-team/*.sh
          mkdir -p logs/ninja-deployment/\${{ inputs.environment }}
          
      - name: Run security scan
        run: |
          ./scripts/ninja-scan.sh --env=\${{ inputs.environment }} --quick
        continue-on-error: true
        
      - name: Deploy with Ninja Team
        run: |
          ./scripts/deploy-ninja-team.sh --env=\${{ inputs.environment }} --tag=\${{ inputs.tag }} --mode=\${{ inputs.mode }} --yes
          
      - name: Upload deployment logs
        uses: actions/upload-artifact@v3
        with:
          name: deployment-logs
          path: logs/ninja-deployment/\${{ inputs.environment }}
          retention-days: 7
EOF
    fi

    # Create a convenience script to run from deployment servers
    AUTO_DEPLOY_SCRIPT="$SCRIPT_DIR/auto-deploy.sh"
    if [ ! -f "$AUTO_DEPLOY_SCRIPT" ] || [ "$FORCE_SETUP" = true ]; then
      echo -e "${CYAN}Creating automated deployment script...${NC}"
      cat > "$AUTO_DEPLOY_SCRIPT" << EOF
#!/bin/bash
#
# Ninja Team Auto-Deployment
# Simplified script for automated deployments from CI/CD systems

set -eo pipefail

# Default settings
ENV="\${DEPLOY_ENV:-production}"
TAG="\${DEPLOY_TAG:-latest}"
MODE="\${DEPLOY_MODE:-auto}"

# Run the deployment
echo "Starting automated Ninja Team deployment to \$ENV (tag: \$TAG, mode: \$MODE)"
cd "\$(dirname "\$(dirname "\${BASH_SOURCE[0]}")")"
bash scripts/deploy-ninja-team.sh --env="\$ENV" --tag="\$TAG" --mode="\$MODE" --yes
EOF
      chmod +x "$AUTO_DEPLOY_SCRIPT"
    fi
    
    echo -e "${GREEN}CI/CD integration files created successfully${NC}"
  fi
}

# Create a crontab entry for scheduled deployments
setup_cron_jobs() {
  if [ "$ADVANCED_SETUP" = true ]; then
    echo -e "${YELLOW}Setting up scheduled deployment cron jobs...${NC}"
    
    # Create a crontab template file
    CRON_TEMPLATE="$CONFIG_DIR/crontab.template"
    if [ ! -f "$CRON_TEMPLATE" ] || [ "$FORCE_SETUP" = true ]; then
      echo -e "${CYAN}Creating crontab template...${NC}"
      cat > "$CRON_TEMPLATE" << EOF
# Ninja Team automated deployment cron jobs

# Run nightly deployment to staging environment
0 2 * * * cd $REPO_ROOT && bash scripts/deploy-ninja-team.sh --env=staging --yes > logs/cron-deploy-staging-\$(date +\%Y\%m\%d).log 2>&1

# Run security scan every day at 1 AM
0 1 * * * cd $REPO_ROOT && bash scripts/ninja-scan.sh --env=production > logs/security-scan-\$(date +\%Y\%m\%d).log 2>&1

# Cleanup old logs and backups weekly (Sunday at 3 AM)
0 3 * * 0 cd $REPO_ROOT && find logs -name "*.log" -type f -mtime +30 -delete && find backups -path "*/staging/*" -type d -mtime +14 -exec rm -rf {} \; 2>/dev/null || true
EOF
    fi
    
    echo -e "${GREEN}Cron job templates created at $CRON_TEMPLATE${NC}"
    echo -e "${YELLOW}To install cron jobs, run: crontab $CRON_TEMPLATE${NC}"
  fi
}

# Main setup function
main() {
  echo -e "${CYAN}Starting Ninja Team setup...${NC}"
  
  # Check for required tools
  check_requirements
  
  # Create directory structure
  create_directory_structure
  
  # Install dependencies
  install_dependencies
  
  # Make scripts executable
  ensure_executable_scripts
  
  # Create default configs
  create_default_configs
  
  # Setup CI/CD integration
  create_ci_cd_integration
  
  # Setup cron jobs
  setup_cron_jobs
  
  echo -e "${GREEN}${BOLD}Ninja Team setup completed successfully!${NC}"
  echo -e "${CYAN}You can now deploy using:${NC}"
  echo -e "  ${YELLOW}./scripts/deploy-ninja-team.sh --env=$TARGET_ENV${NC}"
  
  if [ "$ADVANCED_SETUP" = true ]; then
    echo -e "${CYAN}Advanced features enabled:${NC}"
    echo -e "  • CI/CD integration with GitHub Actions"
    echo -e "  • Recursive deployment configuration"
    echo -e "  • Scheduled deployment templates"
    echo -e "  • Blue-Green deployment strategy for production"
  fi
}

# Run main setup function
main
