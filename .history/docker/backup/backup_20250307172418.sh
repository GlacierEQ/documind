#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Default paths
BACKUP_DIR="/backups"
STORAGE_PATH="/var/documind/storage"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="documind_backup_$TIMESTAMP"

echo -e "${YELLOW}Starting Documind backup...${NC}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Function to backup PostgreSQL database
backup_postgres() {
  echo -e "${YELLOW}Backing up PostgreSQL database...${NC}"
  PGPASSWORD="$DOCUMIND_DATABASE_PASSWORD" pg_dump -h "${DOCUMIND_DATABASE_SERVER%%:*}" \
    -p "${DOCUMIND_DATABASE_SERVER##*:}" \
    -U "$DOCUMIND_DATABASE_USER" \
    "$DOCUMIND_DATABASE_NAME" > "$BACKUP_DIR/${BACKUP_NAME}_db.sql"
  
  echo -e "${GREEN}PostgreSQL database backed up to ${BACKUP_NAME}_db.sql${NC}"
}

# Function to backup MySQL database
backup_mysql() {
  echo -e "${YELLOW}Backing up MySQL database...${NC}"
  mysqldump -h "${DOCUMIND_DATABASE_SERVER%%:*}" \
    -P "${DOCUMIND_DATABASE_SERVER##*:}" \
    -u "$DOCUMIND_DATABASE_USER" \
    -p"$DOCUMIND_DATABASE_PASSWORD" \
    "$DOCUMIND_DATABASE_NAME" > "$BACKUP_DIR/${BACKUP_NAME}_db.sql"
  
  echo -e "${GREEN}MySQL database backed up to ${BACKUP_NAME}_db.sql${NC}"
}

# Function to backup SQLite database
backup_sqlite() {
  echo -e "${YELLOW}Backing up SQLite database...${NC}"
  if [ -f /var/documind/data/documind.sqlite ]; then
    cp /var/documind/data/documind.sqlite "$BACKUP_DIR/${BACKUP_NAME}_db.sqlite"
    echo -e "${GREEN}SQLite database backed up to ${BACKUP_NAME}_db.sqlite${NC}"
  else
    echo -e "${RED}SQLite database file not found at expected location${NC}"
    return 1
  fi
}

# Function to backup document storage
backup_storage() {
  echo -e "${YELLOW}Backing up document storage...${NC}"
  tar -czf "$BACKUP_DIR/${BACKUP_NAME}_storage.tar.gz" -C "$(dirname "$STORAGE_PATH")" "$(basename "$STORAGE_PATH")"
  echo -e "${GREEN}Document storage backed up to ${BACKUP_NAME}_storage.tar.gz${NC}"
}

# Perform backup based on database driver
case "$DOCUMIND_DATABASE_DRIVER" in
  postgres)
    backup_postgres
    ;;
  mysql)
    backup_mysql
    ;;
  sqlite)
    backup_sqlite
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
Database: $DOCUMIND_DATABASE_DRIVER
Database Server: $DOCUMIND_DATABASE_SERVER
Storage Path: $STORAGE_PATH
EOF

# Clean up old backups if retention is set
if [ -n "$BACKUP_RETENTION_DAYS" ] && [ "$BACKUP_RETENTION_DAYS" -gt 0 ]; then
  echo -e "${YELLOW}Cleaning up backups older than $BACKUP_RETENTION_DAYS days...${NC}"
  find "$BACKUP_DIR" -name "documind_backup_*" -type f -mtime +$BACKUP_RETENTION_DAYS -delete
fi

echo -e "${GREEN}Backup completed successfully!${NC}"
echo -e "Backup files are located in ${YELLOW}$BACKUP_DIR${NC}"
echo -e "${GREEN}======================================================${NC}"
ls -la "$BACKUP_DIR" | grep "documind_backup_"
echo -e "${GREEN}======================================================${NC}"
