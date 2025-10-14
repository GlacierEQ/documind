FROM alpine:3.22.2

# Install dependencies
RUN apk add --no-cache \
    bash \
    curl \
    postgresql-client \
    mysql-client \
    sqlite \
    coreutils \
    tzdata \
    gzip \
    tar \
    jq \
    python3 \
    py3-pip \
    openssl \
    ca-certificates

# Install AWS CLI for S3 backup uploads
RUN pip3 install --no-cache-dir awscli boto3 requests

# Create directory structure
RUN mkdir -p /app /backups /var/log/backup

# Copy backup scripts
COPY *.sh /app/
RUN chmod +x /app/*.sh

# Set up cron job for backup scheduling
RUN echo '* * * * * /app/backup-scheduler.sh >> /var/log/backup/cron.log 2>&1' > /etc/crontabs/root

# Set working directory
WORKDIR /app

# Default environment variables
ENV DB_TYPE=postgres \
    RETENTION_DAYS=7 \
    BACKUP_SCHEDULE="0 0 * * *" \
    SLACK_NOTIFICATIONS=false \
    HEALTHCHECK_ENDPOINT=""

# Health check
HEALTHCHECK --interval=1m --timeout=10s --start-period=30s --retries=3 \
  CMD /app/healthcheck.sh

# Run crond in foreground
CMD ["crond", "-f", "-l", "8"]
