FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build the application
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --production

# Install additional tools
RUN apk add --no-cache \
    tesseract-ocr \
    postgresql-client \
    sqlite \
    curl \
    bash

# Copy compiled code
COPY --from=builder /app/dist ./dist
COPY public ./public

# Create storage directory
RUN mkdir -p /var/documind/storage && \
    chown -R node:node /var/documind/storage

# Set environment variables
ENV NODE_ENV=production \
    DOCUMIND_STORAGE_PATH=/var/documind/storage

# Switch to non-root user
USER node

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "dist/index.js"]
