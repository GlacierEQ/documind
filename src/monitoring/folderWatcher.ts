import chokidar from 'chokidar';
import fs from 'fs/promises';
import path from 'path';
import { loadConfig } from '../config/config';
import { logger, performance } from '../utils/logger';
import { getConnection } from '../database/connection';
import { indexDocument } from '../search/indexer';
import { summarizeDocument, analyzeDocument, generateDocumentTags } from '../ai/processor';
import { extractLegalDeadlines } from '../case/deadlineTracker';
import { addToKnowledgeBase } from '../case/knowledgeBase';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

let watcher: chokidar.FSWatcher | null = null;
let isProcessing = false;
let processingQueue: string[] = [];

/**
 * Initialize folder monitoring
 */
export async function initializeFolderMonitoring(): Promise<void> {
    const config = loadConfig();

    if (!config.caseMonitoring?.enabled) {
        logger.info('Case folder monitoring is disabled');
        return;
    }

    const monitorPath = config.caseMonitoring.monitorPath;

    try {
        // Ensure the directory exists
        await fs.mkdir(monitorPath, { recursive: true });

        logger.info(`Starting case folder monitoring on: ${monitorPath}`);

        // Initialize the watcher
        watcher = chokidar.watch(monitorPath, {
            ignored: /(^|[\/\\])\../, // ignore hidden files
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });

        // Handle new files
        watcher.on('add', async (filePath) => {
            logger.info(`New file detected: ${filePath}`);
            processingQueue.push(filePath);
            processNextInQueue();
        });

        // Handle deleted files
        watcher.on('unlink', async (filePath) => {
            logger.info(`File removed: ${filePath}`);
            const db = getConnection();

            try {
                // Find document by path
                const docs = await db.query(
                    'SELECT id FROM documents WHERE path = ?',
                    [filePath]
                );

                if (docs && docs.length > 0) {
                    const docId = docs[0].id;
                    // Mark as archived instead of deleting
                    await db.query(
                        'UPDATE documents SET archived = 1, archived_at = ? WHERE id = ?',
                        [new Date(), docId]
                    );

                    logger.info(`Document ${docId} marked as archived`);
                }
            } catch (error) {
                logger.error(`Error handling removed file: ${filePath}`, error);
            }
        });

        logger.info('Case folder monitoring initialized successfully');

        // Process any existing files on startup
        const files = await fs.readdir(monitorPath);
        for (const file of files) {
            const filePath = path.join(monitorPath, file);
            const stats = await fs.stat(filePath);
            if (stats.isFile()) {
                processingQueue.push(filePath);
            }
        }

        if (processingQueue.length > 0) {
            logger.info(`Found ${processingQueue.length} existing files to process`);
            processNextInQueue();
        }

    } catch (error) {
        logger.error('Error initializing case folder monitoring:', error);
    }
}

/**
 * Process the next file in the queue
 */
async function processNextInQueue(): Promise<void> {
    if (isProcessing || processingQueue.length === 0) {
        return;
    }

    isProcessing = true;
    const filePath = processingQueue.shift();

    if (!filePath) {
        isProcessing = false;
        return;
    }

    logger.info(`Processing file: ${filePath}`);
    const perfEnd = performance.start('process-monitored-file');

    try {
        await processMonitoredFile(filePath);
        logger.info(`File processed successfully in ${perfEnd()}ms: ${filePath}`);
    } catch (error) {
        logger.error(`Error processing file: ${filePath}`, error);
    } finally {
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
async function processMonitoredFile(filePath: string): Promise<void> {
    const config = loadConfig();
    const db = getConnection();

    try {
        // Check if file exists and get metadata
        const stats = await fs.stat(filePath);
        const fileName = path.basename(filePath);
        const fileExt = path.extname(fileName).toLowerCase().substring(1);

        // Check if file is an allowed type
        if (!config.document.allowedTypes.includes(fileExt)) {
            logger.warn(`Skipping unsupported file type: ${filePath}`);
            return;
        }

        // Check if file already exists in database
        const existingDocs = await db.query(
            'SELECT id FROM documents WHERE path = ?',
            [filePath]
        );

        if (existingDocs && existingDocs.length > 0) {
            // Document already exists, skip processing
            logger.info(`Document already exists in database: ${filePath}`);
            return;
        }

        // Determine if the file is a PDF
        const isPdf = fileExt === 'pdf';
        const mimeType = isPdf ? 'application/pdf' : `application/${fileExt}`;

        // Add document to database
        logger.info(`Adding document to database: ${filePath}`);
        const result = await db.query(
            `INSERT INTO documents 
             (name, path, size, mime_type, description, uploaded_by, uploaded_at, case_related)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                fileName,
                filePath,
                stats.size,
                mimeType,
                `Auto-imported from case folder: ${config.caseMonitoring.monitorPath}`,
                1, // Admin user ID
                new Date(),
                true // Mark as case-related
            ]
        );

        const documentId = result.insertId || result.lastID;
        logger.info(`Document added to database with ID: ${documentId}`);

        // Start indexing the document
        await indexDocument(documentId);

        // If PDF, process with AI
        if (isPdf && config.ai.provider !== 'none') {
            // Extract document text first
            const docText = await getDocumentText(documentId);

            if (docText) {
                // Process document asynchronously
                if (config.ai.summarizationEnabled) {
                    const summary = await summarizeDocument(documentId);
                    if (summary) {
                        logger.info(`Generated summary for document: ${documentId}`);
                    }
                }

                if (config.ai.analysisEnabled) {
                    const analysis = await analyzeDocument(documentId);
                    if (analysis) {
                        logger.info(`Generated analysis for document: ${documentId}`);
                    }
                }

                if (config.ai.taggingEnabled) {
                    const tags = await generateDocumentTags(documentId);
                    if (tags) {
                        logger.info(`Generated tags for document: ${documentId}`);
                    }
                }

                // Extract legal deadlines
                const deadlines = await extractLegalDeadlines(documentId, docText);
                if (deadlines && deadlines.length > 0) {
                    logger.info(`Extracted ${deadlines.length} legal deadlines from document: ${documentId}`);
                }

                // Add to case knowledge base
                await addToKnowledgeBase(documentId, docText);
            }
        }

        // Log activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                1, // Admin user ID
                'auto_import',
                'document',
                documentId,
                `Auto-imported document "${fileName}" from case monitoring folder`,
                new Date()
            ]
        );

    } catch (error) {
        logger.error(`Error processing monitored file: ${filePath}`, error);
        throw error;
    }
}

/**
 * Stop folder monitoring
 */
export function stopFolderMonitoring(): void {
    if (watcher) {
        watcher.close();
        watcher = null;
        logger.info('Case folder monitoring stopped');
    }
}

/**
 * Get document text for processing
 */
async function getDocumentText(documentId: number): Promise<string | null> {
    try {
        const config = loadConfig();
        const indexDir = path.join(config.storage.path, 'indexes');
        const textFilePath = path.join(indexDir, `${documentId}.txt`);

        try {
            return await fs.readFile(textFilePath, 'utf8');
        } catch (error) {
            logger.warn(`No indexed text found for document ${documentId}`);
            return null;
        }
    } catch (error) {
        logger.error(`Error retrieving document text for ${documentId}:`, error);
        return null;
    }
}
