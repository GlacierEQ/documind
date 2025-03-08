FROM alpine:3.18

# Install required tools
RUN apk add --no-cache bash postgresql-client mysql-client tini tzdata curl \
    && mkdir -p /backups

# Copy backup scripts
COPY backup.sh /usr/local/bin/backup.sh
COPY entrypoint.sh /entrypoint.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/backup.sh /entrypoint.sh

# Set entrypoint
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
