#!/bin/bash

# Documind Backup Script
# This script creates backups of the Documind database and document storage

set -e

# Default settings
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="documind_backup_$TIMESTAMP"
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
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --backup-dir=DIR   Backup directory (default: ./backups)"
      echo "  --config=FILE      Configuration file path (default: ./.env)"
      echo "  --name=NAME        Backup name (default: documind_backup_TIMESTAMP)"
      echo "  --help             Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Load configuration from .env file
if [ -f "$CONFIG_FILE" ]; then
  echo -e "${BLUE}Loading configuration from $CONFIG_FILE${NC}"
  source "$CONFIG_FILE"
else
  echo -e "${RED}Configuration file $CONFIG_FILE not found${NC}"
  exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Function to backup SQLite database
backup_sqlite() {
  local db_file="data/documind.sqlite"
  local backup_file="$BACKUP_DIR/${BACKUP_NAME}_db.sqlite"
  
  echo -e "${YELLOW}Backing up SQLite database...${NC}"
  
  if [ ! -f "$db_file" ]; then
    echo -e "${RED}SQLite database file not found at $db_file${NC}"
    return 1
  fi
  
  # Create a copy of the database file
  cp "$db_file" "$backup_file"
  
  echo -e "${GREEN}SQLite database backed up to $backup_file${NC}"
}

# Function to backup MySQL database
backup_mysql() {
  local host=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f1)
  local port=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f2)
  local backup_file="$BACKUP_DIR/${BACKUP_NAME}_db.sql"
  
  echo -e "${YELLOW}Backing up MySQL database...${NC}"
  
  # Run mysqldump to create a backup
  mysqldump -h "$host" -P "$port" -u "$DOCUMIND_DATABASE_USER" \
    --password="$DOCUMIND_DATABASE_PASSWORD" \
    "$DOCUMIND_DATABASE_NAME" > "$backup_file"
  
  echo -e "${GREEN}MySQL database backed up to $backup_file${NC}"
}

# Function to backup PostgreSQL database
backup_postgres() {
  local host=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f1)
  local port=$(echo $DOCUMIND_DATABASE_SERVER | cut -d: -f2)
  local backup_file="$BACKUP_DIR/${BACKUP_NAME}_db.sql"
  
  echo -e "${YELLOW}Backing up PostgreSQL database...${NC}"
  
  # Set PGPASSWORD environment variable
  export PGPASSWORD="$DOCUMIND_DATABASE_PASSWORD"
  
  # Run pg_dump to create a backup
  pg_dump -h "$host" -p "$port" -U "$DOCUMIND_DATABASE_USER" \
    "$DOCUMIND_DATABASE_NAME" > "$backup_file"
  
  # Unset PGPASSWORD
  unset PGPASSWORD
  
  echo -e "${GREEN}PostgreSQL database backed up to $backup_file${NC}"
}

# Function to backup document storage
backup_storage() {
  local storage_dir="$DOCUMIND_STORAGE_PATH"
  local backup_file="$BACKUP_DIR/${BACKUP_NAME}_storage.tar.gz"
  
  echo -e "${YELLOW}Backing up document storage from $storage_dir...${NC}"
  
  if [ ! -d "$storage_dir" ]; then
    echo -e "${RED}Storage directory not found at $storage_dir${NC}"
    return 1
  fi
  
  # Create tar archive of the storage directory
  tar -czf "$backup_file" -C "$(dirname "$storage_dir")" "$(basename "$storage_dir")"
  
  echo -e "${GREEN}Document storage backed up to $backup_file${NC}"
}

# Perform backup based on database driver
echo -e "${BLUE}Starting Documind backup...${NC}"

# Backup database
case "$DOCUMIND_DATABASE_DRIVER" in
  sqlite)
    backup_sqlite
    ;;
  mysql)
    backup_mysql
    ;;
  postgres)
    backup_postgres
    ;;
  *)
    echo -e "${RED}Unsupported database driver: $DOCUMIND_DATABASE_DRIVER${NC}"
    exit 1
    ;;
esac

# Backup document storage
backup_storage

# Generate backup info file
cat > "$BACKUP_DIR/${BACKUP_NAME}_info.txt" << EOF
Documind Backup Information
===========================
Date: $(date)
Database Driver: $DOCUMIND_DATABASE_DRIVER
Storage Path: $DOCUMIND_STORAGE_PATH

To restore this backup:
1. Run the restore script: ./scripts/restore.sh --backup-dir=$BACKUP_DIR --name=$BACKUP_NAME
EOF

echo -e "${GREEN}Backup completed successfully!${NC}"
echo -e "Backup files are located in ${BLUE}$BACKUP_DIR${NC}"
