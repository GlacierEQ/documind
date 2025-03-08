<a href="https://discord.gg/w2Ejj36hRU">
  <img src="https://user-images.githubusercontent.com/31022056/158916278-4504b838-7ecb-4ab9-a900-7dc002aade78.png" alt="Join us on Discord" width="200px">
</a>

# Documind: Document Management System

Documind is a powerful, self-hosted document management system designed for personal and organizational use. It provides secure storage, advanced search capabilities, and efficient document organization.

## Features

- **Document Storage & Organization**: Upload, categorize, and manage documents of various formats
- **Advanced Search**: Full-text search with OCR for images and PDFs
- **User Authentication**: Multiple authentication methods (Password, OIDC, LDAP)
- **Access Control**: Role-based permissions and document sharing
- **Responsive UI**: Modern web interface that works on desktop and mobile devices
- **Flexible Deployment**: Run with Docker or as a native application

## System Requirements

- **For Docker deployment**:
  - Docker and Docker Compose
  - 2GB RAM (minimum)
  - 10GB disk space (minimum)

- **For native deployment**:
  - Node.js 16+ 
  - PostgreSQL, MySQL, or SQLite
  - 2GB RAM (minimum)
  - 10GB disk space (minimum)

## Quick Start

### Using Docker (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/documind.git
   cd documind
   ```

2. Create an environment file:
   ```bash
   cp .env.template .env
   ```

3. Edit the `.env` file with your preferred configuration

4. Start Documind with Docker Compose:
   ```bash
   docker-compose up -d
   ```

5. Access Documind at http://localhost:8080 (default credentials: admin/admin123)

### Native Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/documind.git
   cd documind
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create an environment file:
   ```bash
   cp .env.template .env
   ```

4. Edit the `.env` file with your preferred configuration

5. Build the application:
   ```bash
   npm run build
   ```

6. Start Documind:
   ```bash
   npm start
   ```

7. Access Documind at http://localhost:8080 (default credentials: admin/admin123)

## Automated Installation Script

For a guided installation on Linux systems, you can use our installation script:

```bash
curl -fsSL https://get.documind.io | bash -s -- --interactive
```

Or for automatic detection and optimization:

```bash
curl -fsSL https://get.documind.io | bash -s -- --auto-detect --optimize --secure
```

## Configuration

### Database Options

Documind supports multiple database backends:

- **SQLite**: Best for personal use or small teams
- **MySQL**: Good for medium-sized deployments
- **PostgreSQL**: Recommended for large-scale deployments

Configure the database connection in your `.env` file.

### Authentication Methods

Documind supports three authentication methods:

- **Password**: Built-in username/password authentication
- **OIDC**: OpenID Connect for integration with identity providers
- **LDAP**: Lightweight Directory Access Protocol for enterprise integration

### Storage Configuration

Configure document storage path and limits in your `.env` file:

```
DOCUMIND_STORAGE_PATH=/var/documind/storage
DOCUMIND_STORAGE_MAX_SIZE=10240  # in MB
```

## Security Considerations

1. **Change default credentials immediately** after first login
2. **Use TLS/HTTPS** in production environments
3. **Regular backups** of both database and document storage
4. **Restrict access** to the server hosting Documind

## Advanced Configuration

### Using Nginx as a Reverse Proxy

For production deployments, we recommend using Nginx as a reverse proxy in front of Documind. Sample configuration files are provided in the `docker/nginx` directory.

### Scaling Documind

For large deployments, consider:

1. Using PostgreSQL as the database backend
2. Increasing indexing threads based on available CPU cores
3. Setting up regular maintenance tasks for database optimization
4. Using a dedicated NFS mount for document storage

## Development

### Setting Up Development Environment

1. Clone the repository
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`

### Running Tests

```bash
npm test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

- GitHub Issues: [https://github.com/yourusername/documind/issues](https://github.com/yourusername/documind/issues)
- Documentation: [https://docs.documind.io](https://docs.documind.io)
