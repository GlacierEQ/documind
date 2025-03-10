"use strict";
/**
 * Database Migration System with Versioning
 * Supports multiple database types and schema versioning
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const connection_1 = require("../connection");
const logger_1 = require("../../utils/logger");
/**
 * Run database migrations to bring schema up to current version
 */
async function runMigrations() {
    const perfEnd = logger_1.performance.start('db-migrations');
    logger_1.logger.info('Checking database migrations...');
    try {
        const db = (0, connection_1.getConnection)();
        const dbType = process.env.DB_TYPE || 'sqlite';
        // Ensure migrations table exists
        await ensureMigrationsTable(db);
        // Get applied migrations
        const appliedMigrations = await db.query('SELECT id, name FROM migrations ORDER BY id ASC');
        const appliedIds = new Set(appliedMigrations.map(m => m.id));
        // Get available migration files
        const migrationsDir = path.join(__dirname, dbType);
        const availableMigrations = await loadMigrationFiles(migrationsDir);
        // Filter migrations that need to be applied
        const pendingMigrations = availableMigrations.filter(m => !appliedIds.has(m.id));
        if (pendingMigrations.length === 0) {
            logger_1.logger.info(`Database schema is up to date (${appliedMigrations.length} migrations applied)`);
            return;
        }
        logger_1.logger.info(`Found ${pendingMigrations.length} pending database migrations`);
        // Apply pending migrations in a transaction
        await db.beginTransaction();
        try {
            for (const migration of pendingMigrations) {
                const migrationPerfEnd = logger_1.performance.start(`migration-${migration.id}`);
                logger_1.logger.info(`Applying migration ${migration.id}: ${migration.name}...`);
                // Load and execute migration
                const sql = await fs.readFile(migration.path, 'utf8');
                const statements = sql.split(';').filter(s => s.trim().length > 0);
                for (const statement of statements) {
                    await db.query(statement);
                }
                // Record migration as applied
                await db.query('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)', [migration.id, migration.name, new Date()]);
                logger_1.logger.info(`Migration ${migration.id} completed in ${migrationPerfEnd()}ms`);
            }
            await db.commit();
            logger_1.logger.info(`Successfully applied ${pendingMigrations.length} migrations in ${perfEnd()}ms`);
        }
        catch (error) {
            await db.rollback();
            logger_1.logger.error('Error applying migrations:', error);
            throw new Error(`Migration failed: ${error.message}`);
        }
    }
    catch (error) {
        logger_1.logger.error('Database migration system failed:', error);
        throw error;
    }
}
/**
 * Create migrations table if it doesn't exist
 */
async function ensureMigrationsTable(db) {
    await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP NOT NULL
    )
  `);
}
/**
 * Load migration files from directory
 */
async function loadMigrationFiles(directory) {
    try {
        // Ensure migrations directory exists
        try {
            await fs.access(directory);
        }
        catch {
            await fs.mkdir(directory, { recursive: true });
            return []; // No migrations yet
        }
        // Read migration files
        const files = await fs.readdir(directory);
        const migrationFiles = [];
        // Parse migration filenames (format: 001_create_users_table.sql)
        for (const file of files) {
            if (file.endsWith('.sql')) {
                const match = file.match(/^(\d+)_(.+)\.sql$/);
                if (match) {
                    const id = parseInt(match[1], 10);
                    const name = match[2].replace(/_/g, ' ');
                    migrationFiles.push({
                        id,
                        name,
                        path: path.join(directory, file)
                    });
                }
            }
        }
        // Sort by ID
        return migrationFiles.sort((a, b) => a.id - b.id);
    }
    catch (error) {
        logger_1.logger.error(`Failed to load migration files from ${directory}:`, error);
        throw error;
    }
}
