import fs from 'fs';
import path from 'path';
import { IndexingConfig } from '../config/config';
import { getConnection } from '../database/connection';
import { logger, performance } from '../utils/logger';
import natural from 'natural';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { loadConfig } from '../config/config';

// Tokenizer for text analysis
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;

// Global config
let config: IndexingConfig;
let indexWorkers: Worker[] = [];

// Interface for search results
export interface SearchResult {
    documentId: number;
    documentName: string;
    score: number;
    snippet: string;
    path: string;
}

/**
 * Initialize the document indexer
 */
export async function initializeIndexer(indexingConfig: IndexingConfig): Promise<void> {
    logger.info(`Initializing document indexer (threads: ${indexingConfig.threads})...`);
    config = indexingConfig;

    try {
        // Create index directory if it doesn't exist
        const indexDir = path.join(loadConfig().storage.path, 'indexes');
        if (!fs.existsSync(indexDir)) {
            fs.mkdirSync(indexDir, { recursive: true });
        }

        // Initialize workers for parallel processing
        for (let i = 0; i < config.threads; i++) {
            const worker = new Worker(__filename, {
                workerData: {
                    workerId: i,
                    config: indexingConfig
                }
            });

            worker.on('error', (err) => {
                logger.error(`Worker ${i} error:`, err);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    logger.error(`Worker ${i} stopped with exit code ${code}`);
                }
            });

            indexWorkers.push(worker);
        }

        logger.info(`Document indexer initialized with ${config.threads} worker threads`);
    } catch (error) {
        logger.error('Failed to initialize document indexer:', error);
        throw error;
    }
}

/**
 * Index a document
 */
export async function indexDocument(docId: number, filePath: string, docName: string, mimeType: string): Promise<void> {
    logger.info(`Indexing document: ${docName} (ID: ${docId})`);
    const perfEnd = performance.start(`index-doc-${docId}`);

    try {
        // Extract text from document based on file type
        const text = await extractText(filePath, mimeType);

        if (!text) {
            logger.warn(`No text extracted from document ${docId}`);
            return;
        }

        // Process and store the document text
        await processDocumentText(docId, text);

        // Update document status in database
        const db = getConnection();
        await db.query('UPDATE documents SET indexed = 1, indexed_at = ? WHERE id = ?', [new Date(), docId]);

        logger.info(`Document indexed successfully: ${docName} (ID: ${docId}) in ${perfEnd()}ms`);
    } catch (error) {
        logger.error(`Failed to index document ${docId}:`, error);
        throw error;
    }
}

/**
 * Extract text from a document
 */
async function extractText(filePath: string, mimeType: string): Promise<string | null> {
    // This is a simplified implementation
    // In a real app, you would use specialized libraries based on file type:
    // - PDF: pdf.js, pdf-parse
    // - Office: mammoth, xlsx, etc.
    // - Images with OCR: tesseract.js

    try {
        const ext = path.extname(filePath).toLowerCase();

        // For plain text files, just read the content
        if (['.txt', '.md', '.json', '.csv'].includes(ext)) {
            return await fs.promises.readFile(filePath, 'utf8');
        }

        // For PDFs, we'd use a PDF parser
        if (ext === '.pdf') {
            // Placeholder for PDF text extraction
            logger.info(`Would extract text from PDF: ${filePath}`);
            return `Sample text extracted from PDF file ${path.basename(filePath)}`;
        }

        // For Office documents
        if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) {
            logger.info(`Would extract text from Office document: ${filePath}`);
            return `Sample text extracted from Office file ${path.basename(filePath)}`;
        }

        // For images, if OCR is enabled
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext) && config.enableOcr) {
            // Placeholder for OCR
            logger.info(`Would perform OCR on image: ${filePath}`);
            return `Sample text extracted via OCR from image file ${path.basename(filePath)}`;
        }

        logger.warn(`Unsupported file type for text extraction: ${ext}`);
        return null;
    } catch (error) {
        logger.error(`Failed to extract text from ${filePath}:`, error);
        return null;
    }
}

/**
 * Process and index document text
 */
async function processDocumentText(docId: number, text: string): Promise<void> {
    // Tokenize and stem the text
    const tokens = tokenizer.tokenize(text.toLowerCase());
    const stems = tokens.map(token => stemmer.stem(token));

    // Count term frequencies
    const termFrequency: Record<string, number> = {};
    stems.forEach(stem => {
        termFrequency[stem] = (termFrequency[stem] || 0) + 1;
    });

    // Store the index data
    const db = getConnection();

    // Clear existing terms for this document
    await db.query('DELETE FROM document_terms WHERE document_id = ?', [docId]);

    // Insert new terms
    for (const [term, frequency] of Object.entries(termFrequency)) {
        await db.query(
            'INSERT INTO document_terms (document_id, term, frequency) VALUES (?, ?, ?)',
            [docId, term, frequency]
        );
    }

    // Store document text for full-text search
    const indexDir = path.join(loadConfig().storage.path, 'indexes');
    const textFilePath = path.join(indexDir, `${docId}.txt`);
    await fs.promises.writeFile(textFilePath, text);
}

/**
 * Search documents
 */
export async function searchDocuments(query: string): Promise<SearchResult[]> {
    logger.info(`Searching for: ${query}`);
    const perfEnd = performance.start(`search-${query}`);

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
        const db = getConnection();

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
        const searchResults: SearchResult[] = [];

        for (const result of results) {
            // Get document text to create snippet
            const indexDir = path.join(loadConfig().storage.path, 'indexes');
            const textFilePath = path.join(indexDir, `${result.id}.txt`);

            let snippet = '';
            if (fs.existsSync(textFilePath)) {
                const docText = await fs.promises.readFile(textFilePath, 'utf8');
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

        logger.info(`Search completed in ${perfEnd()}ms, found ${searchResults.length} results`);
        return searchResults;
    } catch (error) {
        logger.error('Search error:', error);
        throw error;
    }
}

/**
 * Generate a text snippet highlighting the search terms
 */
function generateSnippet(text: string, searchTerms: string[]): string {
    const maxSnippetLength = 200;
    const lowerText = text.toLowerCase();

    // Find positions of search terms
    const positions: number[] = [];
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
if (!isMainThread) {
    const { workerId, config } = workerData;

    // Log worker startup
    console.log(`Worker ${workerId} started`);

    // Listen for tasks from the main thread
    parentPort!.on('message', async (task) => {
        try {
            // Process task based on type
            if (task.type === 'index') {
                const { docId, filePath, mimeType } = task;

                // Extract text - this would be the actual implementation in a real app
                console.log(`Worker ${workerId} processing document ${docId}`);

                // Signal completion back to main thread
                parentPort!.postMessage({
                    type: 'done',
                    docId,
                    success: true
                });
            }
        } catch (error) {
            console.error(`Worker ${workerId} error:`, error);
            parentPort!.postMessage({
                type: 'done',
                docId: task.docId,
                success: false,
                error: error.message
            });
        }
    });
}
