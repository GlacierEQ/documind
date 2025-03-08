import express from 'express';
import { getConnection } from '../database/connection';
import { isAdmin } from '../auth/auth';
import { logger } from '../utils/logger';
import { getSystemMetrics } from '../monitoring/system';
import * as fs from 'fs';
import * as path from 'path';

export const adminRouter = express.Router();

// Only admin users can access these endpoints
adminRouter.use(isAdmin);

// Get system statistics
adminRouter.get('/stats', async (req, res) => {
    try {
        const db = getConnection();

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
    } catch (error) {
        logger.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});

// Get system metrics
adminRouter.get('/metrics', async (req, res) => {
    try {
        const metrics = await getSystemMetrics();
        res.json(metrics);
    } catch (error) {
        logger.error('Error fetching system metrics:', error);
        res.status(500).json({ error: 'Failed to fetch system metrics' });
    }
});

// Get system logs
adminRouter.get('/logs', async (req, res) => {
    try {
        const logDir = path.join(process.cwd(), 'logs');
        const logType = req.query.type || 'combined';
        const lines = parseInt(req.query.lines as string || '100');

        let logFile;
        if (logType === 'error') {
            logFile = path.join(logDir, 'error.log');
        } else {
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
    } catch (error) {
        logger.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// Get activity log
adminRouter.get('/activity', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string || '50');
        const offset = parseInt(req.query.offset as string || '0');

        const db = getConnection();

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
    } catch (error) {
        logger.error('Error fetching activity logs:', error);
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
});

// Trigger database backup
adminRouter.post('/backup', async (req, res) => {
    try {
        const backupDir = req.body.backupDir || './backups';
        const backupName = `documind_backup_${Date.now()}`;

        // In a real implementation, you'd trigger the backup.sh script
        // For this demo, we'll just simulate a backup
        logger.info(`Admin requested backup: ${backupName} to ${backupDir}`);

        setTimeout(() => {
            logger.info('Backup completed successfully');
        }, 2000);

        res.json({
            success: true,
            message: 'Backup initiated',
            backupName,
            backupDir
        });
    } catch (error) {
        logger.error('Error initiating backup:', error);
        res.status(500).json({ error: 'Failed to initiate backup' });
    }
});

// Clear index and rebuild
adminRouter.post('/reindex', async (req, res) => {
    try {
        // In a real implementation, you'd trigger a reindexing job
        // For this demo, we'll just simulate the process
        logger.info('Admin requested full reindexing');

        const db = getConnection();

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
    } catch (error) {
        logger.error('Error initiating reindexing:', error);
        res.status(500).json({ error: 'Failed to initiate reindexing' });
    }
});
