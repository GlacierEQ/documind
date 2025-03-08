#!/bin/bash

# Documind Restore Script
# This script restores backups of the Documind database and document storage

set -e

# Default settings
BACKUP_DIR="./backups"
BACKUP_NAME=""
CONFIG_FILE="./.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --backup-dir=*)
      BACKUP_DIR="${1#*=}"
      shift
      ;;
    --config=*)
      CONFIG_FILE="${1#*=}"
      shift
      ;;
    --name=*)
      BACKUP_NAME="${1#*=}"
      shift
      ;;
    --help)
      echo "Usage: $0 --name=BACKUP_NAME [options]"
      echo "Options:"
      echo "  --backup-dir=DIR   Backup directory (default: ./backups)"
      echo "  --config=FILE      Configuration file path (default: ./.env)"
      echo "  --name=NAME        Backup name to restore (required)"
      echo "  --help             Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Check if backup name is provided
if [ -z "$BACKUP_NAME" ]; then
  echo -e "${RED}Error: Backup name is required. Use --name=BACKUP_NAME${NC}"
  exit 1
fi

# Load configuration from .env file
if [ -f "$CONFIG_FILE" ]; then
  echo -e "${BLUE}Loading configuration from $CONFIG_FILE${NC}"
  source "$CONFIG_FILE"
else
  echo -e "${RED}Configuration file $CONFIG_FILE not found${NC}"
  exit 1
fi

# Check if backup files exist
DB_BACKUP=""
if [ -f "$BACKUP_DIR/${BACKUP_NAME}_db.sqlite" ]; then
  DB_BACKUP="$BACKUP_DIR/${BACKUP_NAME}_db.sqlite"
elif [ -f "$BACKUP_DIR/${BACKUP_NAME}_db.sql" ]; then
  DB_BACKUP="$BACKUP_DIR/${BACKUP_NAME}_db.sql"
else
  echo -e "${RED}Database backup file not found for $BACKUP_NAME${NC}"
  exit 1
fi

STORAGE_BACKUP="$BACKUP_DIR/${BACKUP_NAME}_storage.tar.gz"
if [ ! -f "$STORAGE_BACKUP" ]; then
  echo -e "${RED}Storage backup file not found at $STORAGE_BACKUP${NC}"
  exit 1
fi

# Function to restore SQLite database
restore_sqlite() {
  local db_file="data/documind.sqlite"
  local backup_file="$DB_BACKUP"
  
  echo -e "${YELLOW}Restoring SQLite database...${NC}"
  
  # Create data directory if it doesn't exist
  mkdir -p "$(dirname "$db_file")"
  
  # Backup current database if it exists
  if [ -f "$db_file" ]; then
    cp "$db_file" "${db_file}.bak"
    echo -e "${BLUE}Existing database backed up to ${db_file}.bak${NC}"
  fi
  
  # Copy backup file to database location
  cp "$backup_file" "$db_file"
  
  echo -e "${GREEN}SQLite database restored from $backup_file${NC}"
}

# Function to restore MySQL database
restore_mysql() {
  local host=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f1)
  local port=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f2)
  local backup_file="$DB_BACKUP"
  
  echo -e "${YELLOW}Restoring MySQL database...${NC}"
  
  # Create database if it doesn't exist
  mysql -h "$host" -P "$port" -u "$DOCUMIND_DATABASE_USER" \
    --password="$DOCUMIND_DATABASE_PASSWORD" \
    -e "CREATE DATABASE IF NOT EXISTS \`$DOCUMIND_DATABASE_NAME\`;"
  
  # Restore database from backup
  mysql -h "$host" -P "$port" -u "$DOCUMIND_DATABASE_USER" \
    --password="$DOCUMIND_DATABASE_PASSWORD" \
    "$DOCUMIND_DATABASE_NAME" < "$backup_file"
  
  echo -e "${GREEN}MySQL database restored from $backup_file${NC}"
}

# Function to restore PostgreSQL database
restore_postgres() {
  local host=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f1)
  local port=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f2)
  local backup_file="$DB_BACKUP"
  
  echo -e "${YELLOW}Restoring PostgreSQL database...${NC}"
  
  # Set PGPASSWORD environment variable
  export PGPASSWORD="$DOCUMIND_DATABASE_PASSWORD"
  
  # Create database if it doesn't exist
  psql -h "$host" -p "$port" -U "$DOCUMIND_DATABASE_USER" \
    -d "postgres" -c "CREATE DATABASE $DOCUMIND_DATABASE_NAME WITH OWNER $DOCUMIND_DATABASE_USER;" || true
  
  # Restore database from backup
  psql -h "$host" -p "$port" -U "$DOCUMIND_DATABASE_USER" \
    -d "$DOCUMIND_DATABASE_NAME" -f "$backup_file"
  
  # Unset PGPASSWORD
  unset PGPASSWORD
  
  echo -e "${GREEN}PostgreSQL database restored from $backup_file${NC}"
}

# Function to restore document storage
restore_storage() {
  local storage_dir="$DOCUMIND_STORAGE_PATH"
  local backup_file="$STORAGE_BACKUP"
  
  echo -e "${YELLOW}Restoring document storage to $storage_dir...${NC}"
  
  # Create parent directory if it doesn't exist
  mkdir -p "$(dirname "$storage_dir")"
  
  # Backup current storage if it exists
  if [ -d "$storage_dir" ]; then
    mv "$storage_dir" "${storage_dir}.bak"
    echo -e "${BLUE}Existing storage backed up to ${storage_dir}.bak${NC}"
  fi
  
  # Extract backup archive
  mkdir -p "$storage_dir"
  tar -xzf "$backup_file" -C "$(dirname "$storage_dir")"
  
  echo -e "${GREEN}Document storage restored from $backup_file${NC}"
}

# Perform restore
echo -e "${BLUE}Starting Documind restore...${NC}"

# Confirm before proceeding
echo -e "${YELLOW}Warning: This will overwrite your current database and document storage.${NC}"
read -p "Are you sure you want to continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${BLUE}Restore cancelled.${NC}"
  exit 0
fi

# Stop Documind service if running
echo -e "${YELLOW}Stopping Documind service...${NC}"
if command -v systemctl &> /dev/null && systemctl is-active --quiet documind; then
  sudo systemctl stop documind
  echo -e "${GREEN}Documind service stopped${NC}"
elif command -v docker &> /dev/null && docker ps | grep -q documind; then
  docker stop documind
  echo -e "${GREEN}Documind Docker container stopped${NC}"
else
  echo -e "${BLUE}No running Documind service detected${NC}"
fi

# Restore database
case "$DOCUMIND_DATABASE_DRIVER" in
  sqlite)
    restore_sqlite
    ;;
  mysql)
    restore_mysql
    ;;
  postgres)
    restore_postgres
    ;;
  *)
    echo -e "${RED}Unsupported database driver: $DOCUMIND_DATABASE_DRIVER${NC}"
    exit 1
    ;;
esac

# Restore document storage
restore_storage

# Start Documind service
echo -e "${YELLOW}Starting Documind service...${NC}"
if command -v systemctl &> /dev/null && systemctl is-enabled --quiet documind; then
  sudo systemctl start documind
  echo -e "${GREEN}Documind service started${NC}"
elif command -v docker &> /dev/null && docker ps -a | grep -q documind; then
  docker start documind
  echo -e "${GREEN}Documind Docker container started${NC}"
else
  echo -e "${BLUE}No Documind service found to start${NC}"
  echo -e "${BLUE}Please start Documind manually${NC}"
fi

echo -e "${GREEN}Restore completed successfully!${NC}"
