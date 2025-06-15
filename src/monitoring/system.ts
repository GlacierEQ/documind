import os from 'os';
import { logger } from '../utils/logger';
import { DbConnection, getConnection } from '../database/connection';
import { StorageStatus, getStorageStatus } from '../storage/storage';

// Performance metrics interface
export interface SystemMetrics {
    cpu: {
        usage: number; // percentage (0-100)
        count: number;
        model: string;
    };
    memory: {
        total: number; // in MB
        free: number; // in MB
        usage: number; // percentage (0-100)
    };
    storage: StorageStatus;
    database: {
        size: number; // in MB (approximate)
        connections: number;
        status: 'healthy' | 'degraded' | 'error';
    };
    uptime: number; // in seconds
    activeUsers: number;
    timestamp: Date;
}

// Database metrics cache
let dbMetricsCache: any = {
    size: 0,
    connections: 0,
    lastCheck: 0
};

// Active users tracking
const activeUserSessions: Set<number> = new Set();

/**
 * Register an active user session
 */
export function registerActiveUser(userId: number): void {
    activeUserSessions.add(userId);
}

/**
 * Unregister an active user session
 */
export function unregisterActiveUser(userId: number): void {
    activeUserSessions.delete(userId);
}

/**
 * Get current CPU usage
 */
async function getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
        const startUsage = os.cpus().map(cpu => {
            return Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
        });
        const startIdle = os.cpus().map(cpu => cpu.times.idle);

        // Check again after 100ms
        setTimeout(() => {
            const endUsage = os.cpus().map(cpu => {
                return Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
            });
            const endIdle = os.cpus().map(cpu => cpu.times.idle);

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
async function getDatabaseMetrics(): Promise<{ size: number; connections: number; status: 'healthy' | 'degraded' | 'error' }> {
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
        const db = getConnection();
        let size = 0;
        let connections = 0;
        let status: 'healthy' | 'degraded' | 'error' = 'healthy';

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
        } catch (error) {
            logger.error('Database health check failed:', error);
            status = 'error';
        }

        return { size, connections, status };
    } catch (error) {
        logger.error('Failed to get database metrics:', error);
        return { size: 0, connections: 0, status: 'error' };
    }
}

/**
 * Get current system metrics
 */
export async function getSystemMetrics(): Promise<SystemMetrics> {
    try {
        // Get CPU info
        const cpuModel = os.cpus()[0].model;
        const cpuCount = os.cpus().length;
        const cpuUsage = await getCpuUsage();

        // Get memory info
        const totalMemory = Math.floor(os.totalmem() / (1024 * 1024)); // MB
        const freeMemory = Math.floor(os.freemem() / (1024 * 1024)); // MB
        const memoryUsage = Number(((totalMemory - freeMemory) / totalMemory * 100).toFixed(2));

        // Get storage status
        const storage = await getStorageStatus();

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
    } catch (error) {
        logger.error('Error collecting system metrics:', error);
        throw error;
    }
}

/**
 * Start periodic metrics collection
 */
export function startMetricsCollection(intervalMs = 60000): NodeJS.Timer {
    logger.info(`Starting system metrics collection every ${intervalMs / 1000} seconds`);

    // Collect metrics immediately
    getSystemMetrics()
        .then(metrics => {
            logger.debug('Initial system metrics collected:', metrics);
        })
        .catch(error => {
            logger.error('Failed to collect initial system metrics:', error);
        });

    // Then collect periodically
    return setInterval(async () => {
        try {
            const metrics = await getSystemMetrics();
            logger.debug('System metrics collected:', metrics);

            // Here you could store metrics to database for historical tracking
            // Or send alerts if certain thresholds are exceeded

            if (metrics.cpu.usage > 80) {
                logger.warn(`High CPU usage detected: ${metrics.cpu.usage}%`);
            }

            if (metrics.memory.usage > 85) {
                logger.warn(`High memory usage detected: ${metrics.memory.usage}%`);
            }

            if (metrics.storage.usagePercent > 90) {
                logger.warn(`Storage almost full: ${metrics.storage.usagePercent.toFixed(2)}%`);
            }

            if (metrics.database.status !== 'healthy') {
                logger.warn(`Database status: ${metrics.database.status}`);
            }
        } catch (error) {
            logger.error('Failed to collect system metrics:', error);
        }
    }, intervalMs);
}
