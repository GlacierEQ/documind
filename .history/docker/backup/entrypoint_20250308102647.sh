#!/bin/bash
#
# Entrypoint script for Documind backup container

set -e

echo "=== Documind Backup Service ==="
echo "Schedule: ${BACKUP_SCHEDULE}"
echo "Retention: ${RETENTION_DAYS} days"

# Create cron job for scheduled backups
echo "Setting up cron job..."
echo "${BACKUP_SCHEDULE} /scripts/backup.sh >> /var/log/cron.log 2>&1" > /var/spool/cron/crontabs/root

# Create initial backup
echo "Creating initial backup..."
/scripts/backup.sh

# Start cron in foreground
echo "Starting cron service..."
crond -f -l 2
