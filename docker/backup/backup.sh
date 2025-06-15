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
    error "Unsupported database type: ${DB_TYPE}"
    exit 1
    ;;
esac

# Backup application data
log "Creating application data backup"
if [ -d "/data/app" ]; then
  cp -r /data/app/* "${TEMP_DIR}/app/"
else
  log "Warning: No application data found at /data/app"
fi

# Add backup metadata
log "Adding backup metadata"
cat > "${TEMP_DIR}/backup-metadata.json" <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "hostname": "$(hostname)",
  "database_type": "${DB_TYPE}",
  "database_name": "${DB_NAME}",
  "application_version": "${APP_VERSION:-unknown}",
  "backup_format_version": "1.0"
}
EOF

# Create archive
log "Creating compressed archive"
tar -czf "${BACKUP_ARCHIVE}" -C "${TEMP_DIR}" .

# Create checksum
log "Generating checksum"
sha256sum "${BACKUP_ARCHIVE}" | awk '{print $1}' > "${BACKUP_CHECKSUM}"

# Encrypt backup if key is provided
if [ -n "${ENCRYPTION_KEY}" ]; then
  log "Encrypting backup"
  openssl enc -aes-256-cbc -salt -pbkdf2 -in "${BACKUP_ARCHIVE}" -out "${BACKUP_ARCHIVE}.enc" -k "${ENCRYPTION_KEY}"
  rm "${BACKUP_ARCHIVE}"
  BACKUP_ARCHIVE="${BACKUP_ARCHIVE}.enc"
  
  # Update checksum for encrypted file
  sha256sum "${BACKUP_ARCHIVE}" | awk '{print $1}' > "${BACKUP_CHECKSUM}"
fi

# Upload to S3 if configured
if [ -n "${S3_BUCKET}" ]; then
  log "Uploading backup to S3"
  
  # Set S3 prefix with current date structure
  S3_DATE_PREFIX=$(date +"%Y/%m/%d")
  S3_FULL_PREFIX="${S3_PREFIX:+$S3_PREFIX/}${S3_DATE_PREFIX}"
  
  # Upload backup file
  aws s3 cp "${BACKUP_ARCHIVE}" "s3://${S3_BUCKET}/${S3_FULL_PREFIX}/${BACKUP_NAME}.tar.gz${ENCRYPTION_KEY:+.enc}"
  
  # Upload checksum
  aws s3 cp "${BACKUP_CHECKSUM}" "s3://${S3_BUCKET}/${S3_FULL_PREFIX}/${BACKUP_NAME}.sha256"
  
  log "S3 upload completed"
fi

# Cleanup old backups based on retention policy
if [ -n "${RETENTION_DAYS}" ] && [ "${RETENTION_DAYS}" -gt 0 ]; then
  log "Cleaning up old backups (older than ${RETENTION_DAYS} days)"
  
  # Remove local old backups
  find "${BACKUP_DIR}" -type f -name "documind_backup_*.tar.gz*" -mtime "+${RETENTION_DAYS}" -delete
  find "${BACKUP_DIR}" -type f -name "documind_backup_*.sha256" -mtime "+${RETENTION_DAYS}" -delete
  
  # Remove old S3 backups if configured
  if [ -n "${S3_BUCKET}" ] && [ -n "${S3_PREFIX}" ]; then
    log "Cleaning up old S3 backups"
    
    # Calculate cutoff date (RETENTION_DAYS ago in YYYY-MM-DD format)
    CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +"%Y-%m-%d")
    
    # List objects in S3 bucket older than cutoff date
    aws s3api list-objects-v2 \
      --bucket "${S3_BUCKET}" \
      --prefix "${S3_PREFIX}" \
      --query "Contents[?LastModified<='${CUTOFF_DATE}T00:00:00Z'][].{Key: Key}" \
      --output json | jq -r '.[] | .Key' | \
      while read -r object_key; do
        aws s3 rm "s3://${S3_BUCKET}/${object_key}"
      done
  fi
fi

log "Backup completed successfully"
