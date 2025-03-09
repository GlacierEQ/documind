#!/bin/bash
#
# Documind Automated Installation Script
# Sets up Documind with zero or minimal user intervention

set -e

# Colors for console output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default configuration
AUTO_MODE=false
INSTALL_METHOD="docker"  # Default to docker installation
DB_TYPE="postgres"       # Default to PostgreSQL
USE_NGINX=true           # Use nginx by default
ENABLE_MONITORING=true   # Enable monitoring by default
GENERATE_SSL=true        # Generate self-signed SSL by default
ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)

# Print header
print_header() {
    echo -e "${BLUE}${BOLD}"
    echo "╔══════════════════════════════════════════════════╗"
    echo "║               DOCUMIND INSTALLER                 ║"
    echo "║       Document Management & AI Platform          ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Process command line arguments
process_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --auto)
                AUTO_MODE=true
                shift
                ;;
            --method=*)
                INSTALL_METHOD="${1#*=}"
                shift
                ;;
            --database=*)
                DB_TYPE="${1#*=}"
                shift
                ;;
            --no-nginx)
                USE_NGINX=false
                shift
                ;;
            --no-monitoring)
                ENABLE_MONITORING=false
                shift
                ;;
            --no-ssl)
                GENERATE_SSL=false
                shift
                ;;
            --admin-password=*)
                ADMIN_PASSWORD="${1#*=}"
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}"
                show_help
                exit 1
                ;;
        esac
    done
}

# Show help
show_help() {
    echo -e "${BLUE}Usage:${NC}"
    echo "  ./install.sh [OPTIONS]"
    echo ""
    echo -e "${BLUE}Options:${NC}"
    echo "  --auto                Fully automated installation with no prompts"
    echo "  --method=docker|local Installation method (default: docker)"
    echo "  --database=postgres|mysql|sqlite  Database type (default: postgres)"
    echo "  --no-nginx           Don't use nginx reverse proxy"
    echo "  --no-monitoring      Don't install monitoring components"
    echo "  --no-ssl             Don't generate SSL certificates"
    echo "  --admin-password=XXX Set specific admin password"
    echo "  --help               Show this help message"
}

# Detect system capabilities
detect_system() {
    echo -e "${YELLOW}Detecting system capabilities...${NC}"
    
    # Check for Docker
    if command -v docker &> /dev/null; then
        echo -e "Docker: ${GREEN}Available${NC}"
        DOCKER_AVAILABLE=true
        DOCKER_VERSION=$(docker --version | awk '{print $3}' | tr -d ',')
        
        # Check Docker Compose
        if command -v docker-compose &> /dev/null; then
            echo -e "Docker Compose: ${GREEN}Available${NC}"
            COMPOSE_AVAILABLE=true
        elif docker compose version &> /dev/null; then
            echo -e "Docker Compose Plugin: ${GREEN}Available${NC}"
            COMPOSE_AVAILABLE=true
            COMPOSE_PLUGIN=true
        else
            echo -e "Docker Compose: ${RED}Missing${NC}"
            COMPOSE_AVAILABLE=false
        fi
    else
        echo -e "Docker: ${RED}Not available${NC}"
        DOCKER_AVAILABLE=false
        COMPOSE_AVAILABLE=false
    fi
    
    # Get system resources
    CPU_COUNT=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "4")
    MEMORY_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo "8192")
    DISK_GB=$(df -BG . 2>/dev/null | awk 'NR==2 {gsub("G", "", $4); print $4}' || echo "100")
    
    echo -e "CPUs: ${GREEN}${CPU_COUNT}${NC}"
    echo -e "Memory: ${GREEN}${MEMORY_MB} MB${NC}"
    echo -e "Available disk space: ${GREEN}${DISK_GB} GB${NC}"
    
    # Optimize based on resources
    if [ $CPU_COUNT -ge 4 ]; then
        WORKER_PROCESSES=$((CPU_COUNT / 2))
    else
        WORKER_PROCESSES=1
    fi
    
    if [ $MEMORY_MB -ge 8192 ]; then
        JVM_HEAP="-Xms2g -Xmx4g"
        PG_MEMORY="2GB"
        CACHE_SIZE="2GB"
    elif [ $MEMORY_MB -ge 4096 ]; then
        JVM_HEAP="-Xms1g -Xmx2g"
        PG_MEMORY="1GB"
        CACHE_SIZE="1GB"
    else
        JVM_HEAP="-Xms512m -Xmx1g"
        PG_MEMORY="512MB"
        CACHE_SIZE="512MB"
    fi
    
    # Suggest installation method based on detected capabilities
    if [ "$DOCKER_AVAILABLE" = true ] && [ "$COMPOSE_AVAILABLE" = true ]; then
        SUGGESTED_METHOD="docker"
    else
        SUGGESTED_METHOD="local"
    fi
}

# Configure installation interactively, if not in auto mode
configure() {
    if [ "$AUTO_MODE" = true ]; then
        echo -e "${YELLOW}Running in automatic mode with default configuration:${NC}"
        echo -e "  Installation method: ${CYAN}${INSTALL_METHOD}${NC}"
        echo -e "  Database type: ${CYAN}${DB_TYPE}${NC}"
        echo -e "  Use nginx: ${CYAN}${USE_NGINX}${NC}"
        echo -e "  Enable monitoring: ${CYAN}${ENABLE_MONITORING}${NC}"
        echo -e "  Generate SSL certificates: ${CYAN}${GENERATE_SSL}${NC}"
        echo
        return
    fi
    
    # Ask for installation method
    echo -e "\n${YELLOW}Please select installation method:${NC}"
    echo "1) Docker installation (recommended)"
    echo "2) Local installation"
    read -p "Enter your choice [1-2] (default: $SUGGESTED_METHOD): " choice
    
    case $choice in
        2) INSTALL_METHOD="local" ;;
        *) INSTALL_METHOD="docker" ;;
    esac
    
    # For Docker installation, ask for database
    if [ "$INSTALL_METHOD" = "docker" ]; then
        echo -e "\n${YELLOW}Please select database type:${NC}"
        echo "1) PostgreSQL (recommended for production)"
        echo "2) MySQL"
        echo "3) SQLite (lightweight)"
        read -p "Enter your choice [1-3] (default: 1): " db_choice
        
        case $db_choice in
            2) DB_TYPE="mysql" ;;
            3) DB_TYPE="sqlite" ;;
            *) DB_TYPE="postgres" ;;
        esac
        
        # Ask for nginx
        read -p "Use nginx as reverse proxy? [Y/n]: " nginx_choice
        if [[ "$nginx_choice" =~ ^[Nn] ]]; then
            USE_NGINX=false
        fi
        
        # Ask for monitoring
        read -p "Enable monitoring (Prometheus & Grafana)? [Y/n]: " monitoring_choice
        if [[ "$monitoring_choice" =~ ^[Nn] ]]; then
            ENABLE_MONITORING=false
        fi
    fi
    
    # Ask for SSL
    if [ "$USE_NGINX" = true ]; then
        read -p "Generate self-signed SSL certificates? [Y/n]: " ssl_choice
        if [[ "$ssl_choice" =~ ^[Nn] ]]; then
            GENERATE_SSL=false
        fi
    fi
}

# Install Docker and dependencies if needed
install_dependencies() {
    if [ "$INSTALL_METHOD" != "docker" ]; then
        return
    fi
    
    if [ "$DOCKER_AVAILABLE" = false ] || [ "$COMPOSE_AVAILABLE" = false ]; then
        echo -e "${YELLOW}Installing required dependencies...${NC}"
        
        # Check OS
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS=$ID
        else
            echo -e "${RED}Cannot detect OS, please install Docker manually.${NC}"
            exit 1
        fi
        
        # Install Docker based on OS
        case $OS in
            ubuntu|debian)
                sudo apt-get update
                sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
                curl -fsSL https://download.docker.com/linux/$OS/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
                echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
                sudo apt-get update
                sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
                ;;
            fedora)
                sudo dnf -y install dnf-plugins-core
                sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
                sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
                ;;
            centos|rhel)
                sudo yum install -y yum-utils
                sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
                sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
                ;;
            *)
                echo -e "${RED}Unsupported OS: $OS${NC}"
                echo -e "${YELLOW}Please install Docker manually:${NC} https://docs.docker.com/get-docker/"
                exit 1
                ;;
        esac
        
        # Start and enable Docker service
        sudo systemctl enable docker
        sudo systemctl start docker
        
        # Add current user to docker group
        sudo usermod -aG docker $(whoami)
        echo -e "${GREEN}Docker installed successfully!${NC}"
        echo -e "${YELLOW}NOTE: You may need to log out and back in for docker group changes to take effect.${NC}"
        
        DOCKER_AVAILABLE=true
        COMPOSE_AVAILABLE=true
        COMPOSE_PLUGIN=true
    fi
}

# Create directories
create_directories() {
    echo -e "${YELLOW}Creating necessary directories...${NC}"
    
    mkdir -p data/uploads \
             data/temp \
             data/templates \
             logs \
             docker/db/init \
             docker/grafana/provisioning/dashboards \
             docker/grafana/provisioning/datasources

    if [ "$GENERATE_SSL" = true ]; then
        mkdir -p docker/nginx/ssl
    fi
}

# Generate environment config file
generate_env_file() {
    echo -e "${YELLOW}Generating configuration files...${NC}"
    
    # Generate random secrets
    DB_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
    REDIS_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
    SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)
    
    # Create env file
    cat > .env.docker << EOF
# Documind Docker Environment
# Generated on $(date)

# Application settings
PORT=3000
NODE_ENV=production
SESSION_SECRET=${SESSION_SECRET}
APP_URL=http://localhost

# Database configuration
DB_TYPE=${DB_TYPE}
DB_HOST=db
DB_PORT=$([ "$DB_TYPE" = "postgres" ] && echo 5432 || echo 3306)
DB_NAME=documind
DB_USER=documind
DB_PASSWORD=${DB_PASSWORD}

# Redis configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}

# Storage settings
STORAGE_TYPE=local
STORAGE_PATH=/app/data/uploads
MAX_FILE_SIZE=50MB

# AI configuration
AI_PROVIDER=granite
AI_MAX_TOKENS=4000
AI_TEMPERATURE=0.2

# Granite AI Config
GRANITE_API_KEY=your-granite-api-key-here
GRANITE_MODEL=granite-34b-instruct
GRANITE_EMBEDDING_MODEL=granite-embedding

# Backup configuration
BACKUP_SCHEDULE=0 0 * * *  # Daily at midnight
BACKUP_RETENTION_DAYS=7

# Default admin user
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_EMAIL=admin@example.com

# Monitoring (Prometheus & Grafana)
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Nginx configuration
NGINX_PORT=$([ "$GENERATE_SSL" = true ] && echo 80 || echo 3001)
NGINX_SSL_PORT=443
EOF

    echo -e "${GREEN}Configuration created at .env.docker${NC}"
}

# Generate SSL certificates if needed
generate_ssl() {
    if [ "$GENERATE_SSL" = true ] && [ "$USE_NGINX" = true ]; then
        echo -e "${YELLOW}Generating self-signed SSL certificates...${NC}"
        
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout docker/nginx/ssl/private.key \
            -out docker/nginx/ssl/certificate.crt \
            -subj "/C=US/ST=State/L=City/O=Documind/CN=localhost"
            
        echo -e "${GREEN}SSL certificates generated.${NC}"
    fi
}

# Generate optimized docker-compose.yml
generate_docker_compose() {
    if [ "$INSTALL_METHOD" != "docker" ]; then
        return
    fi

    echo -e "${YELLOW}Generating optimized docker-compose.yml...${NC}"
    
    cat > docker-compose.yml << EOF
version: '3.8'

services:
  # Main application
  app:
    build:
      context: .
      dockerfile: ./docker/Dockerfile
      args:
        - NODE_ENV=production
    restart: unless-stopped
    ports:
      - "${USE_NGINX:+"127.0.0.1:"}3000:3000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - documind-data:/app/data
      - ./logs:/app/logs
    env_file:
      - .env.docker
    environment:
      - NODE_ENV=production
      - DB_HOST=db
      - REDIS_HOST=redis
    deploy:
      resources:
        limits:
          cpus: '${WORKER_PROCESSES}.0'
          memory: ${CACHE_SIZE}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - documind-network
EOF

    # Add database service based on selected type
    if [ "$DB_TYPE" = "postgres" ]; then
        cat >> docker-compose.yml << EOF

  # PostgreSQL database
  db:
    image: postgres:14-alpine
    restart: unless-stopped
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./docker/db/init:/docker-entrypoint-initdb.d
      - ./docker/db/postgres.conf:/etc/postgresql/postgresql.conf
    environment:
      - POSTGRES_USER=\${DB_USER:-documind}
      - POSTGRES_PASSWORD=\${DB_PASSWORD:-documind}
      - POSTGRES_DB=\${DB_NAME:-documind}
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "\${DB_USER:-documind}"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: ${PG_MEMORY}
    networks:
      - documind-network
EOF
    elif [ "$DB_TYPE" = "mysql" ]; then
        cat >> docker-compose.yml << EOF

  # MySQL database
  db:
    image: mysql:8
    restart: unless-stopped
    volumes:
      - mysql-data:/var/lib/mysql
      - ./docker/db/init:/docker-entrypoint-initdb.d
      - ./docker/mysql/my.cnf:/etc/mysql/conf.d/custom.cnf
    environment:
      - MYSQL_ROOT_PASSWORD=\${DB_ROOT_PASSWORD:-root}
      - MYSQL_DATABASE=\${DB_NAME:-documind}
      - MYSQL_USER=\${DB_USER:-documind}
      - MYSQL_PASSWORD=\${DB_PASSWORD:-documind}
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "\${DB_USER:-documind}", "-p\${DB_PASSWORD:-documind}"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: ${PG_MEMORY}
    networks:
      - documind-network
EOF
    else
        # SQLite doesn't need a service
        echo "# Using SQLite database (no service required)" >> docker-compose.yml
    fi

    # Add Redis service
    cat >> docker-compose.yml << EOF

  # Redis for caching and session storage
  redis:
    image: redis:alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data
      - ./docker/redis/redis.conf:/usr/local/etc/redis/redis.conf
    command: redis-server /usr/local/etc/redis/redis.conf --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    networks:
      - documind-network
EOF

    # Add Nginx service if enabled
    if [ "$USE_NGINX" = true ]; then
        cat >> docker-compose.yml << EOF

  # Nginx for serving static files and reverse proxy
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "\${NGINX_PORT:-80}:80"
      - "\${NGINX_SSL_PORT:-443}:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./docker/nginx/conf.d:/etc/nginx/conf.d:ro
      - ./public:/usr/share/nginx/html:ro
      - ./docker/nginx/ssl:/etc/nginx/ssl:ro
      - ./logs/nginx:/var/log/nginx
    depends_on:
      - app
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
    networks:
      - documind-network
EOF
    fi

    # Add backup service
    cat >> docker-compose.yml << EOF

  # Backup service
  backup:
    build:
      context: ./docker/backup
      dockerfile: Dockerfile
    restart: unless-stopped
    volumes:
      - documind-data:/data/app:ro
      - ${DB_TYPE}-data:/data/db:ro
      - backups:/backups
    environment:
      - BACKUP_SCHEDULE=\${BACKUP_SCHEDULE:-0 0 * * *}
      - DB_TYPE=${DB_TYPE}
      - DB_HOST=db
      - DB_USER=\${DB_USER:-documind}
      - DB_PASSWORD=\${DB_PASSWORD:-documind}
      - DB_NAME=\${DB_NAME:-documind}
      - RETENTION_DAYS=\${BACKUP_RETENTION_DAYS:-7}
    networks:
      - documind-network
EOF

    # Add monitoring services if enabled
    if [ "$ENABLE_MONITORING" = true ]; then
        cat >> docker-compose.yml << EOF

  # Monitoring: Prometheus
  prometheus:
    image: prom/prometheus:latest
    restart: unless-stopped
    volumes:
      - ./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
    networks:
      - documind-network

  # Monitoring: Grafana
  grafana:
    image: grafana/grafana:latest
    restart: unless-stopped
    volumes:
      - grafana-data:/var/lib/grafana
      - ./docker/grafana/provisioning:/etc/grafana/provisioning
    environment:
      - GF_SECURITY_ADMIN_USER=\${GRAFANA_ADMIN_USER:-admin}
      - GF_SECURITY_ADMIN_PASSWORD=\${GRAFANA_ADMIN_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
    depends_on:
      - prometheus
    ports:
      - "127.0.0.1:3002:3000"
    networks:
      - documind-network

  # Node Exporter for system metrics
  node-exporter:
    image: prom/node-exporter:latest
    restart: unless-stopped
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - documind-network
EOF
    fi

    # Add network and volumes configuration
    cat >> docker-compose.yml << EOF

networks:
  documind-network:
    driver: bridge

volumes:
  documind-data:
    driver: local
EOF

    # Add appropriate volume based on DB choice
    if [ "$DB_TYPE" = "postgres" ]; then
        cat >> docker-compose.yml << EOF
  postgres-data:
    driver: local
EOF
    elif [ "$DB_TYPE" = "mysql" ]; then
        cat >> docker-compose.yml << EOF
  mysql-data:
    driver: local
EOF
    fi

    # Add other volumes
    cat >> docker-compose.yml << EOF
  redis-data:
    driver: local
  backups:
    driver: local
EOF

    # Add monitoring volumes if enabled
    if [ "$ENABLE_MONITORING" = true ]; then
        cat >> docker-compose.yml << EOF
  prometheus-data:
    driver: local
  grafana-data:
    driver: local
EOF
    fi
    
    echo -e "${GREEN}Generated optimized docker-compose.yml${NC}"
}

# Deploy with Docker
deploy_with_docker() {
    if [ "$INSTALL_METHOD" != "docker" ]; then
        return
    fi

    echo -e "${YELLOW}Starting Docker containers...${NC}"
    
    # Build and start containers
    if [ "$COMPOSE_PLUGIN" = true ]; then
        docker compose build
        docker compose up -d
    else
        docker-compose build
        docker-compose up -d
    fi
    
    echo -e "${GREEN}Docker containers started successfully!${NC}"
}

# Generate post-installation instructions
generate_instructions() {
    echo
    echo -e "${BLUE}${BOLD}=== INSTALLATION COMPLETE ===${NC}"
    echo
    echo -e "${GREEN}Documind has been successfully installed!${NC}"
    echo
    echo -e "${YELLOW}${BOLD}Access Information:${NC}"
    
    if [ "$INSTALL_METHOD" = "docker" ]; then
        if [ "$USE_NGINX" = true ]; then
            if [ "$GENERATE_SSL" = true ]; then
                echo -e "${GREEN}Web Interface: ${CYAN}https://localhost${NC}"
            else
                echo -e "${GREEN}Web Interface: ${CYAN}http://localhost:3001${NC}"
            fi
        else
            echo -e "${GREEN}Web Interface: ${CYAN}http://localhost:3000${NC}"
        fi
        
        if [ "$ENABLE_MONITORING" = true ]; then
            echo -e "${GREEN}Grafana Dashboard: ${CYAN}http://localhost:3002${NC}"
        fi
        
        echo
        echo -e "${YELLOW}${BOLD}Login Credentials:${NC}"
        echo -e "${GREEN}Username: ${CYAN}admin${NC}"
        echo -e "${GREEN}Password: ${CYAN}${ADMIN_PASSWORD}${NC}"
        
        echo
        echo -e "${YELLOW}${BOLD}Useful Commands:${NC}"
        
        if [ "$COMPOSE_PLUGIN" = true ]; then
            echo -e "${GREEN}View logs: ${CYAN}docker compose logs -f app${NC}"
            echo -e "${GREEN}Stop services: ${CYAN}docker compose down${NC}"
            echo -e "${GREEN}Restart services: ${CYAN}docker compose restart${NC}"
        else
            echo -e "${GREEN}View logs: ${CYAN}docker-compose logs -f app${NC}"
            echo -e "${GREEN}Stop services: ${CYAN}docker-compose down${NC}"
            echo -e "${GREEN}Restart services: ${CYAN}docker-compose restart${NC}"
        fi
    else
        # Local installation instructions would go here
        echo -e "${GREEN}Local Installation: ${CYAN}Instructions not yet implemented${NC}"
    fi
    
    echo
    echo -e "${YELLOW}${BOLD}Next Steps:${NC}"
    echo -e "1. ${GREEN}Change the default admin password immediately${NC}"
    echo -e "2. ${GREEN}Configure your AI provider in Settings > AI${NC}"
    echo -e "3. ${GREEN}Set up regular backups${NC}"
    echo
    echo -e "${BLUE}${BOLD}Thank you for installing Documind!${NC}"
    echo
}

# Main function
main() {
    print_header
    process_args "$@"
    detect_system
    configure
    install_dependencies
    create_directories
    generate_env_file
    generate_ssl
    generate_docker_compose
    deploy_with_docker
    generate_instructions
}

# Run the installer
main "$@"
