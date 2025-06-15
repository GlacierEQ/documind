#!/bin/bash
#
# Documind Docker Initialization Script
# This script initializes the Documind Docker environment

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Documind Docker Setup ===${NC}"
echo -e "${BLUE}This script will set up Documind with Docker${NC}\n"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo -e "${YELLOW}Please install Docker first:${NC} https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed${NC}"
    echo -e "${YELLOW}Please install Docker Compose first:${NC} https://docs.docker.com/compose/install/"
    exit 1
fi

# Create necessary directories
echo -e "\n${GREEN}Creating necessary directories...${NC}"
mkdir -p logs docker/db/init docker/nginx/ssl data/uploads data/temp data/templates

# Create .env.docker if it doesn't exist
if [ ! -f .env.docker ]; then
    echo -e "\n${GREEN}Creating .env.docker file...${NC}"
    cp -n .env.template .env.docker
    echo -e "${YELLOW}Please edit .env.docker to update your environment settings${NC}"
fi

# Generate SSL certificates for development
if [ ! -f docker/nginx/ssl/cert.pem ]; then
    echo -e "\n${GREEN}Generating self-signed SSL certificates for development...${NC}"
    mkdir -p docker/nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout docker/nginx/ssl/key.pem \
        -out docker/nginx/ssl/cert.pem \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
fi

# Set permissions
echo -e "\n${GREEN}Setting file permissions...${NC}"
chmod -R 755 docker
chmod +x docker/backup/*.sh

# Build and start the containers
echo -e "\n${GREEN}Building and starting Docker containers...${NC}"
docker-compose build
docker-compose up -d

echo -e "\n${GREEN}Documind is now running!${NC}"
echo -e "${BLUE}You can access it at:${NC} http://localhost:3000"
echo -e "${BLUE}To view logs:${NC} docker-compose logs -f app"
echo -e "${BLUE}To stop:${NC} docker-compose down"
