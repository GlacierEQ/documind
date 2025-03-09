#!/bin/bash
#
# Production-grade backup script for Documind
# Supports database dumps, application data backups, encryption, and cloud uploads

set -eo pipefail

# Setup environment
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="/backups"
TEMP_DIR=$(mktemp -d)
LOG_FILE="/var/log/backup/backup-${TIMESTAMP}.log"
BACKUP_NAME="documind_backup_${TIMESTAMP}"
BACKUP_ARCHIVE="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
BACKUP_CHECKSUM="${BACKUP_DIR}/${BACKUP_NAME}.sha256"

# Configure logging
exec > >(tee -a "${LOG_FILE}") 2>&1

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
}

# Ensure cleanup on exit
cleanup() {
  log "Cleaning up temporary files"
  rm -rf "${TEMP_DIR}"
  
  # Send final status notification
  if [ "$1" -eq 0 ]; then
    send_notification "✅ Documind backup completed successfully" "Backup size: $(du -h ${BACKUP_ARCHIVE} | awk '{print $1}')\nTimestamp: ${TIMESTAMP}\nBackup file: ${BACKUP_NAME}.tar.gz"
  else
    send_notification "❌ Documind backup failed" "Please check the logs at ${LOG_FILE}"
  fi
  
  exit "$1"
}

trap 'cleanup $?' EXIT

# Send notification (to Slack or other platforms)
send_notification() {
  local title="$1"
  local message="$2"
  
  if [ -n "${SLACK_WEBHOOK_URL}" ]; then
    log "Sending notification to Slack"
    payload=$(cat <<EOF
{
  "text": "*${title}*",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "${title}"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "${message}"
      }
    }
  ]
}
EOF
)
    curl -s -X POST -H 'Content-type: application/json' --data "${payload}" "${SLACK_WEBHOOK_URL}" || true
  fi
}

# Start backup process
log "Starting Documind backup process"
send_notification "🔄 Documind backup started" "Server: $(hostname)\nTimestamp: ${TIMESTAMP}"

# Create backup directories
mkdir -p "${TEMP_DIR}/db"
mkdir -p "${TEMP_DIR}/app"

# Backup database based on type
log "Creating database backup"
case "${DB_TYPE}" in
  postgres)
    if [ -z "${DB_PASSWORD}" ]; then
      export PGPASSWORD="${DB_PASSWORD}"
    fi
    pg_dump -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -F c -f "${TEMP_DIR}/db/database.dump"
    ;;
  mysql)
    mysqldump -h "${DB_HOST}" -u "${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" > "${TEMP_DIR}/db/database.sql"
    ;;
  sqlite)
    sqlite3 "/data/db/${DB_NAME}" ".backup '${TEMP_DIR}/db/database.sqlite'"
    ;;
  *)