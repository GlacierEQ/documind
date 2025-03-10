"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeDatabase = initializeDatabase;
exports.getConnection = getConnection;
const logger_1 = require("../utils/logger");
const mysql = __importStar(require("mysql2/promise"));
const pg_1 = require("pg");
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Connection pools/instances
let mysqlPool;
let pgPool;
let sqliteDb;
let activeConnection;
/**
 * Initialize database connection based on configuration
 */
async function initializeDatabase(config) {
    logger_1.logger.info(`Initializing database connection (${config.driver})...`);
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
        logger_1.logger.info('Database connection established successfully');
        return activeConnection;
    }
    catch (error) {
        logger_1.logger.error('Failed to initialize database:', error);
        throw error;
    }
}
/**
 * Initialize MySQL connection
 */
async function initMySql(config) {
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
        query: async (sql, params = []) => {
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
async function initPostgres(config) {
    const [host, port] = (config.server || 'localhost:5432').split(':');
    pgPool = new pg_1.Pool({
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
        query: async (sql, params = []) => {
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
async function initSqlite() {
    const dbDir = path_1.default.join(process.cwd(), 'data');
    const dbPath = path_1.default.join(dbDir, 'documind.sqlite');
    // Create directory if it doesn't exist
    if (!fs_1.default.existsSync(dbDir)) {
        fs_1.default.mkdirSync(dbDir, { recursive: true });
    }
    // Create a promise-based wrapper around SQLite
    sqliteDb = await new Promise((resolve, reject) => {
        const db = new sqlite3_1.default.Database(dbPath, (err) => {
            if (err)
                reject(err);
            else
                resolve(db);
        });
    });
    activeConnection = {
        query: async (sql, params = []) => {
            return new Promise((resolve, reject) => {
                if (sql.trim().toLowerCase().startsWith('select')) {
                    sqliteDb.all(sql, params, (err, rows) => {
                        if (err)
                            reject(err);
                        else
                            resolve(rows);
                    });
                }
                else {
                    sqliteDb.run(sql, params, function (err) {
                        if (err)
                            reject(err);
                        else
                            resolve({ lastID: this.lastID, changes: this.changes });
                    });
                }
            });
        },
        close: async () => {
            return new Promise((resolve, reject) => {
                sqliteDb.close((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        }
    };
}
/**
 * Get the active database connection
 */
function getConnection() {
    if (!activeConnection) {
        throw new Error('Database connection has not been initialized');
    }
    return activeConnection;
}
