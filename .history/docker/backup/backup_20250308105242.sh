#!/bin/bash
#
# Documind Backup Script
# This script creates backups of the Documind database and uploads

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Set backup directory
BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/documind_backup_${TIMESTAMP}.tar.gz"

echo -e "${BLUE}=== Starting Documind Backup ===${NC}"
echo -e "${GREEN}Timestamp: $(date)${NC}"

# Ensure backup directory exists
mkdir -p ${BACKUP_DIR}

# Create temporary directory for this backup
TEMP_DIR=$(mktemp -d)
trap 'rm -rf ${TEMP_DIR}' EXIT

echo -e "${GREEN}Backing up PostgreSQL database...${NC}"
export PGPASSWORD="${POSTGRES_PASSWORD}"
pg_dump -h "${POSTGRES_HOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -F c -b -v -f "${TEMP_DIR}/database.dump"

echo -e "${GREEN}Backing up application data...${NC}"
tar -czf "${TEMP_DIR}/app_data.tar.gz" -C /data/app .

echo -e "${GREEN}Creating final backup archive...${NC}"
tar -czf "${BACKUP_FILE}" -C "${TEMP_DIR}" .

# Calculate backup size
BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)

echo -e "${GREEN}Cleaning up old backups (older than ${RETENTION_DAYS} days)...${NC}"
find ${BACKUP_DIR} -name "documind_backup_*.tar.gz" -type f -mtime +${RETENTION_DAYS} -delete

# List remaining backups
BACKUPS_COUNT=$(find ${BACKUP_DIR} -name "documind_backup_*.tar.gz" | wc -l)
TOTAL_SIZE=$(du -sh ${BACKUP_DIR} | cut -f1)

echo -e "${BLUE}=== Backup Summary ===${NC}"
echo -e "${GREEN}Backup completed successfully: ${BACKUP_FILE}${NC}"
echo -e "${GREEN}Backup size: ${BACKUP_SIZE}${NC}"
echo -e "${GREEN}Total backups: ${BACKUPS_COUNT}${NC}"
echo -e "${GREEN}Total backup storage used: ${TOTAL_SIZE}${NC}"
echo -e "${GREEN}Backup retention policy: ${RETENTION_DAYS} days${NC}"
