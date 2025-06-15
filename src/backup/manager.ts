import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CronJob } from 'cron';
import { loadConfig } from '../config/config';
import { logger } from '../utils/logger';
import { getConnection } from '../database/connection';

const execAsync = promisify(exec);

/**
 * Backup Manager class to handle automated backups
 */
export class BackupManager {
    private cronJob: CronJob | null = null;
    private backupInProgress: boolean = false;

    /**
     * Initialize the backup manager
     */
    async initialize(): Promise<void> {
        const config = loadConfig();

        if (!config.backup.enabled) {
            logger.info('Automated backups are disabled');
            return;
        }

        // Ensure backup directory exists
        try {
            if (!existsSync(config.backup.location)) {
                await fs.mkdir(config.backup.location, { recursive: true });
            }
        } catch (error) {
            logger.error(`Failed to create backup directory at ${config.backup.location}:`, error);
            throw error;
        }

        // Schedule backup job
        try {
            this.cronJob = new CronJob(
                config.backup.cronSchedule,
                () => this.performBackup(),
                null,
                true
            );

            logger.info(`Backup scheduled with cron pattern: ${config.backup.cronSchedule}`);
        } catch (error) {
            logger.error('Failed to schedule backup job:', error);
            throw error;
        }
    }

    /**
     * Stop backup manager
     */
    stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info('Backup manager stopped');
        }
    }

    /**
     * Perform a backup
     */
    async performBackup(): Promise<string | null> {
        if (this.backupInProgress) {
            logger.warn('Backup already in progress, skipping...');
            return null;
        }

        this.backupInProgress = true;
        logger.info('Starting scheduled backup...');

        const config = loadConfig();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `documind_backup_${timestamp}`;
        const backupPath = path.join(config.backup.location, backupName);

        try {
            // Create backup directory
            await fs.mkdir(backupPath, { recursive: true });

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

            logger.info(`Backup completed successfully: ${backupName}`);

            // Log backup to database
            await this.logBackupToDatabase(backupName, backupPath);

            this.backupInProgress = false;
            return backupName;
        } catch (error) {
            logger.error('Error performing backup:', error);
            this.backupInProgress = false;
            return null;
        }
    }

    /**
     * Restore from a backup
     */
    async restoreFromBackup(backupName: string): Promise<boolean> {
        if (this.backupInProgress) {
            logger.warn('Cannot restore while backup is in progress');
            return false;
        }

        this.backupInProgress = true;
        logger.info(`Starting restoration from backup: ${backupName}...`);

        const config = loadConfig();
        const backupPath = path.join(config.backup.location, backupName);

        try {
            // Check if backup exists
            if (!existsSync(backupPath)) {
                logger.error(`Backup not found: ${backupPath}`);
                this.backupInProgress = false;
                return false;
            }

            // Decrypt backup if encrypted
            if (existsSync(path.join(backupPath, 'backup.enc'))) {
                await this.decryptBackup(backupPath);
            }

            // Restore database
            await this.restoreDatabase(backupPath);

            // Restore document storage
            await this.restoreStorage(backupPath);

            logger.info('Restoration completed successfully');
            this.backupInProgress = false;
            return true;
        } catch (error) {
            logger.error('Error restoring from backup:', error);
            this.backupInProgress = false;
            return false;
        }
    }

    /**
     * Backup the database
     */
    private async backupDatabase(backupPath: string): Promise<void> {
        const config = loadConfig();
        const dbBackupPath = path.join(backupPath, 'database');

        // Create database backup directory
        await fs.mkdir(dbBackupPath, { recursive: true });

        // Backup based on database type
        if (config.database.driver === 'sqlite') {
            // For SQLite, just copy the database file
            const dbPath = path.join(process.cwd(), 'data', 'documind.sqlite');
            if (existsSync(dbPath)) {
                await fs.copyFile(dbPath, path.join(dbBackupPath, 'documind.sqlite'));
                logger.info('SQLite database backed up successfully');
            } else {
                logger.warn(`SQLite database file not found at ${dbPath}`);
            }
        } else if (config.database.driver === 'mysql' || config.database.driver === 'postgres') {
            // For MySQL/PostgreSQL, use the appropriate dump utility
            const dumpScript = path.join(process.cwd(), 'scripts',
                config.database.driver === 'mysql' ? 'dump-mysql.sh' : 'dump-postgres.sh');

            try {
                if (existsSync(dumpScript)) {
                    const cmd = `bash "${dumpScript}" "${dbBackupPath}" "${config.database.database}" "${config.database.user}" "${config.database.password}" "${config.database.server}"`;

                    const { stdout, stderr } = await execAsync(cmd);

                    if (stderr) {
                        logger.warn(`Database dump warning: ${stderr}`);
                    }

                    logger.info(`${config.database.driver} database backed up successfully`);
                } else {
                    // Fallback to direct database connection
                    const db = getConnection();
                    const tables = await db.query(`SHOW TABLES`);

                    for (const table of tables) {
                        const tableName = Object.values(table)[0];
                        const data = await db.query(`SELECT * FROM ${tableName}`);
                        await fs.writeFile(
                            path.join(dbBackupPath, `${tableName}.json`),
                            JSON.stringify(data, null, 2)
                        );
                    }

                    logger.info('Database backed up using fallback method');
                }
            } catch (error) {
                logger.error('Failed to backup database:', error);
                throw error;
            }
        }
    }

    /**
     * Backup document storage
     */
    private async backupStorage(backupPath: string): Promise<void> {
        const config = loadConfig();
        const storageBackupPath = path.join(backupPath, 'storage');

        // Create storage backup directory
        await fs.mkdir(storageBackupPath, { recursive: true });

        try {
            // Use tar command for faster copying with directory structure
            if (process.platform !== 'win32') {
                // Linux/Mac
                const tarPath = path.join(storageBackupPath, 'storage.tar.gz');
                await execAsync(`tar -czf "${tarPath}" -C "${path.dirname(config.storage.path)}" "${path.basename(config.storage.path)}"`);
            } else {
                // Windows - simulate with recursive copy
                await this.copyDirectory(config.storage.path, storageBackupPath);
            }

            logger.info('Document storage backed up successfully');
        } catch (error) {
            logger.error('Failed to backup document storage:', error);
            throw error;
        }
    }

    /**
     * Create backup info file
     */
    private async createBackupInfo(backupPath: string): Promise<void> {
        const config = loadConfig();
        const infoPath = path.join(backupPath, 'backup-info.json');

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

        await fs.writeFile(infoPath, JSON.stringify(info, null, 2));
        logger.info('Backup info file created');
    }

    /**
     * Encrypt backup
     */
    private async encryptBackup(backupPath: string): Promise<void> {
        // This is a placeholder for actual encryption
        // In a real implementation, you would use a library like node-crypto
        logger.info('Backup encryption is enabled but not implemented');
    }

    /**
     * Decrypt backup
     */
    private async decryptBackup(backupPath: string): Promise<void> {
        // This is a placeholder for actual decryption
        logger.info('Backup decryption is not implemented');
    }

    /**
     * Clean up old backups
     */
    private async cleanupOldBackups(): Promise<void> {
        const config = loadConfig();

        if (!config.backup.retentionDays || config.backup.retentionDays <= 0) {
            return;
        }

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - config.backup.retentionDays);

            // List backups in directory
            const backupDir = config.backup.location;
            const entries = await fs.readdir(backupDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('documind_backup_')) {
                    const backupPath = path.join(backupDir, entry.name);
                    const infoPath = path.join(backupPath, 'backup-info.json');

                    try {
                        // Check if info file exists
                        if (existsSync(infoPath)) {
                            const infoContent = await fs.readFile(infoPath, 'utf8');
                            const info = JSON.parse(infoContent);

                            if (new Date(info.timestamp) < cutoffDate) {
                                // Delete the backup
                                await this.removeDirectory(backupPath);
                                logger.info(`Deleted old backup: ${entry.name}`);
                            }
                        } else {
                            // Use directory stats if no info file
                            const stats = await fs.stat(backupPath);

                            if (stats.ctime < cutoffDate) {
                                await this.removeDirectory(backupPath);
                                logger.info(`Deleted old backup: ${entry.name}`);
                            }
                        }
                    } catch (error) {
                        logger.warn(`Error processing backup ${entry.name}:`, error);
                    }
                }
            }
        } catch (error) {
            logger.error('Error cleaning up old backups:', error);
            throw error;
        }
    }

    /**
     * Log backup to database
     */
    private async logBackupToDatabase(backupName: string, backupPath: string): Promise<void> {
        try {
            const db = getConnection();

            // Get backup size
            const size = await this.getDirectorySize(backupPath);

            await db.query(
                `INSERT INTO backups (name, path, size, created_at) 
                 VALUES (?, ?, ?, ?)`,
                [backupName, backupPath, size, new Date()]
            );
        } catch (error) {
            logger.error('Error logging backup to database:', error);
        }
    }

    /**
     * Restore database from backup
     */
    private async restoreDatabase(backupPath: string): Promise<void> {
        const config = loadConfig();
        const dbBackupPath = path.join(backupPath, 'database');

        // Restore based on database type
        if (config.database.driver === 'sqlite') {
            // For SQLite, just copy the database file back
            const dbFile = path.join(dbBackupPath, 'documind.sqlite');
            const dbPath = path.join(process.cwd(), 'data', 'documind.sqlite');

            if (existsSync(dbFile)) {
                // Make a backup of current database first
                if (existsSync(dbPath)) {
                    await fs.copyFile(dbPath, `${dbPath}.bak`);
                }

                await fs.copyFile(dbFile, dbPath);
                logger.info('SQLite database restored successfully');
            } else {
                throw new Error('Backup database file not found');
            }
        } else {
            // For MySQL/PostgreSQL, restoration would need the corresponding restore script
            logger.info(`${config.database.driver} database restoration not implemented`);
        }
    }

    /**
     * Restore document storage from backup
     */
    private async restoreStorage(backupPath: string): Promise<void> {
        const config = loadConfig();
        const storageBackupPath = path.join(backupPath, 'storage');

        try {
            // Check if tar archive exists
            const tarPath = path.join(storageBackupPath, 'storage.tar.gz');
            if (existsSync(tarPath) && process.platform !== 'win32') {
                // Extract tar archive
                await execAsync(`tar -xzf "${tarPath}" -C "${path.dirname(config.storage.path)}"`);
            } else {
                // Fall back to directory copy
                await this.copyDirectory(storageBackupPath, config.storage.path);
            }

            logger.info('Document storage restored successfully');
        } catch (error) {
            logger.error('Failed to restore document storage:', error);
            throw error;
        }
    }

    /**
     * Helper function to copy directory recursively
     */
    private async copyDirectory(source: string, destination: string): Promise<void> {
        await fs.mkdir(destination, { recursive: true });
        const entries = await fs.readdir(source, { withFileTypes: true });

        for (const entry of entries) {
            const sourcePath = path.join(source, entry.name);
            const destinationPath = path.join(destination, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(sourcePath, destinationPath);
            } else {
                await fs.copyFile(sourcePath, destinationPath);
            }
        }
    }

    /**
     * Helper function to remove directory recursively
     */
    private async removeDirectory(directory: string): Promise<void> {
        await fs.rm(directory, { recursive: true, force: true });
    }

    /**
     * Helper function to get directory size
     */
    private async getDirectorySize(directory: string): Promise<number> {
        let size = 0;
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                size += await this.getDirectorySize(entryPath);
            } else {
                const stats = await fs.stat(entryPath);
                size += stats.size;
            }
        }

        return size;
    }
}

// Singleton instance
let backupManagerInstance: BackupManager | null = null;

/**
 * Get backup manager instance
 */
export function getBackupManager(): BackupManager {
    if (!backupManagerInstance) {
        backupManagerInstance = new BackupManager();
    }

    return backupManagerInstance;
}
