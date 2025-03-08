import fs from 'fs';
import path from 'path';
import { StorageConfig } from '../config/config';
import { logger } from '../utils/logger';

// Storage status interface
export interface StorageStatus {
    totalSize: number; // in bytes
    freeSpace: number; // in bytes
    usedSpace: number; // in bytes
    usagePercent: number; // 0-100
}

// Global storage configuration
let storageConfig: StorageConfig;

/**
 * Setup storage system
 */
export async function setupStorage(config: StorageConfig): Promise<void> {
    logger.info(`Setting up document storage at ${config.path}...`);
    
    storageConfig = config;
    
    try {
        // Create storage directory if it doesn't exist
        if (!fs.existsSync(config.path)) {
            fs.mkdirSync(config.path, { recursive: true });
            logger.info(`Created storage directory: ${config.path}`);
        }
        
        // Create subdirectories
        const dirs = ['uploads', 'thumbnails', 'indexes', 'temp'];
        for (const dir of dirs) {
            const dirPath = path.join(config.path, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        }
        
        // Check storage status
        const status = await getStorageStatus();
        logger.info(`Storage status: ${status.usedSpace / (1024 * 1024)} MB used (${status.usagePercent.toFixed(2)}%)`);
        
        if (status.usagePercent > 90) {
            logger.warn(`Storage usage is high: ${status.usagePercent.toFixed(2)}%`);
        }
    } catch (error) {
        logger.error('Failed to setup storage:', error);
        throw error;
    }
}

/**
 * Get storage status
 */
export async function getStorageStatus(): Promise<StorageStatus> {
    if (!storageConfig) {
        throw new Error('Storage has not been initialized');
    }
    
    try {
        // Calculate total size of all files in storage directory
        const totalSize = await calculateDirSize(storageConfig.path);
        
        // Get disk space information
        const maxSize = storageConfig.maxSize * 1024 * 1024; // Convert MB to bytes
        const freeSpace = maxSize - totalSize;
        const usagePercent = (totalSize / maxSize) * 100;
        
        return {
            totalSize: maxSize,
            freeSpace,
            usedSpace: totalSize,
            usagePercent
        };
    } catch (error) {
        logger.error('Failed to get storage status:', error);
        throw error;
    }
}

/**
 * Calculate directory size
 */
async function calculateDirSize(dirPath: string): Promise<number> {
    const files = await fs.promises.readdir(dirPath);
    let size = 0;
    
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.promises.stat(filePath);
        
        if (stats.isDirectory()) {
            size += await calculateDirSize(filePath);
        } else {
            size += stats.size;
        }
    }
    
    return size;
}

/**
 * Delete a document from storage
 */
export async function deleteDocument(filePath: string): Promise<void> {
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            logger.info(`Deleted document file: ${filePath}`);
        }
    } catch (error) {
        logger.error(`Failed to delete document: ${filePath}`, error);
        throw error;
    }
}

/**
 * Create a unique storage path for a document
 */
export function createDocumentPath(fileName: string): string {
    if (!storageConfig) {
        throw new Error('Storage has not been initialized');
    }
    
    const uploadDir = path.join(storageConfig.path, 'uploads');
    const dateFolder = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const targetDir = path.join(uploadDir, dateFolder);
    
    // Create date folder if it doesn't exist
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(fileName);
    const newFileName = `${uniqueSuffix}${ext}`;
    
    return path.join(targetDir, newFileName);
}

/**
 * Create a thumbnail for a document
 */
export async function createThumbnail(docPath: string, docId: number): Promise<string | null> {
    if (!storageConfig) {
        throw new Error('Storage has not been initialized');
    }
    
    // This is a placeholder for a real thumbnail generation service
    // In a real application, you would use libraries like pdf.js, sharp or imagemagick
    // to generate thumbnails based on document type
    
    const thumbnailDir = path.join(storageConfig.path, 'thumbnails');
    const thumbnailPath = path.join(thumbnailDir, `${docId}.png`);
    
    try {
        // For now, just copy a default thumbnail based on file extension
        const ext = path.extname(docPath).toLowerCase();
        let defaultIcon = 'document.png';
        
        if (['.pdf'].includes(ext)) {
            defaultIcon = 'pdf.png';
        } else if (['.doc', '.docx'].includes(ext)) {
            defaultIcon = 'word.png';
        } else if (['.xls', '.xlsx'].includes(ext)) {
            defaultIcon = 'excel.png';
        } else if (['.ppt', '.pptx'].includes(ext)) {
            defaultIcon = 'powerpoint.png';
        } else if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
            defaultIcon = 'image.png';
        } else if (['.txt', '.md'].includes(ext)) {
            defaultIcon = 'text.png';
        }
        
        // In a real app, you would generate an actual thumbnail here
        // For now, we'll just log that we would create one
        logger.info(`Would create thumbnail for document ${docId} at ${thumbnailPath}`);
        
        return thumbnailPath;
    } catch (error) {
        logger.error(`Failed to create thumbnail for document ${docId}:`, error);
        return null;
    }
}
