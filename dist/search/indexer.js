"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeIndexer = initializeIndexer;
exports.indexDocument = indexDocument;
exports.searchDocuments = searchDocuments;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const natural_1 = __importDefault(require("natural"));
const worker_threads_1 = require("worker_threads");
const config_1 = require("../config/config");
// Tokenizer for text analysis
const tokenizer = new natural_1.default.WordTokenizer();
const stemmer = natural_1.default.PorterStemmer;
// Global config
let config;
let indexWorkers = [];
/**
 * Initialize the document indexer
 */
async function initializeIndexer(indexingConfig) {
    logger_1.logger.info(`Initializing document indexer (threads: ${indexingConfig.threads})...`);
    config = indexingConfig;
    try {
        // Create index directory if it doesn't exist
        const indexDir = path_1.default.join((0, config_1.loadConfig)().storage.path, 'indexes');
        if (!fs_1.default.existsSync(indexDir)) {
            fs_1.default.mkdirSync(indexDir, { recursive: true });
        }
        // Initialize workers for parallel processing
        for (let i = 0; i < config.threads; i++) {
            const worker = new worker_threads_1.Worker(__filename, {
                workerData: {
                    workerId: i,
                    config: indexingConfig
                }
            });
            worker.on('error', (err) => {
                logger_1.logger.error(`Worker ${i} error:`, err);
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    logger_1.logger.error(`Worker ${i} stopped with exit code ${code}`);
                }
            });
            indexWorkers.push(worker);
        }
        logger_1.logger.info(`Document indexer initialized with ${config.threads} worker threads`);
    }
    catch (error) {
        logger_1.logger.error('Failed to initialize document indexer:', error);
        throw error;
    }
}
/**
 * Index a document
 */
async function indexDocument(docId, filePath, docName, mimeType) {
    logger_1.logger.info(`Indexing document: ${docName} (ID: ${docId})`);
    const perfEnd = logger_1.performance.start(`index-doc-${docId}`);
    try {
        // Extract text from document based on file type
        const text = await extractText(filePath, mimeType);
        if (!text) {
            logger_1.logger.warn(`No text extracted from document ${docId}`);
            return;
        }
        // Process and store the document text
        await processDocumentText(docId, text);
        // Update document status in database
        const db = (0, connection_1.getConnection)();
        await db.query('UPDATE documents SET indexed = 1, indexed_at = ? WHERE id = ?', [new Date(), docId]);
        logger_1.logger.info(`Document indexed successfully: ${docName} (ID: ${docId}) in ${perfEnd()}ms`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to index document ${docId}:`, error);
        throw error;
    }
}
/**
 * Extract text from a document
 */
async function extractText(filePath, mimeType) {
    // This is a simplified implementation
    // In a real app, you would use specialized libraries based on file type:
    // - PDF: pdf.js, pdf-parse
    // - Office: mammoth, xlsx, etc.
    // - Images with OCR: tesseract.js
    try {
        const ext = path_1.default.extname(filePath).toLowerCase();
        // For plain text files, just read the content
        if (['.txt', '.md', '.json', '.csv'].includes(ext)) {
            return await fs_1.default.promises.readFile(filePath, 'utf8');
        }
        // For PDFs, we'd use a PDF parser
        if (ext === '.pdf') {
            // Placeholder for PDF text extraction
            logger_1.logger.info(`Would extract text from PDF: ${filePath}`);
            return `Sample text extracted from PDF file ${path_1.default.basename(filePath)}`;
        }
        // For Office documents
        if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) {
            logger_1.logger.info(`Would extract text from Office document: ${filePath}`);
            return `Sample text extracted from Office file ${path_1.default.basename(filePath)}`;
        }
        // For images, if OCR is enabled
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext) && config.enableOcr) {
            // Placeholder for OCR
            logger_1.logger.info(`Would perform OCR on image: ${filePath}`);
            return `Sample text extracted via OCR from image file ${path_1.default.basename(filePath)}`;
        }
        logger_1.logger.warn(`Unsupported file type for text extraction: ${ext}`);
        return null;
    }
    catch (error) {
        logger_1.logger.error(`Failed to extract text from ${filePath}:`, error);
        return null;
    }
}
/**
 * Process and index document text
 */
async function processDocumentText(docId, text) {
    // Tokenize and stem the text
    const tokens = tokenizer.tokenize(text.toLowerCase());
    const stems = tokens.map(token => stemmer.stem(token));
    // Count term frequencies
    const termFrequency = {};
    stems.forEach(stem => {
        termFrequency[stem] = (termFrequency[stem] || 0) + 1;
    });
    // Store the index data
    const db = (0, connection_1.getConnection)();
    // Clear existing terms for this document
    await db.query('DELETE FROM document_terms WHERE document_id = ?', [docId]);
    // Insert new terms
    for (const [term, frequency] of Object.entries(termFrequency)) {
        await db.query('INSERT INTO document_terms (document_id, term, frequency) VALUES (?, ?, ?)', [docId, term, frequency]);
    }
    // Store document text for full-text search
    const indexDir = path_1.default.join((0, config_1.loadConfig)().storage.path, 'indexes');
    const textFilePath = path_1.default.join(indexDir, `${docId}.txt`);
    await fs_1.default.promises.writeFile(textFilePath, text);
}
/**
 * Search documents
 */
async function searchDocuments(query) {
    logger_1.logger.info(`Searching for: ${query}`);
    const perfEnd = logger_1.performance.start(`search-${query}`);
    try {
        // Process query similar to how we process documents
        const queryTokens = tokenizer.tokenize(query.toLowerCase());
        const queryStemsSet = new Set(queryTokens.map(token => stemmer.stem(token)));
        const queryStems = Array.from(queryStemsSet); // Unique stems
        if (queryStems.length === 0) {
            return [];
        }
        // Build SQL query with term matching
        // This is a simplified version - a real implementation would use a proper ranking algorithm
        const db = (0, connection_1.getConnection)();
        // Create a parameterized IN clause
        const placeholders = queryStems.map(() => '?').join(', ');
        const query = `
            SELECT 
                d.id, 
                d.name, 
                d.path,
                SUM(dt.frequency) as score
            FROM documents d
            JOIN document_terms dt ON d.id = dt.document_id
            WHERE dt.term IN (${placeholders})
            GROUP BY d.id
            ORDER BY score DESC
            LIMIT 20
        `;
        const results = await db.query(query, queryStems);
        // Generate search results with snippets
        const searchResults = [];
        for (const result of results) {
            // Get document text to create snippet
            const indexDir = path_1.default.join((0, config_1.loadConfig)().storage.path, 'indexes');
            const textFilePath = path_1.default.join(indexDir, `${result.id}.txt`);
            let snippet = '';
            if (fs_1.default.existsSync(textFilePath)) {
                const docText = await fs_1.default.promises.readFile(textFilePath, 'utf8');
                snippet = generateSnippet(docText, queryTokens);
            }
            searchResults.push({
                documentId: result.id,
                documentName: result.name,
                score: result.score,
                snippet,
                path: result.path
            });
        }
        logger_1.logger.info(`Search completed in ${perfEnd()}ms, found ${searchResults.length} results`);
        return searchResults;
    }
    catch (error) {
        logger_1.logger.error('Search error:', error);
        throw error;
    }
}
/**
 * Generate a text snippet highlighting the search terms
 */
function generateSnippet(text, searchTerms) {
    const maxSnippetLength = 200;
    const lowerText = text.toLowerCase();
    // Find positions of search terms
    const positions = [];
    searchTerms.forEach(term => {
        let pos = lowerText.indexOf(term);
        while (pos !== -1) {
            positions.push(pos);
            pos = lowerText.indexOf(term, pos + 1);
        }
    });
    if (positions.length === 0) {
        // If no terms found, take the beginning of the text
        return text.substring(0, maxSnippetLength) + '...';
    }
    // Find a good position for the snippet
    positions.sort((a, b) => a - b);
    const snippetStart = Math.max(0, positions[0] - 40);
    let snippetEnd = Math.min(text.length, snippetStart + maxSnippetLength);
    // Try to end at a sensible boundary
    const possibleEndings = ['. ', '! ', '? ', '\n'];
    for (const ending of possibleEndings) {
        const endPos = text.indexOf(ending, snippetEnd - 20);
        if (endPos !== -1 && endPos < snippetEnd + 20) {
            snippetEnd = endPos + 1;
            break;
        }
    }
    let snippet = text.substring(snippetStart, snippetEnd);
    // Add ellipsis if needed
    if (snippetStart > 0) {
        snippet = '...' + snippet;
    }
    if (snippetEnd < text.length) {
        snippet = snippet + '...';
    }
    return snippet;
}
// Worker thread implementation for parallel processing
if (!worker_threads_1.isMainThread) {
    const { workerId, config } = worker_threads_1.workerData;
    // Log worker startup
    console.log(`Worker ${workerId} started`);
    // Listen for tasks from the main thread
    worker_threads_1.parentPort.on('message', async (task) => {
        try {
            // Process task based on type
            if (task.type === 'index') {
                const { docId, filePath, mimeType } = task;
                // Extract text - this would be the actual implementation in a real app
                console.log(`Worker ${workerId} processing document ${docId}`);
                // Signal completion back to main thread
                worker_threads_1.parentPort.postMessage({
                    type: 'done',
                    docId,
                    success: true
                });
            }
        }
        catch (error) {
            console.error(`Worker ${workerId} error:`, error);
            worker_threads_1.parentPort.postMessage({
                type: 'done',
                docId: task.docId,
                success: false,
                error: error.message
            });
        }
    });
}
