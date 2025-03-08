import { DatabaseConfig } from '../config/config';
import { logger } from '../utils/logger';
import * as mysql from 'mysql2/promise';
import { Pool as PgPool } from 'pg';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

// Interface for unified database connection
export interface DbConnection {
    query: (sql: string, params?: any[]) => Promise<any>;
    close: () => Promise<void>;
}

// Connection pools/instances
let mysqlPool: mysql.Pool;
let pgPool: PgPool;
let sqliteDb: sqlite3.Database;
let activeConnection: DbConnection;

/**
 * Initialize database connection based on configuration
 */
export async function initializeDatabase(config: DatabaseConfig): Promise<DbConnection> {
    logger.info(`Initializing database connection (${config.driver})...`);

    try {
        switch (config.driver) {
            case 'mysql':
                await initMySql(config);
                break;
            case 'postgres':
                await initPostgres(config);
                break;
            case 'sqlite':
            default:
                await initSqlite();
                break;
        }

        logger.info('Database connection established successfully');
        return activeConnection;

    } catch (error) {
        logger.error('Failed to initialize database:', error);
        throw error;
    }
}

/**
 * Initialize MySQL connection
 */
async function initMySql(config: DatabaseConfig): Promise<void> {
    const [host, port] = (config.server || 'localhost:3306').split(':');

    mysqlPool = mysql.createPool({
        host,
        port: parseInt(port || '3306', 10),
        user: config.user || 'documind',
        password: config.password || '',
        database: config.database || 'documind',
        waitForConnections: true,
        connectionLimit: config.connectionLimit || 10,
        queueLimit: 0
    });

    // Test connection
    await mysqlPool.query('SELECT 1');

    activeConnection = {
        query: async (sql: string, params: any[] = []) => {
            const [results] = await mysqlPool.query(sql, params);
            return results;
        },
        close: async () => {
            await mysqlPool.end();
        }
    };
}

/**
 * Initialize PostgreSQL connection
 */
async function initPostgres(config: DatabaseConfig): Promise<void> {
    const [host, port] = (config.server || 'localhost:5432').split(':');

    pgPool = new PgPool({
        host,
        port: parseInt(port || '5432', 10),
        user: config.user || 'documind',
        password: config.password || '',
        database: config.database || 'documind',
        max: config.connectionLimit || 10
    });

    // Test connection
    await pgPool.query('SELECT 1');

    activeConnection = {
        query: async (sql: string, params: any[] = []) => {
            const result = await pgPool.query(sql, params);
            return result.rows;
        },
        close: async () => {
            await pgPool.end();
        }
    };
}

/**
 * Initialize SQLite connection
 */
async function initSqlite(): Promise<void> {
    const dbDir = path.join(process.cwd(), 'data');
    const dbPath = path.join(dbDir, 'documind.sqlite');

    // Create directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    // Create a promise-based wrapper around SQLite
    sqliteDb = await new Promise<sqlite3.Database>((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });

    activeConnection = {
        query: async (sql: string, params: any[] = []) => {
            return new Promise((resolve, reject) => {
                if (sql.trim().toLowerCase().startsWith('select')) {
                    sqliteDb.all(sql, params, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                } else {
                    sqliteDb.run(sql, params, function (err) {
                        if (err) reject(err);
                        else resolve({ lastID: this.lastID, changes: this.changes });
                    });
                }
            });
        },
        close: async () => {
            return new Promise<void>((resolve, reject) => {
                sqliteDb.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    };
}

/**
 * Get the active database connection
 */
export function getConnection(): DbConnection {
    if (!activeConnection) {
        throw new Error('Database connection has not been initialized');
    }
    return activeConnection;
}
