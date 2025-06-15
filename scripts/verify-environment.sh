#!/bin/bash
#
# Documind Environment Verification Script
# Checks system requirements and validates installation

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Documind Environment Verification ===${NC}\n"

# Define minimum requirements
MIN_CPU=2
MIN_RAM=3500  # ~4GB in MB
MIN_DISK=20   # GB
MIN_NODE_VER="18.0.0"
MIN_DOCKER_VER="20.10.0"
MIN_POSTGRES_VER="14.0"

# Check function with status reporting
check() {
    local name=$1
    local value=$2
    local min=$3
    local unit=$4
    
    echo -ne "${name}: "
    if [[ $(echo "$value < $min" | bc -l) -eq 1 ]]; then
        echo -e "${RED}FAIL${NC} (Found: ${value}${unit}, Minimum: ${min}${unit})"
        return 1
    else
        echo -e "${GREEN}PASS${NC} (${value}${unit})"
        return 0
    fi
}

# Version comparison function
version_greater_equal() {
    printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

# System Checks
echo -e "${BLUE}System Requirements${NC}"
echo -e "${YELLOW}Checking hardware...${NC}"

# Check CPU
CPU_CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "Unknown")
if [[ "$CPU_CORES" != "Unknown" ]]; then
    check "CPU Cores" "$CPU_CORES" "$MIN_CPU" ""
else
    echo -e "CPU Cores: ${YELLOW}Unknown${NC} (could not detect)"
fi

# Check RAM
if [[ "$(uname)" == "Linux" ]]; then
    RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
elif [[ "$(uname)" == "Darwin" ]]; then
    RAM_MB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))
else
    RAM_MB="Unknown"
fi

if [[ "$RAM_MB" != "Unknown" ]]; then
    check "RAM" "$RAM_MB" "$MIN_RAM" "MB"
else
    echo -e "RAM: ${YELLOW}Unknown${NC} (could not detect)"
fi

# Check disk space
DISK_GB=$(df -BG / | awk 'NR==2 {gsub("G","",$4); print $4}')
if [[ "$DISK_GB" != "Unknown" ]]; then
    check "Free Disk Space" "$DISK_GB" "$MIN_DISK" "GB"
else
    echo -e "Disk Space: ${YELLOW}Unknown${NC} (could not detect)"
fi

echo -e "\n${YELLOW}Checking software...${NC}"

# Check Docker
if command -v docker &>/dev/null; then
    DOCKER_VER=$(docker --version | awk '{print $3}' | sed 's/,//')
    echo -n "Docker: "
    if version_greater_equal "$DOCKER_VER" "$MIN_DOCKER_VER"; then
        echo -e "${GREEN}PASS${NC} (${DOCKER_VER})"
        
        # Also check Docker Compose
        if command -v docker-compose &>/dev/null; then
            COMPOSE_VER=$(docker-compose --version | awk '{print $3}' | sed 's/,//')
            echo -e "Docker Compose: ${GREEN}PASS${NC} (${COMPOSE_VER})"
        elif docker compose version &>/dev/null; then
            COMPOSE_VER=$(docker compose version --short)
            echo -e "Docker Compose (plugin): ${GREEN}PASS${NC} (${COMPOSE_VER})"
        else
            echo -e "Docker Compose: ${RED}FAIL${NC} (not found)"
        fi
        
        # Check if Docker daemon is running
        if docker info &>/dev/null; then
            echo -e "Docker daemon: ${GREEN}PASS${NC} (running)"
        else
            echo -e "Docker daemon: ${RED}FAIL${NC} (not running)"
        fi
    else
        echo -e "${YELLOW}WARN${NC} (found ${DOCKER_VER}, minimum ${MIN_DOCKER_VER})"
    fi
else
    echo -e "Docker: ${YELLOW}Not installed${NC}"
fi

# Check Node.js
if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//')
    echo -n "Node.js: "
    if version_greater_equal "$NODE_VER" "$MIN_NODE_VER"; then
        echo -e "${GREEN}PASS${NC} (${NODE_VER})"
    else
        echo -e "${YELLOW}WARN${NC} (found ${NODE_VER}, minimum ${MIN_NODE_VER})"
    fi
else
    echo -e "Node.js: ${YELLOW}Not installed${NC}"
fi

# Check PostgreSQL
if command -v psql &>/dev/null; then
    PG_VER=$(psql --version | awk '{print $3}')
    echo -n "PostgreSQL client: "
    if version_greater_equal "$PG_VER" "$MIN_POSTGRES_VER"; then
        echo -e "${GREEN}PASS${NC} (${PG_VER})"
    else
        echo -e "${YELLOW}WARN${NC} (found ${PG_VER}, minimum ${MIN_POSTGRES_VER})"
    fi
else
    echo -e "PostgreSQL client: ${YELLOW}Not installed${NC}"
fi

# Check network connectivity
echo -e "\n${BLUE}Network Requirements${NC}"
echo -e "${YELLOW}Checking network connectivity...${NC}"

# Check internet connectivity
if ping -c 1 google.com &>/dev/null; then
    echo -e "Internet connectivity: ${GREEN}PASS${NC}"
else
    echo -e "Internet connectivity: ${YELLOW}WARN${NC} (could not reach google.com)"
fi

# Check if common ports are available
check_port() {
    local port=$1
    local service=$2
    if netstat -tuln | grep -q ":$port "; then
        echo -e "Port ${port} (${service}): ${RED}FAIL${NC} (already in use)"
    else
        echo -e "Port ${port} (${service}): ${GREEN}PASS${NC} (available)"
    fi
}

check_port 3000 "Documind app"
check_port 5432 "PostgreSQL"
check_port 6379 "Redis"
check_port 80 "HTTP"
check_port 443 "HTTPS"

# Check if installation exists
echo -e "\n${BLUE}Installation Status${NC}"

if [[ -f ".env" || -f ".env.docker" ]]; then
    echo -e "Configuration files: ${GREEN}Found${NC}"
else
    echo -e "Configuration files: ${YELLOW}Not found${NC} (new installation)"
fi

if [[ -d "node_modules" ]]; then
    echo -e "Node dependencies: ${GREEN}Installed${NC}"
else
    echo -e "Node dependencies: ${YELLOW}Not installed${NC} (new installation)"
fi

# Check Docker containers if Docker is running
if command -v docker &>/dev/null && docker info &>/dev/null; then
    if docker ps | grep -q "documind"; then
        echo -e "Documind containers: ${GREEN}Running${NC}"
    else
        echo -e "Documind containers: ${YELLOW}Not running${NC} (new or stopped installation)"
    fi
fi

# Summary
echo -e "\n${BLUE}Verification Summary${NC}"

if [[ "$CPU_CORES" != "Unknown" && "$CPU_CORES" -ge "$MIN_CPU" && 
      "$RAM_MB" != "Unknown" && "$RAM_MB" -ge "$MIN_RAM" && 
      "$DISK_GB" != "Unknown" && "$DISK_GB" -ge "$MIN_DISK" ]]; then
    echo -e "${GREEN}✓ Hardware requirements met${NC}"
else
    echo -e "${YELLOW}⚠ Some hardware requirements not met${NC}"
fi

if command -v docker &>/dev/null && version_greater_equal "$DOCKER_VER" "$MIN_DOCKER_VER" && 
   (command -v docker-compose &>/dev/null || docker compose version &>/dev/null); then
    echo -e "${GREEN}✓ Docker requirements met for Docker installation${NC}"
else
    echo -e "${YELLOW}⚠ Docker requirements not fully met${NC}"
fi

if command -v node &>/dev/null && version_greater_equal "$NODE_VER" "$MIN_NODE_VER"; then
    echo -e "${GREEN}✓ Node.js requirements met for manual installation${NC}"
else
    echo -e "${YELLOW}⚠ Node.js requirements not met for manual installation${NC}"
fi

echo -e "\n${GREEN}Verification completed.${NC}"

# Recommendation
echo -e "\n${BLUE}Recommendation:${NC}"
if command -v docker &>/dev/null && docker info &>/dev/null; then
    echo -e "${GREEN}Docker installation recommended.${NC} Run: bash scripts/install.sh --docker"
elif command -v node &>/dev/null && version_greater_equal "$NODE_VER" "$MIN_NODE_VER"; then
    echo -e "${GREEN}Manual installation possible.${NC} Run: bash scripts/install.sh"
else
    echo -e "${YELLOW}Please install Docker or Node.js before proceeding.${NC}"
fi
