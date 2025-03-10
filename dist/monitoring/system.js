"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerActiveUser = registerActiveUser;
exports.unregisterActiveUser = unregisterActiveUser;
exports.getSystemMetrics = getSystemMetrics;
exports.startMetricsCollection = startMetricsCollection;
const os_1 = __importDefault(require("os"));
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const storage_1 = require("../storage/storage");
// Database metrics cache
let dbMetricsCache = {
    size: 0,
    connections: 0,
    lastCheck: 0
};
// Active users tracking
const activeUserSessions = new Set();
/**
 * Register an active user session
 */
function registerActiveUser(userId) {
    activeUserSessions.add(userId);
}
/**
 * Unregister an active user session
 */
function unregisterActiveUser(userId) {
    activeUserSessions.delete(userId);
}
/**
 * Get current CPU usage
 */
async function getCpuUsage() {
    return new Promise((resolve) => {
        const startUsage = os_1.default.cpus().map(cpu => {
            return Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
        });
        const startIdle = os_1.default.cpus().map(cpu => cpu.times.idle);
        // Check again after 100ms
        setTimeout(() => {
            const endUsage = os_1.default.cpus().map(cpu => {
                return Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
            });
            const endIdle = os_1.default.cpus().map(cpu => cpu.times.idle);
            const usageDiff = startUsage.map((value, i) => endUsage[i] - value);
            const idleDiff = startIdle.map((value, i) => endIdle[i] - value);
            const usagePercentages = usageDiff.map((value, i) => {
                const totalDiff = value;
                const idleDiffVal = idleDiff[i];
                return (1 - idleDiffVal / totalDiff) * 100;
            });
            // Average usage across all CPUs
            const averageUsage = usagePercentages.reduce((acc, usage) => acc + usage, 0) / usagePercentages.length;
            resolve(Number(averageUsage.toFixed(2)));
        }, 100);
    });
}
/**
 * Get database metrics
 */
async function getDatabaseMetrics() {
    // Don't check too frequently - use cached values if checked within last minute
    const now = Date.now();
    if (now - dbMetricsCache.lastCheck < 60000) {
        return {
            size: dbMetricsCache.size,
            connections: dbMetricsCache.connections,
            status: dbMetricsCache.status
        };
    }
    try {
        const db = (0, connection_1.getConnection)();
        let size = 0;
        let connections = 0;
        let status = 'healthy';
        // Query database size and connection count
        // The implementation depends on database type
        try {
            const result = await db.query('SELECT 1');
            // For demonstration, we'll use dummy values
            // In a real system, you'd query actual database metrics
            size = 100; // MB
            connections = 5;
            status = 'healthy';
            dbMetricsCache = {
                size,
                connections,
                status,
                lastCheck: now
            };
        }
        catch (error) {
            logger_1.logger.error('Database health check failed:', error);
            status = 'error';
        }
        return { size, connections, status };
    }
    catch (error) {
        logger_1.logger.error('Failed to get database metrics:', error);
        return { size: 0, connections: 0, status: 'error' };
    }
}
/**
 * Get current system metrics
 */
async function getSystemMetrics() {
    try {
        // Get CPU info
        const cpuModel = os_1.default.cpus()[0].model;
        const cpuCount = os_1.default.cpus().length;
        const cpuUsage = await getCpuUsage();
        // Get memory info
        const totalMemory = Math.floor(os_1.default.totalmem() / (1024 * 1024)); // MB
        const freeMemory = Math.floor(os_1.default.freemem() / (1024 * 1024)); // MB
        const memoryUsage = Number(((totalMemory - freeMemory) / totalMemory * 100).toFixed(2));
        // Get storage status
        const storage = await (0, storage_1.getStorageStatus)();
        // Get database metrics
        const database = await getDatabaseMetrics();
        // Get uptime and active users
        const uptime = process.uptime();
        const activeUsers = activeUserSessions.size;
        return {
            cpu: {
                usage: cpuUsage,
                count: cpuCount,
                model: cpuModel
            },
            memory: {
                total: totalMemory,
                free: freeMemory,
                usage: memoryUsage
            },
            storage,
            database,
            uptime,
            activeUsers,
            timestamp: new Date()
        };
    }
    catch (error) {
        logger_1.logger.error('Error collecting system metrics:', error);
        throw error;
    }
}
/**
 * Start periodic metrics collection
 */
function startMetricsCollection(intervalMs = 60000) {
    logger_1.logger.info(`Starting system metrics collection every ${intervalMs / 1000} seconds`);
    // Collect metrics immediately
    getSystemMetrics()
        .then(metrics => {
        logger_1.logger.debug('Initial system metrics collected:', metrics);
    })
        .catch(error => {
        logger_1.logger.error('Failed to collect initial system metrics:', error);
    });
    // Then collect periodically
    return setInterval(async () => {
        try {
            const metrics = await getSystemMetrics();
            logger_1.logger.debug('System metrics collected:', metrics);
            // Here you could store metrics to database for historical tracking
            // Or send alerts if certain thresholds are exceeded
            if (metrics.cpu.usage > 80) {
                logger_1.logger.warn(`High CPU usage detected: ${metrics.cpu.usage}%`);
            }
            if (metrics.memory.usage > 85) {
                logger_1.logger.warn(`High memory usage detected: ${metrics.memory.usage}%`);
            }
            if (metrics.storage.usagePercent > 90) {
                logger_1.logger.warn(`Storage almost full: ${metrics.storage.usagePercent.toFixed(2)}%`);
            }
            if (metrics.database.status !== 'healthy') {
                logger_1.logger.warn(`Database status: ${metrics.database.status}`);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to collect system metrics:', error);
        }
    }, intervalMs);
}
