#!/bin/bash
#
# Backup scheduler for Documind
# Triggers backups based on cron schedule

set -eo pipefail

LOG_FILE="/var/log/backup/scheduler.log"
LAST_RUN_FILE="/var/log/backup/last_run"
LOCK_FILE="/var/run/backup.lock"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"
}

# Exit if backup is already running
if [ -f "${LOCK_FILE}" ] && kill -0 "$(cat "${LOCK_FILE}")" 2>/dev/null; then
  log "Backup already in progress with PID $(cat ${LOCK_FILE})"
  exit 0
fi

# Create lock file
echo $$ > "${LOCK_FILE}"

# Check if we need to run a backup based on schedule
if [ -f "${LAST_RUN_FILE}" ]; then
  LAST_RUN=$(cat "${LAST_RUN_FILE}")
else
  LAST_RUN=0
fi

CURRENT_TIME=$(date +%s)
SCHEDULE="${BACKUP_SCHEDULE:-0 0 * * *}"

# Convert cron schedule to next runtime
NEXT_RUN=$(python3 -c "
import datetime
import croniter
import time

try:
    next_run = croniter.croniter('${SCHEDULE}', 
                               datetime.datetime.fromtimestamp(${LAST_RUN} or time.time())).get_next()
    print(int(next_run.timestamp()))
except Exception as e:
    print(str(e))
    exit(1)
")

# Run backup if it's time
if [ "${CURRENT_TIME}" -ge "${NEXT_RUN}" ]; then
  log "Starting scheduled backup"
  
  # Run backup
  if /app/backup.sh; then
    log "Backup completed successfully"
    echo "${CURRENT_TIME}" > "${LAST_RUN_FILE}"
  else
    log "Backup failed"
  fi
else
  # For debugging
  # log "Not time for backup yet. Next run at $(date -d @${NEXT_RUN})"
  : # No operation
fi

# Remove lock file
rm -f "${LOCK_FILE}"
