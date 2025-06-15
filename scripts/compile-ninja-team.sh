#!/bin/bash
#
# Compile Ninja Team
# This script collects all ninja team scripts into a single folder for easier management
# and creates installation packages for deployments to other environments

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
echo "║           NINJA TEAM COMPILATION UTILITY                        ║"
echo "║         Collect All Ninja Files in One Deployment Package       ║"
echo "╚═════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Default paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE_NINJA_DIR="$SCRIPT_DIR/ninja-team"
OUTPUT_DIR="$REPO_ROOT/build/ninja-package"
CONFIG_DIR="$REPO_ROOT/deploy/ninja-config"
TARGET_VERSION="1.0.0"
CREATE_PACKAGE=false
INCLUDE_CONFIG=true
FORCE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --output=*)
      OUTPUT_DIR="${1#*=}"
      shift
      ;;
    --version=*)
      TARGET_VERSION="${1#*=}"
      shift
      ;;
    --package)
      CREATE_PACKAGE=true
      shift
      ;;
    --no-config)
      INCLUDE_CONFIG=false
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --output=DIR      Output directory (default: build/ninja-package)"
      echo "  --version=X.Y.Z   Version number for the package (default: 1.0.0)"
      echo "  --package         Create a distributable package (.tar.gz)"
      echo "  --no-config       Exclude configuration files"
      echo "  --force           Overwrite existing files"
      echo "  --help, -h        Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Check if output directory exists
if [ -d "$OUTPUT_DIR" ] && [ "$FORCE" != true ]; then
  echo -e "${YELLOW}Output directory already exists: $OUTPUT_DIR${NC}"
  echo -e "${YELLOW}Use --force to overwrite or specify a different directory with --output=${NC}"
  exit 1
fi

# Create output directories
echo -e "${CYAN}Creating output directories...${NC}"
mkdir -p "$OUTPUT_DIR/scripts/ninja-team"
mkdir -p "$OUTPUT_DIR/deploy/ninja-config"
mkdir -p "$OUTPUT_DIR/deploy/manifests"
mkdir -p "$OUTPUT_DIR/logs/ninja-deployment"
mkdir -p "$OUTPUT_DIR/build"
mkdir -p "$OUTPUT_DIR/backups"

# Copy ninja team scripts
echo -e "${CYAN}Collecting ninja team scripts...${NC}"

# Core ninja scripts from ninja-team directory
if [ -d "$SOURCE_NINJA_DIR" ]; then
  cp "$SOURCE_NINJA_DIR/"*.sh "$OUTPUT_DIR/scripts/ninja-team/" 2>/dev/null || true
  
  # Count copied ninja scripts
  NINJA_COUNT=$(ls -1 "$OUTPUT_DIR/scripts/ninja-team/" | wc -l)
  echo -e "${GREEN}Copied $NINJA_COUNT ninja team scripts${NC}"
else
  echo -e "${YELLOW}Warning: Ninja team directory not found: $SOURCE_NINJA_DIR${NC}"
  echo -e "${YELLOW}Creating empty directory for ninjas${NC}"
  mkdir -p "$OUTPUT_DIR/scripts/ninja-team"
fi

# Copy orchestration and utility scripts
echo -e "${CYAN}Collecting orchestration scripts...${NC}"
ORCHESTRATION_SCRIPTS=(
  "ninja-team-orchestrator.sh"
  "deploy-ninja-team.sh"
  "monitor-deployment.sh"
  "ninja-scan.sh"
  "auto-deploy.sh"
  "setup-ninja-team.sh"
)

for script in "${ORCHESTRATION_SCRIPTS[@]}"; do
  if [ -f "$SCRIPT_DIR/$script" ]; then
    cp "$SCRIPT_DIR/$script" "$OUTPUT_DIR/scripts/" 
    echo -e "${GREEN}Copied $script${NC}"
  else
    echo -e "${YELLOW}Warning: Script not found: $script${NC}"
  fi
done

# Copy configuration files
if [ "$INCLUDE_CONFIG" = true ]; then
  echo -e "${CYAN}Collecting configuration files...${NC}"
  
  # Copy team config
  if [ -f "$CONFIG_DIR/team-config.json" ]; then
    cp "$CONFIG_DIR/team-config.json" "$OUTPUT_DIR/deploy/ninja-config/"
    echo -e "${GREEN}Copied team configuration${NC}"
  else
    echo -e "${YELLOW}Warning: Team configuration not found${NC}"
    
    # Create default team config
    echo -e "${YELLOW}Creating default team configuration...${NC}"
    cat > "$OUTPUT_DIR/deploy/ninja-config/team-config.json" << EOF
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
  
  # Copy environment manifests
  MANIFEST_DIR="$REPO_ROOT/deploy/manifests"
  if [ -d "$MANIFEST_DIR" ]; then
    cp "$MANIFEST_DIR/"*.yaml "$OUTPUT_DIR/deploy/manifests/" 2>/dev/null || true
    MANIFEST_COUNT=$(ls -1 "$OUTPUT_DIR/deploy/manifests/" | wc -l)
    if [ $MANIFEST_COUNT -gt 0 ]; then
      echo -e "${GREEN}Copied $MANIFEST_COUNT environment manifests${NC}"
    else
      echo -e "${YELLOW}No environment manifests found${NC}"
    fi
  fi
  
  # Copy recursive deployment targets
  if [ -f "$CONFIG_DIR/targets.json" ]; then
    cp "$CONFIG_DIR/targets.json" "$OUTPUT_DIR/deploy/ninja-config/"
    echo -e "${GREEN}Copied deployment targets configuration${NC}"
  fi
  
  # Copy any other configuration files
  for config_file in "$CONFIG_DIR"/*.json "$CONFIG_DIR"/*.yaml "$CONFIG_DIR"/*.yml; do
    if [ -f "$config_file" ]; then
      cp "$config_file" "$OUTPUT_DIR/deploy/ninja-config/" 2>/dev/null || true
    fi
  done
fi

# Copy CMake integration if exists
if [ -f "$REPO_ROOT/ninja-team.cmake" ]; then
  cp "$REPO_ROOT/ninja-team.cmake" "$OUTPUT_DIR/"
  echo -e "${GREEN}Copied CMake integration${NC}"
fi

# Make all scripts executable
echo -e "${CYAN}Making scripts executable...${NC}"
chmod +x "$OUTPUT_DIR/scripts/"*.sh
chmod +x "$OUTPUT_DIR/scripts/ninja-team/"*.sh

# Create a simple README with instructions
echo -e "${CYAN}Creating documentation...${NC}"
cat > "$OUTPUT_DIR/README.md" << EOF
# Ninja Team Deployment System

Version: ${TARGET_VERSION}
Generated on: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

## Directory Structure

- \`scripts/ninja-team/\` - Individual ninja scripts
- \`scripts/\` - Orchestration and utility scripts
- \`deploy/\` - Configuration and deployment manifests
- \`logs/\` - Deployment logs
- \`backups/\` - Backup storage
- \`build/\` - Build artifacts

## Quick Start

1. **Install** the system (if not already installed):
   \`\`\`
   ./scripts/setup-ninja-team.sh
   \`\`\`

2. **Deploy** to an environment:
   \`\`\`
   ./scripts/deploy-ninja-team.sh --env=production --tag=latest
   \`\`\`

3. **Monitor** a deployment:
   \`\`\`
   ./scripts/monitor-deployment.sh --env=production --duration=600
   \`\`\`

4. **Scan** for security issues:
   \`\`\`
   ./scripts/ninja-scan.sh --env=production
   \`\`\`

## Available Ninjas

- **Scout**: Analyzes environment and infrastructure
- **Builder**: Builds deployment artifacts
- **Deployer**: Deploys the application
- **Monitor**: Monitors deployment health
- **Guardian**: Handles security and cleanup

## Configuration

The main configuration file is \`deploy/ninja-config/team-config.json\`.
Environment-specific configuration is in \`deploy/manifests/\`.

## License

Copyright (c) 2023 Documind Team
EOF

# Create a installation script
echo -e "${CYAN}Creating installation script...${NC}"
cat > "$OUTPUT_DIR/install-ninja-team.sh" << EOF
#!/bin/bash
#
# Ninja Team Installation Script
# Installs the ninja team deployment system to target location

set -eo pipefail

# Default target
TARGET_DIR="\$(pwd)"
FORCE=false

# Parse arguments
while [[ \$# -gt 0 ]]; do
  case \$1 in
    --target=*)
      TARGET_DIR="\${1#*=}"
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --help|-h)
      echo "Usage: \$0 [OPTIONS]"
      echo "Options:"
      echo "  --target=DIR   Target installation directory (default: current directory)"
      echo "  --force        Force installation even if directories exist"
      echo "  --help, -h     Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: \$1"
      exit 1
      ;;
  esac
done

# Create directories
echo "Creating directories..."
mkdir -p "\$TARGET_DIR/scripts"
mkdir -p "\$TARGET_DIR/scripts/ninja-team"
mkdir -p "\$TARGET_DIR/deploy/ninja-config"
mkdir -p "\$TARGET_DIR/deploy/manifests"
mkdir -p "\$TARGET_DIR/logs/ninja-deployment"
mkdir -p "\$TARGET_DIR/build"
mkdir -p "\$TARGET_DIR/backups"

# Copy files
echo "Copying ninja team files..."
cp -r scripts/* "\$TARGET_DIR/scripts/"
cp -r deploy/* "\$TARGET_DIR/deploy/"

# Copy README and other root files
if [ -f "README.md" ]; then
  cp README.md "\$TARGET_DIR/"
fi
if [ -f "ninja-team.cmake" ]; then
  cp ninja-team.cmake "\$TARGET_DIR/"
fi

# Make scripts executable
chmod +x "\$TARGET_DIR/scripts/"*.sh
chmod +x "\$TARGET_DIR/scripts/ninja-team/"*.sh

echo "Ninja Team installation complete!"
echo "You can now run: \$TARGET_DIR/scripts/deploy-ninja-team.sh --help"
EOF

chmod +x "$OUTPUT_DIR/install-ninja-team.sh"

# Create distributable package if requested
if [ "$CREATE_PACKAGE" = true ]; then
  echo -e "${CYAN}Creating distributable package...${NC}"
  PACKAGE_NAME="ninja-team-${TARGET_VERSION}.tar.gz"
  PACKAGE_PATH="$REPO_ROOT/build/$PACKAGE_NAME"
  
  # Change to output directory to create archive with relative paths
  CURRENT_DIR=$(pwd)
  cd "$OUTPUT_DIR"
  tar -czf "$PACKAGE_PATH" .
  cd "$CURRENT_DIR"
  
  echo -e "${GREEN}Package created: $PACKAGE_PATH${NC}"
fi

# Create a small utility script to run the team
echo -e "${CYAN}Creating quick-deploy utility...${NC}"
cat > "$OUTPUT_DIR/deploy-ninjas.sh" << EOF
#!/bin/bash
#
# Quick Deploy with Ninja Team
# Simple wrapper to deploy using the ninja team system

# Default settings
ENV="production"
TAG="latest"
MODE="auto"

# Parse arguments
if [ "\$1" = "production" ] || [ "\$1" = "staging" ] || [ "\$1" = "development" ]; then
  ENV="\$1"
  shift
fi

if [ -n "\$1" ]; then
  TAG="\$1"
  shift
fi

if [ -n "\$1" ]; then
  MODE="\$1"
  shift
fi

# Run the deploy script
./scripts/deploy-ninja-team.sh --env="\$ENV" --tag="\$TAG" --mode="\$MODE" "\$@"
EOF
chmod +x "$OUTPUT_DIR/deploy-ninjas.sh"

echo -e "${GREEN}${BOLD}Ninja team compilation completed!${NC}"
echo -e "${GREEN}All ninja team files collected in: $OUTPUT_DIR${NC}"
echo
echo -e "${CYAN}To deploy the ninja team:${NC}"
echo -e "  cd \"$OUTPUT_DIR\" && ./deploy-ninjas.sh [environment] [tag]"
echo
echo -e "${CYAN}To install in another location:${NC}"
echo -e "  $OUTPUT_DIR/install-ninja-team.sh --target=/path/to/destination"

exit 0
