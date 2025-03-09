#!/bin/bash
#
# Documind Deployment Verification Script
# Performs exhaustive validation of deployment health

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Variables
ENV=$1
TAG=$2
TIMEOUT_SECONDS=300
CHECK_INTERVAL=10
MAX_RETRIES=$((TIMEOUT_SECONDS / CHECK_INTERVAL))

# Load environment-specific configuration
if [[ "$ENV" == "production" ]]; then
  BASE_URL="https://documind.example.com"
  EXPECTED_REPLICAS=3
  MIN_HEALTHY_PERCENTAGE=100
  LOG_RETENTION="24h"
elif [[ "$ENV" == "staging" ]]; then
  BASE_URL="https://staging.documind.example.com"
  EXPECTED_REPLICAS=1
  MIN_HEALTHY_PERCENTAGE=100
  LOG_RETENTION="6h"
else
  echo -e "${RED}Invalid environment: $ENV${NC}"
  echo "Usage: $0 [environment] [tag]"
  exit 1
fi

echo -e "${BLUE}=== Documind Deployment Verification ===${NC}"
echo -e "${YELLOW}Environment:${NC} $ENV"
echo -e "${YELLOW}Version:${NC} $TAG"
echo -e "${YELLOW}Base URL:${NC} $BASE_URL"

# Function to check API health
check_api_health() {
  local retry_count=0
  local healthy=false
  
  echo -e "\n${BLUE}Checking API health...${NC}"
  
  while [[ $retry_count -lt $MAX_RETRIES ]]; do
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/health" || echo "failed")
    
    if [[ "$status_code" == "200" ]]; then
      response=$(curl -s "${BASE_URL}/api/v1/health")
      
      if echo "$response" | grep -q '"status":"healthy"'; then
        build_id=$(echo "$response" | grep -o '"buildId":"[^"]*"' | cut -d'"' -f4)
        version=$(echo "$response" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        
        echo -e "${GREEN}✓ API is healthy${NC}"
        echo -e "  Status: ${GREEN}Healthy${NC}"
        echo -e "  Version: ${GREEN}$version${NC}"
        echo -e "  Build ID: ${GREEN}$build_id${NC}"
        
        # Verify version matches expected tag
        if [[ -n "$TAG" ]] && [[ "$version" != "$TAG" ]] && [[ "$build_id" != *"$TAG"* ]]; then
          echo -e "${RED}✗ Version mismatch! Expected: $TAG, Got: $version / $build_id${NC}"
          return 1
        fi
        
        healthy=true
        break
      else
        echo -e "${YELLOW}API returned 200 but doesn't report as healthy yet. Retrying... ($retry_count/$MAX_RETRIES)${NC}"
      fi
    else
      echo -e "${YELLOW}API health check failed with status: $status_code. Retrying... ($retry_count/$MAX_RETRIES)${NC}"
    fi
    
    retry_count=$((retry_count + 1))
    sleep $CHECK_INTERVAL
  done
  
  if [[ "$healthy" == "false" ]]; then
    echo -e "${RED}✗ API health check failed after $MAX_RETRIES attempts${NC}"
    return 1
  fi
  
  return 0
}

# Function to check database connectivity
check_database() {
  echo -e "\n${BLUE}Checking database connectivity...${NC}"
  
  db_status=$(curl -s "${BASE_URL}/api/v1/health" | grep -o '"database":{[^}]*}' || echo "not found")
  
  if [[ "$db_status" == "not found" ]]; then
    echo -e "${RED}✗ Database status not available in health check${NC}"
    return 1
  fi
  
  if echo "$db_status" | grep -q '"status":"healthy"'; then
    db_latency=$(echo "$db_status" | grep -o '"latency":[0-9.]*' | cut -d':' -f2)
    echo -e "${GREEN}✓ Database connection is healthy${NC}"
    echo -e "  Latency: ${GREEN}${db_latency}ms${NC}"
    return 0
  else
    echo -e "${RED}✗ Database connection is unhealthy${NC}"
    return 1
  fi
}

# Function to check docker container status
check_containers() {
  echo -e "\n${BLUE}Checking container status...${NC}"
  
  if [[ "$ENV" == "production" ]]; then
    # Check Docker Swarm services
    app_replicas=$(ssh $SSH_OPTS $SWARM_HOST "docker service ls --filter name=documind_app --format '{{.Replicas}}' | tr -d '\r'" || echo "failed")
    
    if [[ "$app_replicas" == "failed" ]]; then
      echo -e "${RED}✗ Failed to retrieve container status${NC}"
      return 1
    fi
    
    current=$(echo $app_replicas | cut -d/ -f1)
    expected=$(echo $app_replicas | cut -d/ -f2)
    
    if [[ "$current" -eq "$expected" ]]; then
      echo -e "${GREEN}✓ All containers are running${NC}"
      echo -e "  Replicas: ${GREEN}$current/$expected${NC}"
      return 0
    else
      echo -e "${RED}✗ Not all containers are running${NC}"
      echo -e "  Replicas: ${RED}$current/$expected${NC}"
      return 1
    fi
  else
    # Check docker-compose containers
    app_status=$(ssh $SSH_OPTS $DEPLOY_HOST "docker-compose ps app --format json" | grep -o '"State":"[^"]*"' | cut -d'"' -f4 || echo "failed")
    
    if [[ "$app_status" == "failed" ]]; then
      echo -e "${RED}✗ Failed to retrieve container status${NC}"
      return 1
    fi
    
    if [[ "$app_status" == "running" ]]; then
      echo -e "${GREEN}✓ Application container is running${NC}"
      return 0
    else
      echo -e "${RED}✗ Application container is not running (Status: $app_status)${NC}"
      return 1
    fi
  fi
}

# Function to check key endpoints
check_endpoints() {
  echo -e "\n${BLUE}Checking key endpoints...${NC}"
  
  endpoints=(
    "/api/v1/version:version" 
    "/api/v1/health:status" 
    "/api/v1/metrics:uptime"
  )
  
  failures=0
  
  for endpoint_check in "${endpoints[@]}"; do
    endpoint=$(echo $endpoint_check | cut -d: -f1)
    expected_field=$(echo $endpoint_check | cut -d: -f2)
    
    echo -e "Testing endpoint: ${YELLOW}$endpoint${NC}"
    
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${endpoint}" || echo "failed")
    
    if [[ "$status_code" == "200" ]]; then
      response=$(curl -s "${BASE_URL}${endpoint}")
      
      if echo "$response" | grep -q "\"$expected_field\""; then
        echo -e "  ${GREEN}✓ Endpoint is working${NC}"
      else
        echo -e "  ${RED}✗ Endpoint response missing expected field: $expected_field${NC}"
        failures=$((failures + 1))
      fi
    else
      echo -e "  ${RED}✗ Endpoint failed with status: $status_code${NC}"
      failures=$((failures + 1))
    fi
  done
  
  if [[ "$failures" -eq 0 ]]; then
    echo -e "${GREEN}✓ All endpoints are working${NC}"
    return 0
  else
    echo -e "${RED}✗ $failures endpoints failed${NC}"
    return 1
  fi
}

# Function to check resource usage
check_resources() {
  echo -e "\n${BLUE}Checking resource usage...${NC}"
  
  metrics=$(curl -s "${BASE_URL}/api/v1/health" | grep -o '"metrics":{[^}]*}' || echo "not found")
  
  if [[ "$metrics" == "not found" ]]; then
    echo -e "${YELLOW}⚠ Resource metrics not available in health check${NC}"
    return 0
  fi
  
  # Extract memory usage
  mem_usage=$(echo "$metrics" | grep -o '"memory":{[^}]*}' | grep -o '"usedPercentage":[0-9.]*' | cut -d: -f2)
  
  if [[ -n "$mem_usage" ]]; then
    echo -e "Memory usage: ${YELLOW}${mem_usage}%${NC}"
    
    if (( $(echo "$mem_usage > 90" | bc -l) )); then
      echo -e "${RED}⚠ High memory usage detected${NC}"
    fi
  fi
  
  # Extract CPU usage
  cpu_usage=$(echo "$metrics" | grep -o '"cpu":{[^}]*}' | grep -o '"utilization":[0-9.]*' | cut -d: -f2)
  
  if [[ -n "$cpu_usage" ]]; then
    echo -e "CPU usage: ${YELLOW}${cpu_usage}%${NC}"
    
    if (( $(echo "$cpu_usage > 80" | bc -l) )); then
      echo -e "${RED}⚠ High CPU usage detected${NC}"
    fi
  fi
  
  return 0
}

# Function to run end-to-end tests
run_e2e_tests() {
  echo -e "\n${BLUE}Running end-to-end tests...${NC}"
  
  if [[ "$ENV" == "production" ]]; then
    echo -e "${YELLOW}Skipping end-to-end tests in production environment${NC}"
    return 0
  fi
  
  # Run basic smoke tests against the deployment
  TEST_BASE_URL=$BASE_URL npm run test:smoke
  TEST_STATUS=$?
  
  if [[ $TEST_STATUS -eq 0 ]]; then
    echo -e "${GREEN}✓ End-to-end tests passed${NC}"
    return 0
  else
    echo -e "${RED}✗ End-to-end tests failed${NC}"
    return 1
  fi
}

# Main verification flow
main() {
  echo -e "\n${BLUE}Starting deployment verification...${NC}"
  
  failures=0
  
  # Run each verification check
  check_api_health || failures=$((failures + 1))
  check_database || failures=$((failures + 1))
  check_containers || failures=$((failures + 1))
  check_endpoints || failures=$((failures + 1))
  check_resources || failures=$((failures + 1))
  run_e2e_tests || failures=$((failures + 1))
  
  # Final verification result
  echo -e "\n${BLUE}=== Verification Summary ===${NC}"
  
  if [[ "$failures" -eq 0 ]]; then
    echo -e "${GREEN}✓ All verification checks passed!${NC}"
    echo -e "${GREEN}✓ Deployment of version $TAG to $ENV environment is successful.${NC}"
    exit 0
  else
    echo -e "${RED}✗ Verification failed with $failures errors.${NC}"
    echo -e "${RED}✗ Deployment of version $TAG to $ENV environment may be problematic.${NC}"
    exit 1
  fi
}

# Execute the main function
main
