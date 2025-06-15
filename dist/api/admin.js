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
exports.adminRouter = void 0;
const express_1 = __importDefault(require("express"));
const connection_1 = require("../database/connection");
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
const system_1 = require("../monitoring/system");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.adminRouter = express_1.default.Router();
// Only admin users can access these endpoints
exports.adminRouter.use(auth_1.isAdmin);
// Get system statistics
exports.adminRouter.get('/stats', async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        // Get document stats
        const documentStats = await db.query(`
            SELECT 
                COUNT(*) as total,
                SUM(size) as totalSize,
                COUNT(DISTINCT uploaded_by) as uniqueUploaders,
                MAX(uploaded_at) as lastUpload
            FROM documents
        `);
        // Get user stats
        const userStats = await db.query(`
            SELECT COUNT(*) as total FROM users
        `);
        res.json({
            documents: {
                count: documentStats[0].total || 0,
                totalSize: documentStats[0].totalSize || 0,
                uniqueUploaders: documentStats[0].uniqueUploaders || 0,
                lastUpload: documentStats[0].lastUpload || null
            },
            users: {
                count: userStats[0].total || 0
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});
// Get system metrics
exports.adminRouter.get('/metrics', async (req, res) => {
    try {
        const metrics = await (0, system_1.getSystemMetrics)();
        res.json(metrics);
    }
    catch (error) {
        logger_1.logger.error('Error fetching system metrics:', error);
        res.status(500).json({ error: 'Failed to fetch system metrics' });
    }
});
// Get system logs
exports.adminRouter.get('/logs', async (req, res) => {
    try {
        const logDir = path.join(process.cwd(), 'logs');
        const logType = req.query.type || 'combined';
        const lines = parseInt(req.query.lines || '100');
        let logFile;
        if (logType === 'error') {
            logFile = path.join(logDir, 'error.log');
        }
        else {
            logFile = path.join(logDir, 'combined.log');
        }
        // Check if log file exists
        if (!fs.existsSync(logFile)) {
            return res.status(404).json({ error: 'Log file not found' });
        }
        // Read the last N lines of the log file
        const data = fs.readFileSync(logFile, 'utf8');
        const logLines = data.trim().split('\n');
        const lastLines = logLines.slice(-lines);
        res.json({ logs: lastLines });
    }
    catch (error) {
        logger_1.logger.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});
// Get activity log
exports.adminRouter.get('/activity', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '50');
        const offset = parseInt(req.query.offset || '0');
        const db = (0, connection_1.getConnection)();
        // Get activity logs with user info
        const logs = await db.query(`
            SELECT a.*, u.username
            FROM activity_log a
            JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);
        // Get total count
        const countResult = await db.query('SELECT COUNT(*) as count FROM activity_log');
        const totalCount = countResult[0].count;
        res.json({
            logs,
            pagination: {
                total: totalCount,
                limit,
                offset
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching activity logs:', error);
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
});
// Trigger database backup
exports.adminRouter.post('/backup', async (req, res) => {
    try {
        const backupDir = req.body.backupDir || './backups';
        const backupName = `documind_backup_${Date.now()}`;
        // In a real implementation, you'd trigger the backup.sh script
        // For this demo, we'll just simulate a backup
        logger_1.logger.info(`Admin requested backup: ${backupName} to ${backupDir}`);
        setTimeout(() => {
            logger_1.logger.info('Backup completed successfully');
        }, 2000);
        res.json({
            success: true,
            message: 'Backup initiated',
            backupName,
            backupDir
        });
    }
    catch (error) {
        logger_1.logger.error('Error initiating backup:', error);
        res.status(500).json({ error: 'Failed to initiate backup' });
    }
});
// Clear index and rebuild
exports.adminRouter.post('/reindex', async (req, res) => {
    try {
        // In a real implementation, you'd trigger a reindexing job
        // For this demo, we'll just simulate the process
        logger_1.logger.info('Admin requested full reindexing');
        const db = (0, connection_1.getConnection)();
        // Get count of documents to reindex
        const countResult = await db.query('SELECT COUNT(*) as count FROM documents');
        const documentCount = countResult[0].count;
        // Reset indexing status
        await db.query('UPDATE documents SET indexed = 0, indexed_at = NULL');
        res.json({
            success: true,
            message: 'Reindexing initiated',
            documentCount
        });
    }
    catch (error) {
        logger_1.logger.error('Error initiating reindexing:', error);
        res.status(500).json({ error: 'Failed to initiate reindexing' });
    }
});
