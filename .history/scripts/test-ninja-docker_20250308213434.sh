#!/bin/bash
#
# Test Ninja Team in Docker
# Sets up a Docker environment and runs a test deployment with the ninja team

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
echo "║           NINJA TEAM DOCKER TEST ENVIRONMENT                    ║"
echo "║                   Deployment System Test                        ║"
echo "╚═════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Default settings
TEST_ENV="docker-test"
TAG="ninja-test"
COMPOSE_FILE="docker/docker-compose.test.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
NINJA_PACKAGE_DIR="$REPO_ROOT/build/ninja-package"

# Check Docker is installed
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
  exit 1
fi

# Ensure Docker Compose is available
if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
  echo -e "${RED}Error: Neither docker-compose nor docker compose plugin is available${NC}"
  exit 1
fi

# Determine Docker Compose command
if command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  COMPOSE_CMD="docker compose"
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --env=*)
      TEST_ENV="${1#*=}"
      shift
      ;;
    --tag=*)
      TAG="${1#*=}"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --env=ENV     Test environment name (default: docker-test)"
      echo "  --tag=TAG     Docker image tag to use (default: ninja-test)"
      echo "  --help, -h    Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Step 1: Compile the Ninja Team scripts
echo -e "\n${CYAN}Step 1: Compiling Ninja Team scripts${NC}"
mkdir -p "$REPO_ROOT/build"

if [ ! -f "$SCRIPT_DIR/compile-ninja-team.sh" ]; then
  echo -e "${RED}Error: compile-ninja-team.sh script not found${NC}"
  exit 1
fi

bash "$SCRIPT_DIR/compile-ninja-team.sh" --force --package
if [ ! -d "$NINJA_PACKAGE_DIR" ]; then
  echo -e "${RED}Error: Ninja package directory was not created${NC}"
  exit 1
fi

echo -e "${GREEN}Ninja Team scripts compiled successfully${NC}"

# Step 2: Create a test Docker Compose file if it doesn't exist
if [ ! -f "$REPO_ROOT/$COMPOSE_FILE" ]; then
  echo -e "\n${CYAN}Step 2: Creating test Docker Compose file${NC}"
  mkdir -p "$(dirname "$REPO_ROOT/$COMPOSE_FILE")"
  
  cat > "$REPO_ROOT/$COMPOSE_FILE" << EOF
version: '3.8'

services:
  app:
    image: documind:${TAG}
    build:
      context: ..
      dockerfile: docker/Dockerfile
      args:
        - NODE_ENV=development
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - PORT=3000
      - DB_HOST=db
      - DB_PORT=5432
      - DB_NAME=documind
      - DB_USER=postgres
      - DB_PASS=postgres
    depends_on:
      - db
    networks:
      - documind-network
    restart: unless-stopped
    
  db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_DB=documind
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - documind-network
    restart: unless-stopped

volumes:
  db-data:

networks:
  documind-network:
    driver: bridge
EOF

  echo -e "${GREEN}Created test Docker Compose file at $COMPOSE_FILE${NC}"
else
  echo -e "\n${CYAN}Step 2: Using existing Docker Compose file${NC}"
fi

# Step 3: Create a simple test app if it doesn't exist
if [ ! -f "$REPO_ROOT/src/index.ts" ]; then
  echo -e "\n${CYAN}Step 3: Creating test application${NC}"
  mkdir -p "$REPO_ROOT/src"
  
  cat > "$REPO_ROOT/src/index.ts" << EOF
import * as express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ message: 'Documind API is running' });
});

app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime().toFixed(2) + 's',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    cpu: {
      utilization: Math.floor(Math.random() * 30)
    },
    memory: {
      usedPercentage: Math.floor(Math.random() * 50)
    }
  });
});

app.listen(port, () => {
  console.log(\`Server started on port \${port}\`);
});
EOF

  # Create package.json if it doesn't exist
  if [ ! -f "$REPO_ROOT/package.json" ]; then
    cat > "$REPO_ROOT/package.json" << EOF
{
  "name": "documind",
  "version": "1.0.0",
  "description": "Documind API",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js",
    "build": "tsc",
    "test": "echo \"No tests yet\" && exit 0"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.17",
    "@types/node": "^18.16.0",
    "typescript": "^5.0.4"
  }
}
EOF
  fi

  # Create tsconfig.json if it doesn't exist
  if [ ! -f "$REPO_ROOT/tsconfig.json" ]; then
    cat > "$REPO_ROOT/tsconfig.json" << EOF
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "outDir": "dist",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
EOF
  fi

  # Create a simple Dockerfile if it doesn't exist
  if [ ! -f "$REPO_ROOT/docker/Dockerfile" ]; then
    mkdir -p "$REPO_ROOT/docker"
    cat > "$REPO_ROOT/docker/Dockerfile" << EOF
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
EOF
  fi

  echo -e "${GREEN}Created test application files${NC}"
else
  echo -e "\n${CYAN}Step 3: Using existing application files${NC}"
fi

# Step 4: Install dependencies and build the app
echo -e "\n${CYAN}Step 4: Installing dependencies and building the app${NC}"
cd "$REPO_ROOT"
npm install
npm run build
echo -e "${GREEN}Application built successfully${NC}"

# Step 5: Build the Docker image
echo -e "\n${CYAN}Step 5: Building Docker image${NC}"
docker build -t "documind:$TAG" -f "$REPO_ROOT/docker/Dockerfile" "$REPO_ROOT"
echo -e "${GREEN}Docker image built: documind:$TAG${NC}"

# Step 6: Initialize Ninja Team configuration
echo -e "\n${CYAN}Step 6: Initializing Ninja Team for Docker testing${NC}"

# Create deployment directories for docker test
mkdir -p "$REPO_ROOT/deploy/manifests"

# Create docker test manifest
cat > "$REPO_ROOT/deploy/manifests/$TEST_ENV.yaml" << EOF
name: $TEST_ENV
description: Docker test environment for Documind
infrastructure:
  domain: localhost
deployment:
  strategy: rolling
  replicas: 1
  recursive: 0
  update_config:
    parallelism: 1
    delay: 10s
    order: start-first
  rollback:
    automatic: true
    monitor_seconds: 30
  resources:
    cpu_limit: 1
    memory_limit: 512Mi
EOF

# Create ninja team config for docker test
mkdir -p "$REPO_ROOT/deploy/ninja-config"
cat > "$REPO_ROOT/deploy/ninja-config/team-config.json" << EOF
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
    "$TEST_ENV": {
      "health_check_retries": 5,
      "rollback_enabled": true,
      "verification_required": false,
      "notify_on_success": false,
      "notify_on_failure": false,
      "continue_on_error": true
    }
  }
}
EOF

# Create docker-compose file for the test environment
cat > "$REPO_ROOT/docker-compose.$TEST_ENV.yml" << EOF
version: '3.8'

services:
  app:
    image: documind:${TAG}
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - PORT=3000
    networks:
      - documind-network
    restart: unless-stopped

networks:
  documind-network:
    driver: bridge
EOF

echo -e "${GREEN}Ninja Team configured for Docker test environment${NC}"

# Step 7: Run the deployment using ninja-team
echo -e "\n${CYAN}Step 7: Running Ninja Team deployment${NC}"
echo -e "${YELLOW}Executing deployment to $TEST_ENV environment with tag $TAG...${NC}"

bash "$SCRIPT_DIR/deploy-ninja-team.sh" --env="$TEST_ENV" --tag="$TAG" --mode="compose" --yes

# Step 8: Verify the deployment
echo -e "\n${CYAN}Step 8: Verifying deployment${NC}"
echo -e "${YELLOW}Checking if the application is running...${NC}"

# Give the app a moment to start
sleep 5

# Check if the application is responding
if curl -s http://localhost:3000/api/v1/health | grep -q "healthy"; then
  echo -e "${GREEN}${BOLD}✓ Success! The test application is running.${NC}"
  
  # Show the health response
  echo -e "\n${YELLOW}Application health info:${NC}"
  curl -s http://localhost:3000/api/v1/health | jq
else
  echo -e "${RED}${BOLD}✗ Failed! The test application is not responding.${NC}"
fi

# Step 9: Monitor the deployment
echo -e "\n${CYAN}Step 9: Monitoring the deployment${NC}"
bash "$SCRIPT_DIR/monitor-deployment.sh" --env="$TEST_ENV" --duration=30 --interval=5

# Print completion message
echo -e "\n${GREEN}${BOLD}Docker test environment setup and deployment completed!${NC}"
echo -e "${CYAN}You can access the test application at:${NC} http://localhost:3000"
echo -e "${CYAN}To stop the application:${NC} $COMPOSE_CMD -f docker-compose.$TEST_ENV.yml down"
echo -e "${CYAN}To run another deployment:${NC} ./scripts/deploy-ninja-team.sh --env=$TEST_ENV --tag=$TAG --mode=compose"

exit 0
