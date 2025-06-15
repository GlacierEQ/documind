#!/bin/bash

# Documind Installation Script
# This script installs and configures Documind with optimal settings

set -e

# Default settings
INSTALL_DIR="/opt/documind"
USE_DOCKER=false
DATABASE_DRIVER="sqlite"
AUTH_MODE="password"
DISABLE_TLS=false
STORAGE_PATH="/var/documind/storage"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║             DOCUMIND                  ║"
echo "║  Document Management & Search System  ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --auto-detect)
      AUTO_DETECT=true
      shift
      ;;
    --optimize)
      OPTIMIZE=true
      shift
      ;;
    --secure)
      SECURE=true
      shift
      ;;
    --interactive)
      INTERACTIVE=true
      shift
      ;;
    --docker)
      USE_DOCKER=true
      shift
      ;;
    --database=*)
      DATABASE_DRIVER="${1#*=}"
      shift
      ;;
    --auth=*)
      AUTH_MODE="${1#*=}"
      shift
      ;;
    --storage=*)
      STORAGE_PATH="${1#*=}"
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# System detection and resource analysis
detect_system() {
  echo -e "${YELLOW}Detecting system configuration...${NC}"
  
  # OS detection
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
    OS_VERSION=$VERSION_ID
    echo -e "Operating System: ${GREEN}$OS $OS_VERSION${NC}"
  else
    OS="Unknown"
    echo -e "${RED}Unable to detect operating system${NC}"
  fi
  
  # Hardware detection
  CPU_CORES=$(nproc --all)
  MEMORY_MB=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024))
  DISK_GB=$(($(df -B1G / | tail -1 | awk '{print $4}') - 5)) # Reserve 5GB
  
  echo -e "CPU Cores: ${GREEN}$CPU_CORES${NC}"
  echo -e "Memory: ${GREEN}$MEMORY_MB MB${NC}"
  echo -e "Available Disk Space: ${GREEN}$DISK_GB GB${NC}"
  
  # Docker detection
  if command -v docker &>/dev/null; then
    DOCKER_AVAILABLE=true
    echo -e "Docker: ${GREEN}Available${NC}"
    
    # If auto-detect is enabled and Docker is available, use it by default
    if [ "$AUTO_DETECT" = true ] && [ "$DOCKER_AVAILABLE" = true ]; then
      USE_DOCKER=true
      echo -e "Auto-selecting Docker installation method"
    fi
  else
    DOCKER_AVAILABLE=false
    echo -e "Docker: ${RED}Not Available${NC}"
  fi
  
  # Database recommendation
  if [ "$AUTO_DETECT" = true ]; then
    if [ $MEMORY_MB -gt 4096 ]; then
      DATABASE_DRIVER="postgres"
      echo -e "Recommended Database: ${GREEN}PostgreSQL${NC} (based on available memory)"
    elif [ $MEMORY_MB -gt 2048 ]; then
      DATABASE_DRIVER="mysql"
      echo -e "Recommended Database: ${GREEN}MySQL${NC} (based on available memory)"
    else
      DATABASE_DRIVER="sqlite"
      echo -e "Recommended Database: ${GREEN}SQLite${NC} (based on available memory)"
    fi
  fi
  
  # Optimization settings based on hardware
  if [ "$OPTIMIZE" = true ]; then
    INDEXING_THREADS=$(($CPU_CORES - 1))
    [ $INDEXING_THREADS -lt 1 ] && INDEXING_THREADS=1
    
    CACHE_SIZE=$(($MEMORY_MB / 4))  # Use 25% of available memory for cache
    
    echo -e "Optimized Settings:"
    echo -e "  - Indexing Threads: ${GREEN}$INDEXING_THREADS${NC}"
    echo -e "  - Cache Size: ${GREEN}$CACHE_SIZE MB${NC}"
  fi
}

# Interactive configuration
configure_interactive() {
  echo -e "${BLUE}=== Interactive Configuration ===${NC}"
  
  # Database selection
  echo -e "${YELLOW}Select database driver:${NC}"
  select db_choice in "SQLite (simple)" "MySQL (medium)" "PostgreSQL (advanced)"; do
    case $db_choice in
      "SQLite (simple)")
        DATABASE_DRIVER="sqlite"
        break
        ;;
      "MySQL (medium)")
        DATABASE_DRIVER="mysql"
        read -p "Database server [localhost:3306]: " DB_SERVER
        DB_SERVER=${DB_SERVER:-localhost:3306}
        read -p "Database username [documind]: " DB_USER
        DB_USER=${DB_USER:-documind}
        read -s -p "Database password: " DB_PASSWORD
        echo
        break
        ;;
      "PostgreSQL (advanced)")
        DATABASE_DRIVER="postgres"
        read -p "Database server [localhost:5432]: " DB_SERVER
        DB_SERVER=${DB_SERVER:-localhost:5432}
        read -p "Database username [documind]: " DB_USER
        DB_USER=${DB_USER:-documind}
        read -s -p "Database password: " DB_PASSWORD
        echo
        break
        ;;
      *)
        echo -e "${RED}Invalid selection${NC}"
        ;;
    esac
  done
  
  # Auth mode
  echo -e "${YELLOW}Select authentication mode:${NC}"
  select auth_choice in "Password (simple)" "OIDC (recommended)" "LDAP (enterprise)"; do
    case $auth_choice in
      "Password (simple)")
        AUTH_MODE="password"
        break
        ;;
      "OIDC (recommended)")
        AUTH_MODE="oidc"
        read -p "OIDC Issuer URL: " OIDC_ISSUER
        read -p "OIDC Client ID: " OIDC_CLIENT_ID
        read -s -p "OIDC Client Secret: " OIDC_CLIENT_SECRET
        echo
        break
        ;;
      "LDAP (enterprise)")
        AUTH_MODE="ldap"
        read -p "LDAP URL: " LDAP_URL
        read -p "LDAP Bind DN: " LDAP_BIND_DN
        read -s -p "LDAP Bind Password: " LDAP_BIND_PASS
        echo
        read -p "LDAP Search Base: " LDAP_SEARCH_BASE
        break
        ;;
      *)
        echo -e "${RED}Invalid selection${NC}"
        ;;
    esac
  done
  
  # Storage path
  read -p "Document storage path [$STORAGE_PATH]: " USER_STORAGE_PATH
  STORAGE_PATH=${USER_STORAGE_PATH:-$STORAGE_PATH}
  
  # Advanced options
  read -p "Enable OCR for documents? [Y/n]: " ENABLE_OCR
  ENABLE_OCR=${ENABLE_OCR:-Y}
  
  read -p "Enable NLP features? [Y/n]: " ENABLE_NLP
  ENABLE_NLP=${ENABLE_NLP:-Y}
  
  read -p "Number of indexing threads [$INDEXING_THREADS]: " USER_THREADS
  INDEXING_THREADS=${USER_THREADS:-$INDEXING_THREADS}
  
  read -p "Cache size in MB [$CACHE_SIZE]: " USER_CACHE
  CACHE_SIZE=${USER_CACHE:-$CACHE_SIZE}
}

# Generate environment configuration file
generate_env_file() {
  ENV_FILE="$INSTALL_DIR/.env"
  
  echo -e "${YELLOW}Generating environment configuration...${NC}"
  
  mkdir -p "$INSTALL_DIR"
  
  cat > "$ENV_FILE" << EOF
# Documind Environment Configuration
# Generated on $(date)

# Database Configuration
DOCUMIND_DATABASE_DRIVER=$DATABASE_DRIVER
EOF

  if [ "$DATABASE_DRIVER" != "sqlite" ]; then
    cat >> "$ENV_FILE" << EOF
DOCUMIND_DATABASE_SERVER=$DB_SERVER
DOCUMIND_DATABASE_USER=$DB_USER
DOCUMIND_DATABASE_PASSWORD=$DB_PASSWORD
DOCUMIND_DATABASE_NAME=documind
EOF
  fi

  cat >> "$ENV_FILE" << EOF

# Authentication Configuration
DOCUMIND_AUTH_MODE=$AUTH_MODE
EOF

  if [ "$AUTH_MODE" = "oidc" ]; then
    cat >> "$ENV_FILE" << EOF
DOCUMIND_OIDC_ISSUER=$OIDC_ISSUER
DOCUMIND_OIDC_CLIENT_ID=$OIDC_CLIENT_ID
DOCUMIND_OIDC_CLIENT_SECRET=$OIDC_CLIENT_SECRET
EOF
  elif [ "$AUTH_MODE" = "ldap" ]; then
    cat >> "$ENV_FILE" << EOF
DOCUMIND_LDAP_URL=$LDAP_URL
DOCUMIND_LDAP_BIND_DN=$LDAP_BIND_DN
DOCUMIND_LDAP_BIND_CREDENTIALS=$LDAP_BIND_PASS
DOCUMIND_LDAP_SEARCH_BASE=$LDAP_SEARCH_BASE
EOF
  fi

  cat >> "$ENV_FILE" << EOF

# Storage Configuration
DOCUMIND_STORAGE_PATH=$STORAGE_PATH
DOCUMIND_STORAGE_MAX_SIZE=10240

# Server Configuration
DOCUMIND_PORT=8080
DOCUMIND_DISABLE_TLS=$DISABLE_TLS

# Performance Configuration
DOCUMIND_INDEXING_THREADS=$INDEXING_THREADS
DOCUMIND_ENABLE_OCR=${ENABLE_OCR:0:1}
DOCUMIND_ENABLE_NLP=${ENABLE_NLP:0:1}
DOCUMIND_CACHE_SIZE=$CACHE_SIZE
EOF

  echo -e "${GREEN}Configuration file created at $ENV_FILE${NC}"
}

# Install Documind using Docker
install_docker() {
  echo -e "${BLUE}=== Installing Documind using Docker ===${NC}"
  
  if [ ! "$DOCKER_AVAILABLE" = true ]; then
    echo -e "${RED}Error: Docker is not available. Please install Docker first.${NC}"
    exit 1
  fi
  
  # Create storage directory
  mkdir -p "$STORAGE_PATH"
  
  # Generate docker-compose file
  DOCKER_COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
  
  cat > "$DOCKER_COMPOSE_FILE" << EOF
version: '3'

services:
  documind:
    image: documind/latest
    container_name: documind
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - $STORAGE_PATH:/var/documind/storage
      - $INSTALL_DIR/.env:/app/.env
EOF

  if [ "$DATABASE_DRIVER" = "mysql" ]; then
    cat >> "$DOCKER_COMPOSE_FILE" << EOF
    depends_on:
      - db
  
  db:
    image: mysql:8
    container_name: documind-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: documind-root-password
      MYSQL_DATABASE: documind
      MYSQL_USER: documind
      MYSQL_PASSWORD: $DB_PASSWORD
    volumes:
      - documind-mysql-data:/var/lib/mysql

volumes:
  documind-mysql-data:
EOF
  elif [ "$DATABASE_DRIVER" = "postgres" ]; then
    cat >> "$DOCKER_COMPOSE_FILE" << EOF
    depends_on:
      - db
  
  db:
    image: postgres:14
    container_name: documind-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: documind
      POSTGRES_USER: documind
      POSTGRES_PASSWORD: $DB_PASSWORD
    volumes:
      - documind-postgres-data:/var/lib/postgresql/data

volumes:
  documind-postgres-data:
EOF
  else
    # End the docker-compose file without a database service for SQLite
    echo "" >> "$DOCKER_COMPOSE_FILE"
  fi
  
  # Start the containers
  cd "$INSTALL_DIR"
  docker-compose up -d
  
  echo -e "${GREEN}Documind has been installed using Docker and is running at http://localhost:8080${NC}"
}

# Install Documind natively
install_native() {
  echo -e "${BLUE}=== Installing Documind natively ===${NC}"
  
  # Install dependencies based on OS
  if [ -f /etc/debian_version ]; then
    echo -e "${YELLOW}Installing dependencies for Debian/Ubuntu...${NC}"
    apt-get update
    apt-get install -y nodejs npm curl wget postgresql-client
    
    if [ "$DATABASE_DRIVER" = "postgres" ]; then
      apt-get install -y postgresql
    elif [ "$DATABASE_DRIVER" = "mysql" ]; then
      apt-get install -y mysql-server
    fi
    
    if [ "$ENABLE_OCR" = "Y" ] || [ "$ENABLE_OCR" = "y" ]; then
      apt-get install -y tesseract-ocr
    fi
  elif [ -f /etc/redhat-release ]; then
    echo -e "${YELLOW}Installing dependencies for RHEL/CentOS...${NC}"
    yum install -y nodejs npm curl wget
    
    if [ "$DATABASE_DRIVER" = "postgres" ]; then
      yum install -y postgresql postgresql-server
    elif [ "$DATABASE_DRIVER" = "mysql" ]; then
      yum install -y mysql mysql-server
    fi
    
    if [ "$ENABLE_OCR" = "Y" ] || [ "$ENABLE_OCR" = "y" ]; then
      yum install -y tesseract
    fi
  else
    echo -e "${RED}Unsupported operating system${NC}"
    exit 1
  fi
  
  # Create user and directories
  useradd -r -s /bin/false documind || true
  mkdir -p "$STORAGE_PATH"
  chown -R documind:documind "$STORAGE_PATH"
  
  # Download Documind package
  echo -e "${YELLOW}Downloading Documind...${NC}"
  cd /tmp
  curl -L -o documind.tar.gz https://get.documind.io/latest
  tar -xzf documind.tar.gz -C "$INSTALL_DIR"
  
  # Set permissions
  chown -R documind:documind "$INSTALL_DIR"
  
  # Create systemd service
  cat > /etc/systemd/system/documind.service << EOF
[Unit]
Description=Documind Document Management System
After=network.target

[Service]
Type=simple
User=documind
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
  
  # Enable and start service
  systemctl daemon-reload
  systemctl enable documind
  systemctl start documind
  
  echo -e "${GREEN}Documind has been installed natively and is running at http://localhost:8080${NC}"
  echo -e "Check status with: ${YELLOW}systemctl status documind${NC}"
}

# Main installation process
main() {
  echo -e "${BLUE}=== Documind Installation ===${NC}"
  
  # Detect system resources
  detect_system
  
  # If interactive mode is selected, run the configuration wizard
  if [ "$INTERACTIVE" = true ]; then
    configure_interactive
  fi
  
  # Generate the configuration file
  generate_env_file
  
  # Install Documind
  if [ "$USE_DOCKER" = true ]; then
    install_docker
  else
    install_native
  fi
  
  echo -e "${GREEN}Documind installation completed successfully!${NC}"
  echo -e "Access the web interface at ${BLUE}http://localhost:8080${NC}"
}

# Run the main installation procedure
main
