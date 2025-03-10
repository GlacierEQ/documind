"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackupManager = void 0;
exports.getBackupManager = getBackupManager;
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const cron_1 = require("cron");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Backup Manager class to handle automated backups
 */
class BackupManager {
    constructor() {
        this.cronJob = null;
        this.backupInProgress = false;
    }
    /**
     * Initialize the backup manager
     */
    async initialize() {
        const config = (0, config_1.loadConfig)();
        if (!config.backup.enabled) {
            logger_1.logger.info('Automated backups are disabled');
            return;
        }
        // Ensure backup directory exists
        try {
            if (!(0, fs_1.existsSync)(config.backup.location)) {
                await promises_1.default.mkdir(config.backup.location, { recursive: true });
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to create backup directory at ${config.backup.location}:`, error);
            throw error;
        }
        // Schedule backup job
        try {
            this.cronJob = new cron_1.CronJob(config.backup.cronSchedule, () => this.performBackup(), null, true);
            logger_1.logger.info(`Backup scheduled with cron pattern: ${config.backup.cronSchedule}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to schedule backup job:', error);
            throw error;
        }
    }
    /**
     * Stop backup manager
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger_1.logger.info('Backup manager stopped');
        }
    }
    /**
     * Perform a backup
     */
    async performBackup() {
        if (this.backupInProgress) {
            logger_1.logger.warn('Backup already in progress, skipping...');
            return null;
        }
        this.backupInProgress = true;
        logger_1.logger.info('Starting scheduled backup...');
        const config = (0, config_1.loadConfig)();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `documind_backup_${timestamp}`;
        const backupPath = path_1.default.join(config.backup.location, backupName);
        try {
            // Create backup directory
            await promises_1.default.mkdir(backupPath, { recursive: true });
            // Backup database
            await this.backupDatabase(backupPath);
            // Backup document storage
            await this.backupStorage(backupPath);
            // Create backup info file
            await this.createBackupInfo(backupPath);
            // Encrypt backup if enabled
            if (config.backup.encryption) {
                await this.encryptBackup(backupPath);
            }
            // Clean up old backups
            await this.cleanupOldBackups();
            logger_1.logger.info(`Backup completed successfully: ${backupName}`);
            // Log backup to database
            await this.logBackupToDatabase(backupName, backupPath);
            this.backupInProgress = false;
            return backupName;
        }
        catch (error) {
            logger_1.logger.error('Error performing backup:', error);
            this.backupInProgress = false;
            return null;
        }
    }
    /**
     * Restore from a backup
     */
    async restoreFromBackup(backupName) {
        if (this.backupInProgress) {
            logger_1.logger.warn('Cannot restore while backup is in progress');
            return false;
        }
        this.backupInProgress = true;
        logger_1.logger.info(`Starting restoration from backup: ${backupName}...`);
        const config = (0, config_1.loadConfig)();
        const backupPath = path_1.default.join(config.backup.location, backupName);
        try {
            // Check if backup exists
            if (!(0, fs_1.existsSync)(backupPath)) {
                logger_1.logger.error(`Backup not found: ${backupPath}`);
                this.backupInProgress = false;
                return false;
            }
            // Decrypt backup if encrypted
            if ((0, fs_1.existsSync)(path_1.default.join(backupPath, 'backup.enc'))) {
                await this.decryptBackup(backupPath);
            }
            // Restore database
            await this.restoreDatabase(backupPath);
            // Restore document storage
            await this.restoreStorage(backupPath);
            logger_1.logger.info('Restoration completed successfully');
            this.backupInProgress = false;
            return true;
        }
        catch (error) {
            logger_1.logger.error('Error restoring from backup:', error);
            this.backupInProgress = false;
            return false;
        }
    }
    /**
     * Backup the database
     */
    async backupDatabase(backupPath) {
        const config = (0, config_1.loadConfig)();
        const dbBackupPath = path_1.default.join(backupPath, 'database');
        // Create database backup directory
        await promises_1.default.mkdir(dbBackupPath, { recursive: true });
        // Backup based on database type
        if (config.database.driver === 'sqlite') {
            // For SQLite, just copy the database file
            const dbPath = path_1.default.join(process.cwd(), 'data', 'documind.sqlite');
            if ((0, fs_1.existsSync)(dbPath)) {
                await promises_1.default.copyFile(dbPath, path_1.default.join(dbBackupPath, 'documind.sqlite'));
                logger_1.logger.info('SQLite database backed up successfully');
            }
            else {
                logger_1.logger.warn(`SQLite database file not found at ${dbPath}`);
            }
        }
        else if (config.database.driver === 'mysql' || config.database.driver === 'postgres') {
            // For MySQL/PostgreSQL, use the appropriate dump utility
            const dumpScript = path_1.default.join(process.cwd(), 'scripts', config.database.driver === 'mysql' ? 'dump-mysql.sh' : 'dump-postgres.sh');
            try {
                if ((0, fs_1.existsSync)(dumpScript)) {
                    const cmd = `bash "${dumpScript}" "${dbBackupPath}" "${config.database.database}" "${config.database.user}" "${config.database.password}" "${config.database.server}"`;
                    const { stdout, stderr } = await execAsync(cmd);
                    if (stderr) {
                        logger_1.logger.warn(`Database dump warning: ${stderr}`);
                    }
                    logger_1.logger.info(`${config.database.driver} database backed up successfully`);
                }
                else {
                    // Fallback to direct database connection
                    const db = (0, connection_1.getConnection)();
                    const tables = await db.query(`SHOW TABLES`);
                    for (const table of tables) {
                        const tableName = Object.values(table)[0];
                        const data = await db.query(`SELECT * FROM ${tableName}`);
                        await promises_1.default.writeFile(path_1.default.join(dbBackupPath, `${tableName}.json`), JSON.stringify(data, null, 2));
                    }
                    logger_1.logger.info('Database backed up using fallback method');
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to backup database:', error);
                throw error;
            }
        }
    }
    /**
     * Backup document storage
     */
    async backupStorage(backupPath) {
        const config = (0, config_1.loadConfig)();
        const storageBackupPath = path_1.default.join(backupPath, 'storage');
        // Create storage backup directory
        await promises_1.default.mkdir(storageBackupPath, { recursive: true });
        try {
            // Use tar command for faster copying with directory structure
            if (process.platform !== 'win32') {
                // Linux/Mac
                const tarPath = path_1.default.join(storageBackupPath, 'storage.tar.gz');
                await execAsync(`tar -czf "${tarPath}" -C "${path_1.default.dirname(config.storage.path)}" "${path_1.default.basename(config.storage.path)}"`);
            }
            else {
                // Windows - simulate with recursive copy
                await this.copyDirectory(config.storage.path, storageBackupPath);
            }
            logger_1.logger.info('Document storage backed up successfully');
        }
        catch (error) {
            logger_1.logger.error('Failed to backup document storage:', error);
            throw error;
        }
    }
    /**
     * Create backup info file
     */
    async createBackupInfo(backupPath) {
        const config = (0, config_1.loadConfig)();
        const infoPath = path_1.default.join(backupPath, 'backup-info.json');
        const info = {
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            database: config.database.driver,
            storage: {
                path: config.storage.path,
                maxSize: config.storage.maxSize
            },
            encrypted: config.backup.encryption
        };
        await promises_1.default.writeFile(infoPath, JSON.stringify(info, null, 2));
        logger_1.logger.info('Backup info file created');
    }
    /**
     * Encrypt backup
     */
    async encryptBackup(backupPath) {
        // This is a placeholder for actual encryption
        // In a real implementation, you would use a library like node-crypto
        logger_1.logger.info('Backup encryption is enabled but not implemented');
    }
    /**
     * Decrypt backup
     */
    async decryptBackup(backupPath) {
        // This is a placeholder for actual decryption
        logger_1.logger.info('Backup decryption is not implemented');
    }
    /**
     * Clean up old backups
     */
    async cleanupOldBackups() {
        const config = (0, config_1.loadConfig)();
        if (!config.backup.retentionDays || config.backup.retentionDays <= 0) {
            return;
        }
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - config.backup.retentionDays);
            // List backups in directory
            const backupDir = config.backup.location;
            const entries = await promises_1.default.readdir(backupDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('documind_backup_')) {
                    const backupPath = path_1.default.join(backupDir, entry.name);
                    const infoPath = path_1.default.join(backupPath, 'backup-info.json');
                    try {
                        // Check if info file exists
                        if ((0, fs_1.existsSync)(infoPath)) {
                            const infoContent = await promises_1.default.readFile(infoPath, 'utf8');
                            const info = JSON.parse(infoContent);
                            if (new Date(info.timestamp) < cutoffDate) {
                                // Delete the backup
                                await this.removeDirectory(backupPath);
                                logger_1.logger.info(`Deleted old backup: ${entry.name}`);
                            }
                        }
                        else {
                            // Use directory stats if no info file
                            const stats = await promises_1.default.stat(backupPath);
                            if (stats.ctime < cutoffDate) {
                                await this.removeDirectory(backupPath);
                                logger_1.logger.info(`Deleted old backup: ${entry.name}`);
                            }
                        }
                    }
                    catch (error) {
                        logger_1.logger.warn(`Error processing backup ${entry.name}:`, error);
                    }
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error cleaning up old backups:', error);
            throw error;
        }
    }
    /**
     * Log backup to database
     */
    async logBackupToDatabase(backupName, backupPath) {
        try {
            const db = (0, connection_1.getConnection)();
            // Get backup size
            const size = await this.getDirectorySize(backupPath);
            await db.query(`INSERT INTO backups (name, path, size, created_at) 
                 VALUES (?, ?, ?, ?)`, [backupName, backupPath, size, new Date()]);
        }
        catch (error) {
            logger_1.logger.error('Error logging backup to database:', error);
        }
    }
    /**
     * Restore database from backup
     */
    async restoreDatabase(backupPath) {
        const config = (0, config_1.loadConfig)();
        const dbBackupPath = path_1.default.join(backupPath, 'database');
        // Restore based on database type
        if (config.database.driver === 'sqlite') {
            // For SQLite, just copy the database file back
            const dbFile = path_1.default.join(dbBackupPath, 'documind.sqlite');
            const dbPath = path_1.default.join(process.cwd(), 'data', 'documind.sqlite');
            if ((0, fs_1.existsSync)(dbFile)) {
                // Make a backup of current database first
                if ((0, fs_1.existsSync)(dbPath)) {
                    await promises_1.default.copyFile(dbPath, `${dbPath}.bak`);
                }
                await promises_1.default.copyFile(dbFile, dbPath);
                logger_1.logger.info('SQLite database restored successfully');
            }
            else {
                throw new Error('Backup database file not found');
            }
        }
        else {
            // For MySQL/PostgreSQL, restoration would need the corresponding restore script
            logger_1.logger.info(`${config.database.driver} database restoration not implemented`);
        }
    }
    /**
     * Restore document storage from backup
     */
    async restoreStorage(backupPath) {
        const config = (0, config_1.loadConfig)();
        const storageBackupPath = path_1.default.join(backupPath, 'storage');
        try {
            // Check if tar archive exists
            const tarPath = path_1.default.join(storageBackupPath, 'storage.tar.gz');
            if ((0, fs_1.existsSync)(tarPath) && process.platform !== 'win32') {
                // Extract tar archive
                await execAsync(`tar -xzf "${tarPath}" -C "${path_1.default.dirname(config.storage.path)}"`);
            }
            else {
                // Fall back to directory copy
                await this.copyDirectory(storageBackupPath, config.storage.path);
            }
            logger_1.logger.info('Document storage restored successfully');
        }
        catch (error) {
            logger_1.logger.error('Failed to restore document storage:', error);
            throw error;
        }
    }
    /**
     * Helper function to copy directory recursively
     */
    async copyDirectory(source, destination) {
        await promises_1.default.mkdir(destination, { recursive: true });
        const entries = await promises_1.default.readdir(source, { withFileTypes: true });
        for (const entry of entries) {
            const sourcePath = path_1.default.join(source, entry.name);
            const destinationPath = path_1.default.join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copyDirectory(sourcePath, destinationPath);
            }
            else {
                await promises_1.default.copyFile(sourcePath, destinationPath);
            }
        }
    }
    /**
     * Helper function to remove directory recursively
     */
    async removeDirectory(directory) {
        await promises_1.default.rm(directory, { recursive: true, force: true });
    }
    /**
     * Helper function to get directory size
     */
    async getDirectorySize(directory) {
        let size = 0;
        const entries = await promises_1.default.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path_1.default.join(directory, entry.name);
            if (entry.isDirectory()) {
                size += await this.getDirectorySize(entryPath);
            }
            else {
                const stats = await promises_1.default.stat(entryPath);
                size += stats.size;
            }
        }
        return size;
    }
}
exports.BackupManager = BackupManager;
// Singleton instance
let backupManagerInstance = null;
/**
 * Get backup manager instance
 */
function getBackupManager() {
    if (!backupManagerInstance) {
        backupManagerInstance = new BackupManager();
    }
    return backupManagerInstance;
}
