#!/bin/bash
#
# Ninja Security Scanner
# Advanced security scanning for Documind deployment

set -eo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default settings
ENV="production"
DEEP_SCAN=false
QUICK=false
OUTPUT_DIR="reports/security"
REPORT_FILE="${OUTPUT_DIR}/ninja-scan-$(date +%Y%m%d%H%M%S).json"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --env=*)
      ENV="${1#*=}"
      shift
      ;;
    --deep)
      DEEP_SCAN=true
      shift
      ;;
    --quick)
      QUICK=true
      shift
      ;;
    --output=*)
      REPORT_FILE="${1#*=}"
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Usage: $0 --env=[environment] [--deep] [--quick] [--output=file.json]"
      exit 1
      ;;
  esac
done

# Create output directory
mkdir -p "$(dirname "$REPORT_FILE")"

echo -e "${BLUE}Ninja Security Scanner${NC}"
echo -e "${YELLOW}Environment:${NC} $ENV"
echo -e "${YELLOW}Deep Scan:${NC} $DEEP_SCAN"
echo -e "${YELLOW}Report:${NC} $REPORT_FILE"
echo

# Initialize the report
echo "{\"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\", \"environment\": \"$ENV\", \"results\": {}, \"summary\": {}}" > "$REPORT_FILE"

# Function to update the report
update_report() {
  local category="$1"
  local data="$2"
  
  # Use temporary files for JSON manipulation
  local temp_file="${REPORT_FILE}.tmp"
  
  # Use jq if available, otherwise use sed (less reliable)
  if command -v jq &>/dev/null; then
    jq --argjson data "$data" ".results.$category = \$data" "$REPORT_FILE" > "$temp_file"
    mv "$temp_file" "$REPORT_FILE"
  else
    # Fallback - very simple and might break with complex JSON
    sed -i "s/\"results\": {/\"results\": {\n\"$category\": $data,/g" "$REPORT_FILE"
  fi
}

# Function to update summary
update_summary() {
  local vulns="$1"
  local level="$2"
  
  if command -v jq &>/dev/null; then
    local temp_file="${REPORT_FILE}.tmp"
    jq --argjson count "$vulns" ".summary.$level = \$count" "$REPORT_FILE" > "$temp_file"
    mv "$temp_file" "$REPORT_FILE"
  fi
}

# Set scan mode based on parameters
if [ "$QUICK" = true ]; then
  echo -e "${YELLOW}Running in quick scan mode${NC}"
  SCAN_MODE="quick"
elif [ "$DEEP_SCAN" = true ]; then
  echo -e "${YELLOW}Running in deep scan mode${NC}"
  SCAN_MODE="deep"
else
  echo -e "${YELLOW}Running in standard scan mode${NC}"
  SCAN_MODE="standard"
fi

# 1. Container image scanning
echo -e "\n${BLUE}1. Container Image Scanning${NC}"
if command -v trivy &>/dev/null; then
  echo -e "${GREEN}Running Trivy scan on documind images...${NC}"
  
  # Set scan severity based on mode
  if [ "$SCAN_MODE" = "quick" ]; then
    SEVERITY="CRITICAL"
  elif [ "$SCAN_MODE" = "deep" ]; then
    SEVERITY="HIGH,MEDIUM,LOW"
  else
    SEVERITY="CRITICAL,HIGH"
  fi
  
  # Run trivy and capture output
  if docker images | grep -q documind; then
    trivy_output=$(trivy image --no-progress --format json --severity "$SEVERITY" documind:latest 2>/dev/null || echo '{"Results":[]}')
    
    # Count vulnerabilities
    if command -v jq &>/dev/null; then
      vuln_count=$(echo "$trivy_output" | jq '[.Results[].Vulnerabilities | length] | add // 0')
      critical=$(echo "$trivy_output" | jq '[.Results[].Vulnerabilities[] | select(.Severity=="CRITICAL")] | length // 0')
      high=$(echo "$trivy_output" | jq '[.Results[].Vulnerabilities[] | select(.Severity=="HIGH")] | length // 0')
    else
      vuln_count=0
      critical=0
      high=0
    fi
    
    echo -e "${YELLOW}Found ${vuln_count} vulnerabilities (${critical} critical, ${high} high)${NC}"
    
    # Update report
    update_report "container_scan" "$trivy_output"
    update_summary "$critical" "critical"
    update_summary "$high" "high"
  else
    echo -e "${YELLOW}No documind images found to scan${NC}"
    update_report "container_scan" '{"error": "No documind images found"}'
  fi
else
  echo -e "${YELLOW}Trivy not found, skipping container scanning${NC}"
  update_report "container_scan" '{"error": "Trivy not installed"}'
fi

# 2. Dependency scanning
echo -e "\n${BLUE}2. Dependency Scanning${NC}"
if [ -f "package.json" ]; then
  echo -e "${GREEN}Scanning npm dependencies...${NC}"
  
  if command -v npm &>/dev/null; then
    if [ "$SCAN_MODE" = "deep" ]; then
      echo -e "${YELLOW}Running comprehensive npm audit...${NC}"
      npm_output=$(npm audit --json 2>/dev/null || echo '{"vulnerabilities": {}}')
    else
      echo -e "${YELLOW}Running standard npm audit...${NC}"
      npm_output=$(npm audit --json --omit=dev 2>/dev/null || echo '{"vulnerabilities": {}}')
    fi
    
    # Count vulnerabilities
    if command -v jq &>/dev/null; then
      npm_critical=$(echo "$npm_output" | jq '[.vulnerabilities[] | select(.severity == "critical")] | length // 0')
      npm_high=$(echo "$npm_output" | jq '[.vulnerabilities[] | select(.severity == "high")] | length // 0')
      npm_moderate=$(echo "$npm_output" | jq '[.vulnerabilities[] | select(.severity == "moderate")] | length // 0')
      npm_total=$((npm_critical + npm_high + npm_moderate))
      
      echo -e "${YELLOW}Found ${npm_total} vulnerable dependencies (${npm_critical} critical, ${npm_high} high, ${npm_moderate} moderate)${NC}"
    fi
    
    # Update report
    update_report "dependency_scan" "$npm_output"
    update_summary "$npm_critical" "npm_critical"
    update_summary "$npm_high" "npm_high"
  else
    echo -e "${YELLOW}npm not found, skipping dependency scanning${NC}"
    update_report "dependency_scan" '{"error": "npm not installed"}'
  fi
else
  echo -e "${YELLOW}No package.json found, skipping dependency scanning${NC}"
  update_report "dependency_scan" '{"error": "No package.json found"}'
fi

# 3. Runtime configuration scanning
echo -e "\n${BLUE}3. Runtime Configuration Scanning${NC}"

# Check Docker container configurations
if command -v docker &>/dev/null; then
  echo -e "${GREEN}Scanning Docker container configurations...${NC}"
  
  # Check for exposed ports
  exposed_ports=$(docker ps --filter name=documind -q | xargs -I{} docker port {} 2>/dev/null || echo "")
  update_report "exposed_ports" "{\"ports\": \"$exposed_ports\"}"
  
  # Check container security options
  if [ "$SCAN_MODE" = "deep" ] || [ "$SCAN_MODE" = "standard" ]; then
    security_options=$(docker ps --filter name=documind --format '{{.Names}}: {{.SecurityOptions}}' 2>/dev/null || echo "")
    update_report "security_options" "{\"options\": \"$security_options\"}"
  fi
  
  # Check for privileged containers (security risk)
  privileged_containers=$(docker ps --filter name=documind -q | xargs -I{} docker inspect {} --format '{{.Name}}: {{.HostConfig.Privileged}}' 2>/dev/null | grep true || echo "")
  
  if [ -n "$privileged_containers" ]; then
    echo -e "${RED}Warning: Found privileged containers:${NC}"
    echo "$privileged_containers"
    update_report "privileged_containers" "{\"containers\": \"$privileged_containers\", \"found\": true}"
  else
    echo -e "${GREEN}No privileged containers found${NC}"
    update_report "privileged_containers" "{\"found\": false}"
  fi
fi

# 4. File permission scanning
if [ "$SCAN_MODE" = "deep" ]; then
  echo -e "\n${BLUE}4. File Permission Scanning${NC}"
  echo -e "${GREEN}Checking for insecure file permissions...${NC}"
  
  # Check for world-writable files in important directories
  world_writable=$(find . -path "*/node_modules" -prune -o -path "*/dist" -prune -o -path "*/build" -prune -o -type f -perm -o+w -print 2>/dev/null || echo "")
  
  if [ -n "$world_writable" ]; then
    echo -e "${YELLOW}Found world-writable files:${NC}"
    echo "$world_writable" | head -5
    [ $(echo "$world_writable" | wc -l) -gt 5 ] && echo "... and more"
    update_report "file_permissions" "{\"world_writable\": true, \"count\": $(echo "$world_writable" | wc -l)}"
  else
    echo -e "${GREEN}No world-writable files found${NC}"
    update_report "file_permissions" "{\"world_writable\": false}"
  fi
  
  # Check for unprotected private keys
  private_keys=$(find . -path "*/node_modules" -prune -o -name "*.pem" -o -name "*.key" -o -name "*id_rsa*" -type f -print 2>/dev/null || echo "")
  
  if [ -n "$private_keys" ]; then
    echo -e "${YELLOW}Found potential private key files:${NC}"
    echo "$private_keys"
    unprotected_keys=$(find . -path "*/node_modules" -prune -o -name "*.pem" -o -name "*.key" -o -name "*id_rsa*" -type f -perm -o+r -print 2>/dev/null || echo "")
    update_report "private_keys" "{\"found\": true, \"unprotected\": $([ -n \"$unprotected_keys\" ] && echo \"true\" || echo \"false\")}"
  else
    echo -e "${GREEN}No private key files found${NC}"
    update_report "private_keys" "{\"found\": false}"
  fi
fi

# 5. Code secrets scanning
echo -e "\n${BLUE}5. Code Secrets Scanning${NC}"

if command -v gitleaks &>/dev/null; then
  echo -e "${GREEN}Running GitLeaks secrets scan...${NC}"
  gitleaks_output=$(gitleaks detect -v --no-git --report-format json --report-path - 2>/dev/null || echo '{"leaks":[]}')
  
  # Count leaks
  if command -v jq &>/dev/null; then
    leak_count=$(echo "$gitleaks_output" | jq '.leaks | length // 0')
    echo -e "${YELLOW}Found ${leak_count} potential secrets in code${NC}"
    update_report "code_secrets" "$gitleaks_output"
    update_summary "$leak_count" "secrets"
  else
    echo -e "${YELLOW}Could not parse GitLeaks output${NC}"
    update_report "code_secrets" '{"error": "Failed to parse gitleaks output"}'
  fi
else
  echo -e "${YELLOW}GitLeaks not found, using basic pattern matching...${NC}"
  
  # Basic pattern matching for API keys and tokens
  api_keys=$(grep -r -E "(api|token|key|secret|password|credential)[^a-zA-Z0-9].*['\"][a-zA-Z0-9]{32,}['\"]" --include="*.{js,ts,json,yaml,yml}" . | grep -v node_modules | grep -v "\\*\\*" || echo "")
  
  if [ -n "$api_keys" ]; then
    echo -e "${YELLOW}Found potential API keys or secrets:${NC}"
    echo "$api_keys" | head -5
    [ $(echo "$api_keys" | wc -l) -gt 5 ] && echo "... and more"
    update_report "code_secrets" "{\"found\": true, \"count\": $(echo "$api_keys" | wc -l)}"
  else
    echo -e "${GREEN}No API keys or secrets found in code${NC}"
    update_report "code_secrets" "{\"found\": false}"
  fi
fi

# Generate final security score
echo -e "\n${BLUE}Security Scan Summary${NC}"

# Aggregate and calculate final score
critical=$(jq -r '.summary.critical // 0' "$REPORT_FILE")
critical=$((critical + $(jq -r '.summary.npm_critical // 0' "$REPORT_FILE")))
high=$(jq -r '.summary.high // 0' "$REPORT_FILE")
high=$((high + $(jq -r '.summary.npm_high // 0' "$REPORT_FILE")))
secrets=$(jq -r '.summary.secrets // 0' "$REPORT_FILE")

# Calculate security score (0-100 where 100 is most secure)
# Each critical issue is -15 points, high is -5 points, secrets are -10 points
score=100
score=$((score - critical * 15))
score=$((score - high * 5))
score=$((score - secrets * 10))

# Ensure score doesn't go below 0
if [ "$score" -lt 0 ]; then
  score=0
fi

# Update final score
if command -v jq &>/dev/null; then
  temp_file="${REPORT_FILE}.tmp"
  jq --argjson score "$score" '.summary.security_score = $score' "$REPORT_FILE" > "$temp_file"
  mv "$temp_file" "$REPORT_FILE"
fi

# Final output
echo -e "\n${BLUE}Security Assessment:${NC}"
echo -e "Critical issues: ${critical}"
echo -e "High issues: ${high}"
echo -e "Secrets detected: ${secrets}"

if [ "$score" -ge 90 ]; then
  echo -e "\n${GREEN}Security Score: $score/100${NC} - Excellent"
elif [ "$score" -ge 70 ]; then
  echo -e "\n${YELLOW}Security Score: $score/100${NC} - Good"
else
  echo -e "\n${RED}Security Score: $score/100${NC} - Needs improvement"
fi

echo -e "\nComplete security report saved to: ${REPORT_FILE}"

# Exit with appropriate status code
if [ "$critical" -gt 0 ]; then
  exit 2 # Critical issues found
elif [ "$high" -gt 0 ] || [ "$secrets" -gt 0 ]; then
  exit 1 # High issues or secrets found
else
  exit 0 # No significant issues
fi
