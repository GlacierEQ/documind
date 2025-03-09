# Documind Installation Guide

This guide provides detailed instructions for installing Documind in various environments.

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Quick Start with Docker](#quick-start-with-docker)
3. [Manual Installation](#manual-installation)
4. [Configuration Options](#configuration-options)
5. [Post-Installation Setup](#post-installation-setup)
6. [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum Requirements
- **CPU:** 2 cores
- **RAM:** 4GB
- **Disk Space:** 20GB
- **Operating System:** Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+), Windows Server 2019+, or macOS 12+

### Recommended Requirements
- **CPU:** 4+ cores
- **RAM:** 8GB+
- **Disk Space:** 100GB+ SSD
- **Operating System:** Ubuntu 22.04 LTS or Debian 12

### Software Requirements
- Docker 20.10+ and Docker Compose 2.0+ (for Docker installation)
- Node.js 18+ (for manual installation)
- PostgreSQL 14+ (for production deployments)

## Quick Start with Docker

The simplest way to deploy Documind is using Docker:

```bash
# Clone the repository
git clone https://github.com/documind/documind.git
cd documind

# Run the automated setup script
bash scripts/install.sh --docker

# Or manually:
cp .env.template .env.docker
# Edit .env.docker with your settings
docker-compose up -d
```

After installation, Documind will be available at http://localhost:3000.

## Manual Installation

For environments without Docker:

```bash
# Clone the repository
git clone https://github.com/documind/documind.git
cd documind

# Install dependencies
npm install

# Build the application
npm run build

# Configure environment
cp .env.template .env
# Edit .env with your settings

# Start the application
npm start
```

## Configuration Options

Documind can be configured using environment variables or the `.env` file:

### Database Configuration
- `DB_TYPE` - Database type (postgres, mysql, sqlite)
- `DB_HOST` - Database host
- `DB_PORT` - Database port
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password
- `DB_NAME` - Database name

### Storage Configuration
- `STORAGE_TYPE` - Storage type (local, s3)
- `STORAGE_PATH` - Local storage path
- `S3_BUCKET` - S3 bucket name (if using S3)
- `S3_REGION` - S3 region

### AI Configuration
- `AI_PROVIDER` - AI provider (granite, openai, none)
- `GRANITE_API_KEY` - API key for Granite AI
- `GRANITE_MODEL` - Model name for Granite AI

## Post-Installation Setup

1. **Initial Login**
   - Access Documind at http://localhost:3000
   - Log in with default credentials: 
     - Username: `admin`
     - Password: `admin`
   - **Important**: Change the default password immediately

2. **Configure System Settings**
   - Navigate to Settings > System
   - Set up your organization details
   - Configure email settings

3. **Create User Accounts**
   - Navigate to Settings > Users
   - Create accounts for your team members

4. **Setting Up Integrations**
   - Navigate to Settings > Integrations
   - Configure external services (Westlaw, LexisNexis, etc.)

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify database credentials in `.env` or `.env.docker`
   - Ensure database server is running and accessible
   - Check for firewalls blocking connections

2. **Permission Issues**
   - Ensure proper file permissions:
     ```bash
     chmod -R 755 scripts/
     chown -R 1000:1000 data/ # If using Docker
     ```

3. **Memory Issues**
   - If Documind stops unexpectedly, check system memory
   - Increase Docker container memory limits if needed
   - For large document processing, adjust the `MAX_MEMORY` setting

### Logs

- Docker logs: `docker-compose logs -f app`
- Application logs: `logs/app.log`
- Database logs: `logs/db.log`

For additional help, visit our [Support Portal](https://documind.io/support) or [GitHub Issues](https://github.com/documind/documind/issues).
