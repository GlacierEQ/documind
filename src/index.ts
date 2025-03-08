import dotenv from 'dotenv';
import path from 'path';
import { startServer } from './server';
import { loadConfig } from './config/config';
import { initializeDatabase } from './database/connection';
import { initializeSchema } from './database/schema';
import { setupStorage } from './storage/storage';
import { initializeIndexer } from './search/indexer';
import { logger } from './utils/logger';
import { startMetricsCollection } from './monitoring/system';
import { startWebDavServer } from './webdav/server';

// Load environment variables
dotenv.config();

async function bootstrap() {
    try {
        logger.info('Starting Documind...');

        // Load configuration
        const config = loadConfig();

        // Initialize database connection
        const db = await initializeDatabase(config.database);

        // Initialize schema
        await initializeSchema();

        // Setup document storage
        await setupStorage(config.storage);

        // Initialize document indexer
        await initializeIndexer(config.indexing);

        // Start WebDAV server if enabled
        if (config.webdav?.enabled) {
            startWebDavServer(config.webdav.port);
        }

        // Start periodic metrics collection if in production
        let metricsInterval: NodeJS.Timer | null = null;
        if (process.env.NODE_ENV === 'production') {
            metricsInterval = startMetricsCollection(60000); // Every minute
        }

        // Start web server
        const server = await startServer(config.server);

        logger.info(`Documind server is running on port ${config.server.port}`);

        // Handle shutdown gracefully
        process.on('SIGTERM', () => {
            logger.info('Shutting down Documind...');

            // Clear metrics interval if it was started
            if (metricsInterval) {
                clearInterval(metricsInterval);
            }

            server.close(() => {
                process.exit(0);
            });
        });

    } catch (error) {
        logger.error('Failed to start Documind:', error);
        process.exit(1);
    }
}

bootstrap();
