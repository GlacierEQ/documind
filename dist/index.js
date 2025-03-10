"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const server_1 = require("./server");
const config_1 = require("./config/config");
const connection_1 = require("./database/connection");
const schema_1 = require("./database/schema");
const storage_1 = require("./storage/storage");
const indexer_1 = require("./search/indexer");
const logger_1 = require("./utils/logger");
const system_1 = require("./monitoring/system");
const server_2 = require("./webdav/server");
// Load environment variables
dotenv_1.default.config();
async function bootstrap() {
    try {
        logger_1.logger.info('Starting Documind...');
        // Load configuration
        const config = (0, config_1.loadConfig)();
        // Initialize database connection
        const db = await (0, connection_1.initializeDatabase)(config.database);
        // Initialize schema
        await (0, schema_1.initializeSchema)();
        // Setup document storage
        await (0, storage_1.setupStorage)(config.storage);
        // Initialize document indexer
        await (0, indexer_1.initializeIndexer)(config.indexing);
        // Start WebDAV server if enabled
        if (config.webdav?.enabled) {
            (0, server_2.startWebDavServer)(config.webdav.port);
        }
        // Start periodic metrics collection if in production
        let metricsInterval = null;
        if (process.env.NODE_ENV === 'production') {
            metricsInterval = (0, system_1.startMetricsCollection)(60000); // Every minute
        }
        // Start web server
        const server = await (0, server_1.startServer)(config.server);
        logger_1.logger.info(`Documind server is running on port ${config.server.port}`);
        // Handle shutdown gracefully
        process.on('SIGTERM', () => {
            logger_1.logger.info('Shutting down Documind...');
            // Clear metrics interval if it was started
            if (metricsInterval) {
                clearInterval(metricsInterval);
            }
            server.close(() => {
                process.exit(0);
            });
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start Documind:', error);
        process.exit(1);
    }
}
bootstrap();
