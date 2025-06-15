#!/bin/bash
set -e

# Default to daily backups at 2am if no schedule is provided
BACKUP_SCHEDULE=${BACKUP_SCHEDULE:-"0 2 * * *"}

echo "Documind Backup Service"
echo "======================="
echo "Database: $DOCUMIND_DATABASE_DRIVER"
echo "Schedule: $BACKUP_SCHEDULE"
echo "Retention: ${BACKUP_RETENTION_DAYS:-"No limit"} days"
echo "======================="

# Add the backup job to crontab
echo "$BACKUP_SCHEDULE /usr/local/bin/backup.sh >> /var/log/cron.log 2>&1" > /etc/crontabs/root

# Start cron in the foreground
crond -f -l 8
