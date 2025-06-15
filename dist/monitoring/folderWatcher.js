"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeFolderMonitoring = initializeFolderMonitoring;
exports.stopFolderMonitoring = stopFolderMonitoring;
const chokidar_1 = __importDefault(require("chokidar"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const indexer_1 = require("../search/indexer");
const processor_1 = require("../ai/processor");
const deadlineTracker_1 = require("../case/deadlineTracker");
const knowledgeBase_1 = require("../case/knowledgeBase");
let watcher = null;
let isProcessing = false;
let processingQueue = [];
/**
 * Initialize folder monitoring
 */
async function initializeFolderMonitoring() {
    const config = (0, config_1.loadConfig)();
    if (!config.caseMonitoring?.enabled) {
        logger_1.logger.info('Case folder monitoring is disabled');
        return;
    }
    const monitorPath = config.caseMonitoring.monitorPath;
    try {
        // Ensure the directory exists
        await promises_1.default.mkdir(monitorPath, { recursive: true });
        logger_1.logger.info(`Starting case folder monitoring on: ${monitorPath}`);
        // Initialize the watcher
        watcher = chokidar_1.default.watch(monitorPath, {
            ignored: /(^|[\/\\])\../, // ignore hidden files
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });
        // Handle new files
        watcher.on('add', async (filePath) => {
            logger_1.logger.info(`New file detected: ${filePath}`);
            processingQueue.push(filePath);
            processNextInQueue();
        });
        // Handle deleted files
        watcher.on('unlink', async (filePath) => {
            logger_1.logger.info(`File removed: ${filePath}`);
            const db = (0, connection_1.getConnection)();
            try {
                // Find document by path
                const docs = await db.query('SELECT id FROM documents WHERE path = ?', [filePath]);
                if (docs && docs.length > 0) {
                    const docId = docs[0].id;
                    // Mark as archived instead of deleting
                    await db.query('UPDATE documents SET archived = 1, archived_at = ? WHERE id = ?', [new Date(), docId]);
                    logger_1.logger.info(`Document ${docId} marked as archived`);
                }
            }
            catch (error) {
                logger_1.logger.error(`Error handling removed file: ${filePath}`, error);
            }
        });
        logger_1.logger.info('Case folder monitoring initialized successfully');
        // Process any existing files on startup
        const files = await promises_1.default.readdir(monitorPath);
        for (const file of files) {
            const filePath = path_1.default.join(monitorPath, file);
            const stats = await promises_1.default.stat(filePath);
            if (stats.isFile()) {
                processingQueue.push(filePath);
            }
        }
        if (processingQueue.length > 0) {
            logger_1.logger.info(`Found ${processingQueue.length} existing files to process`);
            processNextInQueue();
        }
    }
    catch (error) {
        logger_1.logger.error('Error initializing case folder monitoring:', error);
    }
}
/**
 * Process the next file in the queue
 */
async function processNextInQueue() {
    if (isProcessing || processingQueue.length === 0) {
        return;
    }
    isProcessing = true;
    const filePath = processingQueue.shift();
    if (!filePath) {
        isProcessing = false;
        return;
    }
    logger_1.logger.info(`Processing file: ${filePath}`);
    const perfEnd = logger_1.performance.start('process-monitored-file');
    try {
        await processMonitoredFile(filePath);
        logger_1.logger.info(`File processed successfully in ${perfEnd()}ms: ${filePath}`);
    }
    catch (error) {
        logger_1.logger.error(`Error processing file: ${filePath}`, error);
    }
    finally {
        isProcessing = false;
        // Process next file if queue not empty
        if (processingQueue.length > 0) {
            setTimeout(processNextInQueue, 1000);
        }
    }
}
/**
 * Process a monitored file
 */
async function processMonitoredFile(filePath) {
    const config = (0, config_1.loadConfig)();
    const db = (0, connection_1.getConnection)();
    try {
        // Check if file exists and get metadata
        const stats = await promises_1.default.stat(filePath);
        const fileName = path_1.default.basename(filePath);
        const fileExt = path_1.default.extname(fileName).toLowerCase().substring(1);
        // Check if file is an allowed type
        if (!config.document.allowedTypes.includes(fileExt)) {
            logger_1.logger.warn(`Skipping unsupported file type: ${filePath}`);
            return;
        }
        // Check if file already exists in database
        const existingDocs = await db.query('SELECT id FROM documents WHERE path = ?', [filePath]);
        if (existingDocs && existingDocs.length > 0) {
            // Document already exists, skip processing
            logger_1.logger.info(`Document already exists in database: ${filePath}`);
            return;
        }
        // Determine if the file is a PDF
        const isPdf = fileExt === 'pdf';
        const mimeType = isPdf ? 'application/pdf' : `application/${fileExt}`;
        // Add document to database
        logger_1.logger.info(`Adding document to database: ${filePath}`);
        const result = await db.query(`INSERT INTO documents 
             (name, path, size, mime_type, description, uploaded_by, uploaded_at, case_related)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            fileName,
            filePath,
            stats.size,
            mimeType,
            `Auto-imported from case folder: ${config.caseMonitoring.monitorPath}`,
            1, // Admin user ID
            new Date(),
            true // Mark as case-related
        ]);
        const documentId = result.insertId || result.lastID;
        logger_1.logger.info(`Document added to database with ID: ${documentId}`);
        // Start indexing the document
        await (0, indexer_1.indexDocument)(documentId);
        // If PDF, process with AI
        if (isPdf && config.ai.provider !== 'none') {
            // Extract document text first
            const docText = await getDocumentText(documentId);
            if (docText) {
                // Process document asynchronously
                if (config.ai.summarizationEnabled) {
                    const summary = await (0, processor_1.summarizeDocument)(documentId);
                    if (summary) {
                        logger_1.logger.info(`Generated summary for document: ${documentId}`);
                    }
                }
                if (config.ai.analysisEnabled) {
                    const analysis = await (0, processor_1.analyzeDocument)(documentId);
                    if (analysis) {
                        logger_1.logger.info(`Generated analysis for document: ${documentId}`);
                    }
                }
                if (config.ai.taggingEnabled) {
                    const tags = await (0, processor_1.generateDocumentTags)(documentId);
                    if (tags) {
                        logger_1.logger.info(`Generated tags for document: ${documentId}`);
                    }
                }
                // Extract legal deadlines
                const deadlines = await (0, deadlineTracker_1.extractLegalDeadlines)(documentId, docText);
                if (deadlines && deadlines.length > 0) {
                    logger_1.logger.info(`Extracted ${deadlines.length} legal deadlines from document: ${documentId}`);
                }
                // Add to case knowledge base
                await (0, knowledgeBase_1.addToKnowledgeBase)(documentId, docText);
            }
        }
        // Log activity
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [
            1, // Admin user ID
            'auto_import',
            'document',
            documentId,
            `Auto-imported document "${fileName}" from case monitoring folder`,
            new Date()
        ]);
    }
    catch (error) {
        logger_1.logger.error(`Error processing monitored file: ${filePath}`, error);
        throw error;
    }
}
/**
 * Stop folder monitoring
 */
function stopFolderMonitoring() {
    if (watcher) {
        watcher.close();
        watcher = null;
        logger_1.logger.info('Case folder monitoring stopped');
    }
}
/**
 * Get document text for processing
 */
async function getDocumentText(documentId) {
    try {
        const config = (0, config_1.loadConfig)();
        const indexDir = path_1.default.join(config.storage.path, 'indexes');
        const textFilePath = path_1.default.join(indexDir, `${documentId}.txt`);
        try {
            return await promises_1.default.readFile(textFilePath, 'utf8');
        }
        catch (error) {
            logger_1.logger.warn(`No indexed text found for document ${documentId}`);
            return null;
        }
    }
    catch (error) {
        logger_1.logger.error(`Error retrieving document text for ${documentId}:`, error);
        return null;
    }
}
