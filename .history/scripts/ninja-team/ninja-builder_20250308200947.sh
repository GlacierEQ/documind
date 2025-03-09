#!/bin/bash
#
# Ninja Builder
# Builds application artifacts and prepares for deployment

set -eo pipefail

# Load environment variables
if [ -z "$1" ]; then
  echo "Error: Environment file not provided"
  exit 1
fi

source "$1"

# Initialize
ninja_log "Builder" "Starting build process" "INFO"
ninja_log "Builder" "Target environment: $DEPLOY_ENV" "INFO"
ninja_log "Builder" "Building version: $DEPLOY_TAG" "INFO"

# Create output directory for builder artifacts
BUILD_DIR="build/ninja-builder/$DEPLOY_ENV"
mkdir -p "$BUILD_DIR"

# Load scout findings if available
SCOUT_DIR="build/ninja-scout/$DEPLOY_ENV"
FINDINGS_FILE="$SCOUT_DIR/findings.json"
if [ -f "$FINDINGS_FILE" ]; then
  ninja_log "Builder" "Loading scout findings" "INFO"
  DEPLOY_STRATEGY=$(cat "$FINDINGS_FILE" | jq -r '.strategy')
  REPLICAS=$(cat "$FINDINGS_FILE" | jq -r '.replicas')
else
  ninja_log "Builder" "Scout findings not available, using defaults" "WARN"
  DEPLOY_STRATEGY="rolling"
  REPLICAS=1
fi

# Export variables for build
export DEPLOY_ENV
export DEPLOY_TAG
export BUILD_ID="$DEPLOYMENT_ID"
export BUILD_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export NODE_ENV="production"

# Use build system based on what's available
ninja_log "Builder" "Determining build system to use..." "INFO"
if [ -f "build.ninja" ]; then
  ninja_log "Builder" "Using Ninja build system" "INFO"
  BUILD_SYSTEM="ninja"
elif [ -f "CMakeLists.txt" ]; then
  ninja_log "Builder" "Using CMake build system" "INFO"
  BUILD_SYSTEM="cmake"
else
  ninja_log "Builder" "Using standard Node.js build" "INFO"
  BUILD_SYSTEM="node"
fi

# Clean the dist directory
ninja_log "Builder" "Cleaning previous build artifacts" "INFO"
rm -rf dist
mkdir -p dist

# Run the build based on selected build system
case $BUILD_SYSTEM in
  ninja)
    ninja_log "Builder" "Building with Ninja" "INFO"
    
    # Use the ninja build file
    if ! command -v ninja &>/dev/null; then
      ninja_log "Builder" "Ninja build tool not found" "ERROR"
      exit 1
    fi
    
    ninja typescript >> "$DEPLOY_LOG" 2>&1
    BUILD_STATUS=$?
    
    if [ $BUILD_STATUS -ne 0 ]; then
      ninja_log "Builder" "Ninja build failed" "ERROR"
      exit $BUILD_STATUS
    fi
    ;;
    
  cmake)
    ninja_log "Builder" "Building with CMake" "INFO"
    
    # Use CMake to generate and build
    if ! command -v cmake &>/dev/null; then
      ninja_log "Builder" "CMake not found" "ERROR"
      exit 1
    fi
    
    # Run CMake to generate build files
    mkdir -p build
    cd build
    cmake -G Ninja .. >> "$DEPLOY_LOG" 2>&1
    
    # Run the actual build
    cmake --build . >> "$DEPLOY_LOG" 2>&1
    BUILD_STATUS=$?
    cd ..
    
    if [ $BUILD_STATUS -ne 0 ]; then
      ninja_log "Builder" "CMake build failed" "ERROR"
      exit $BUILD_STATUS
    fi
    ;;
    
  node)
    ninja_log "Builder" "Building with npm" "INFO"
    
    # Use npm run build or TypeScript directly
    if [ -f "package.json" ]; then
      if grep -q "\"build\"" package.json; then
        npm run build >> "$DEPLOY_LOG" 2>&1
      else
        npx tsc >> "$DEPLOY_LOG" 2>&1
      fi
    else
      ninja_log "Builder" "No package.json found" "ERROR"
      exit 1
    fi
    
    BUILD_STATUS=$?
    
    if [ $BUILD_STATUS -ne 0 ]; then
      ninja_log "Builder" "Node.js build failed" "ERROR"
      exit $BUILD_STATUS
    fi
    ;;
esac

ninja_log "Builder" "Build completed successfully" "SUCCESS"

# Check if we need to build a Docker image
if [ -f "docker/Dockerfile" ]; then
  ninja_log "Builder" "Building Docker image: documind:$DEPLOY_TAG" "INFO"
  
  docker build -t "documind:$DEPLOY_TAG" \
    --build-arg BUILD_ID="$DEPLOYMENT_ID" \
    --build-arg NODE_ENV="$DEPLOY_ENV" \
    --build-arg BUILD_DATE="$BUILD_TIMESTAMP" \
    -f docker/Dockerfile . >> "$DEPLOY_LOG" 2>&1
    
  # Tag for registry if specified
  if [ -n "$DOCKER_REGISTRY" ]; then
    ninja_log "Builder" "Tagging and pushing to registry: $DOCKER_REGISTRY" "INFO"
    docker tag "documind:$DEPLOY_TAG" "$DOCKER_REGISTRY/documind:$DEPLOY_TAG"
    docker push "$DOCKER_REGISTRY/documind:$DEPLOY_TAG" >> "$DEPLOY_LOG" 2>&1
  fi
  
  # Record image info
  docker inspect "documind:$DEPLOY_TAG" > "$BUILD_DIR/docker-image-info.json"
fi

# Generate build report
BUILD_SIZE=$(du -sh dist | cut -f1)
BUILD_FILES=$(find dist -type f | wc -l)

cat > "$BUILD_DIR/build-info.json" << EOF
{
  "version": "$DEPLOY_TAG",
  "buildId": "$DEPLOYMENT_ID",
  "timestamp": "$BUILD_TIMESTAMP",
  "environment": "$DEPLOY_ENV",
  "system": "$BUILD_SYSTEM",
  "size": "$BUILD_SIZE",
  "fileCount": $BUILD_FILES,
  "deploymentStrategy": "$DEPLOY_STRATEGY",
  "replicas": $REPLICAS
}
EOF

ninja_log "Builder" "Build artifacts ready for deployment" "SUCCESS"
ninja_log "Builder" "Artifact size: $BUILD_SIZE, Files: $BUILD_FILES" "INFO"

exit 0
