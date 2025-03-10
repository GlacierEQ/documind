"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupStorage = setupStorage;
exports.getStorageStatus = getStorageStatus;
exports.deleteDocument = deleteDocument;
exports.createDocumentPath = createDocumentPath;
exports.createThumbnail = createThumbnail;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
// Global storage configuration
let storageConfig;
/**
 * Setup storage system
 */
async function setupStorage(config) {
    logger_1.logger.info(`Setting up document storage at ${config.path}...`);
    storageConfig = config;
    try {
        // Create storage directory if it doesn't exist
        if (!fs_1.default.existsSync(config.path)) {
            fs_1.default.mkdirSync(config.path, { recursive: true });
            logger_1.logger.info(`Created storage directory: ${config.path}`);
        }
        // Create subdirectories
        const dirs = ['uploads', 'thumbnails', 'indexes', 'temp'];
        for (const dir of dirs) {
            const dirPath = path_1.default.join(config.path, dir);
            if (!fs_1.default.existsSync(dirPath)) {
                fs_1.default.mkdirSync(dirPath, { recursive: true });
            }
        }
        // Check storage status
        const status = await getStorageStatus();
        logger_1.logger.info(`Storage status: ${status.usedSpace / (1024 * 1024)} MB used (${status.usagePercent.toFixed(2)}%)`);
        if (status.usagePercent > 90) {
            logger_1.logger.warn(`Storage usage is high: ${status.usagePercent.toFixed(2)}%`);
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to setup storage:', error);
        throw error;
    }
}
/**
 * Get storage status
 */
async function getStorageStatus() {
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
    }
    catch (error) {
        logger_1.logger.error('Failed to get storage status:', error);
        throw error;
    }
}
/**
 * Calculate directory size
 */
async function calculateDirSize(dirPath) {
    const files = await fs_1.default.promises.readdir(dirPath);
    let size = 0;
    for (const file of files) {
        const filePath = path_1.default.join(dirPath, file);
        const stats = await fs_1.default.promises.stat(filePath);
        if (stats.isDirectory()) {
            size += await calculateDirSize(filePath);
        }
        else {
            size += stats.size;
        }
    }
    return size;
}
/**
 * Delete a document from storage
 */
async function deleteDocument(filePath) {
    try {
        if (fs_1.default.existsSync(filePath)) {
            await fs_1.default.promises.unlink(filePath);
            logger_1.logger.info(`Deleted document file: ${filePath}`);
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to delete document: ${filePath}`, error);
        throw error;
    }
}
/**
 * Create a unique storage path for a document
 */
function createDocumentPath(fileName) {
    if (!storageConfig) {
        throw new Error('Storage has not been initialized');
    }
    const uploadDir = path_1.default.join(storageConfig.path, 'uploads');
    const dateFolder = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const targetDir = path_1.default.join(uploadDir, dateFolder);
    // Create date folder if it doesn't exist
    if (!fs_1.default.existsSync(targetDir)) {
        fs_1.default.mkdirSync(targetDir, { recursive: true });
    }
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path_1.default.extname(fileName);
    const newFileName = `${uniqueSuffix}${ext}`;
    return path_1.default.join(targetDir, newFileName);
}
/**
 * Create a thumbnail for a document
 */
async function createThumbnail(docPath, docId) {
    if (!storageConfig) {
        throw new Error('Storage has not been initialized');
    }
    // This is a placeholder for a real thumbnail generation service
    // In a real application, you would use libraries like pdf.js, sharp or imagemagick
    // to generate thumbnails based on document type
    const thumbnailDir = path_1.default.join(storageConfig.path, 'thumbnails');
    const thumbnailPath = path_1.default.join(thumbnailDir, `${docId}.png`);
    try {
        // For now, just copy a default thumbnail based on file extension
        const ext = path_1.default.extname(docPath).toLowerCase();
        let defaultIcon = 'document.png';
        if (['.pdf'].includes(ext)) {
            defaultIcon = 'pdf.png';
        }
        else if (['.doc', '.docx'].includes(ext)) {
            defaultIcon = 'word.png';
        }
        else if (['.xls', '.xlsx'].includes(ext)) {
            defaultIcon = 'excel.png';
        }
        else if (['.ppt', '.pptx'].includes(ext)) {
            defaultIcon = 'powerpoint.png';
        }
        else if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
            defaultIcon = 'image.png';
        }
        else if (['.txt', '.md'].includes(ext)) {
            defaultIcon = 'text.png';
        }
        // In a real app, you would generate an actual thumbnail here
        // For now, we'll just log that we would create one
        logger_1.logger.info(`Would create thumbnail for document ${docId} at ${thumbnailPath}`);
        return thumbnailPath;
    }
    catch (error) {
        logger_1.logger.error(`Failed to create thumbnail for document ${docId}:`, error);
        return null;
    }
}
