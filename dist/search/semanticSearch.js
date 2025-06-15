"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticSearch = semanticSearch;
exports.generateDocumentEmbedding = generateDocumentEmbedding;
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const config_1 = require("../config/config");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const uuid_1 = require("uuid");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Perform semantic search across documents
 */
async function semanticSearch(options) {
    const config = (0, config_1.loadConfig)();
    const perfEnd = logger_1.performance.start('semantic-search');
    const { query, page = 1, pageSize = 10, folderId, dateFrom, dateTo, fileTypes, useAI = true, userId } = options;
    try {
        if (!query || query.trim().length === 0) {
            return {
                results: [],
                total: 0,
                page,
                pageSize,
                query
            };
        }
        // Get user's documents
        const db = (0, connection_1.getConnection)();
        // Build SQL conditions
        const conditions = [];
        const params = [];
        // User filter
        if (userId) {
            conditions.push('(d.uploaded_by = ? OR ds.shared_with = ?)');
            params.push(userId, userId);
        }
        // Folder filter
        if (folderId) {
            conditions.push('df.folder_id = ?');
            params.push(folderId);
        }
        // Date range filter
        if (dateFrom) {
            conditions.push('d.uploaded_at >= ?');
            params.push(dateFrom);
        }
        if (dateTo) {
            conditions.push('d.uploaded_at <= ?');
            params.push(dateTo);
        }
        // File type filter
        if (fileTypes && fileTypes.length > 0) {
            const typeConditions = fileTypes.map(() => 'd.mime_type LIKE ?');
            conditions.push(`(${typeConditions.join(' OR ')})`);
            fileTypes.forEach(type => params.push(`%${type}%`));
        }
        // Build query condition
        const sqlCondition = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        // Use AI for semantic search if enabled
        let results = [];
        let total = 0;
        if (useAI && config.ai.provider !== 'none') {
            // Get embeddings for the query using our AI provider
            const queryEmbedding = await getEmbedding(query);
            if (queryEmbedding) {
                // Find documents with similar embeddings
                results = await performEmbeddingSearch(queryEmbedding, sqlCondition, params, page, pageSize);
                total = await getEmbeddingSearchTotal(queryEmbedding, sqlCondition, params);
            }
            else {
                // Fall back to fuzzy keyword search if embedding fails
                logger_1.logger.warn('Embedding generation failed, falling back to keyword search');
                results = await performKeywordSearch(query, sqlCondition, params, page, pageSize);
                total = await getKeywordSearchTotal(query, sqlCondition, params);
            }
        }
        else {
            // Use keyword search
            results = await performKeywordSearch(query, sqlCondition, params, page, pageSize);
            total = await getKeywordSearchTotal(query, sqlCondition, params);
        }
        logger_1.logger.info(`Semantic search completed in ${perfEnd()}ms, found ${total} results`);
        return {
            results,
            total,
            page,
            pageSize,
            query
        };
    }
    catch (error) {
        logger_1.logger.error('Error performing semantic search:', error);
        throw error;
    }
}
/**
 * Get embedding for text using configured AI provider
 */
async function getEmbedding(text) {
    const config = (0, config_1.loadConfig)();
    try {
        switch (config.ai.provider) {
            case 'openai':
                return await getOpenAIEmbedding(text);
            case 'local':
                return await getLocalEmbedding(text);
            default:
                logger_1.logger.warn(`Unsupported AI provider for embeddings: ${config.ai.provider}`);
                return null;
        }
    }
    catch (error) {
        logger_1.logger.error('Error generating embedding:', error);
        return null;
    }
}
/**
 * Get embedding using OpenAI
 */
async function getOpenAIEmbedding(text) {
    const config = (0, config_1.loadConfig)();
    if (!config.ai.apiKey) {
        logger_1.logger.warn('OpenAI API key not configured for embeddings');
        return null;
    }
    try {
        // Call OpenAI embeddings API
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.ai.apiKey}`
            },
            body: JSON.stringify({
                model: 'text-embedding-ada-002',
                input: text.substring(0, 8000) // OpenAI has token limits
            })
        });
        if (!response.ok) {
            logger_1.logger.error(`OpenAI embeddings API error: ${response.status}`);
            return null;
        }
        const result = await response.json();
        return result.data[0].embedding;
    }
    catch (error) {
        logger_1.logger.error('Error calling OpenAI embeddings API:', error);
        return null;
    }
}
/**
 * Get embedding using local model
 */
async function getLocalEmbedding(text) {
    const config = (0, config_1.loadConfig)();
    const pythonPath = config.ai.localModelConfig?.pythonPath || 'python';
    const scriptPath = path_1.default.join(__dirname, '..', 'ai', 'python', 'embedding.py');
    try {
        // Create temp files for input/output
        const tempDir = path_1.default.join(process.cwd(), 'temp');
        await promises_1.default.mkdir(tempDir, { recursive: true });
        const inputFile = path_1.default.join(tempDir, `input-${(0, uuid_1.v4)()}.txt`);
        const outputFile = path_1.default.join(tempDir, `output-${(0, uuid_1.v4)()}.json`);
        // Write text to input file
        await promises_1.default.writeFile(inputFile, text);
        // Call Python script for embeddings
        const command = `"${pythonPath}" "${scriptPath}" --input "${inputFile}" --output "${outputFile}"`;
        await execAsync(command);
        // Read results
        const outputContent = await promises_1.default.readFile(outputFile, 'utf8');
        const embedding = JSON.parse(outputContent);
        // Clean up temp files
        await promises_1.default.unlink(inputFile).catch(() => { });
        await promises_1.default.unlink(outputFile).catch(() => { });
        return embedding;
    }
    catch (error) {
        logger_1.logger.error('Error generating local embedding:', error);
        return null;
    }
}
/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
/**
 * Perform embedding-based semantic search
 */
async function performEmbeddingSearch(queryEmbedding, sqlCondition, params, page, pageSize) {
    const db = (0, connection_1.getConnection)();
    const offset = (page - 1) * pageSize;
    // Since we can't do embedding similarity in SQL directly without specialized extensions,
    // we'll fetch candidate results and rank them in-memory
    const searchQuery = `
    SELECT d.id, d.name, ck.content_chunk, d.uploaded_at, d.uploaded_by
    FROM documents d
    LEFT JOIN case_knowledge ck ON d.id = ck.document_id
    LEFT JOIN document_shares ds ON d.id = ds.document_id
    LEFT JOIN document_folders df ON d.id = df.document_id
    ${sqlCondition}
    GROUP BY d.id
    ORDER BY d.uploaded_at DESC
    LIMIT 100
  `;
    const candidateResults = await db.query(searchQuery, params);
    // Get embeddings for all candidate documents
    const results = [];
    for (const doc of candidateResults) {
        // Get document embedding
        let docEmbedding = null;
        try {
            const embeddingFile = path_1.default.join(process.cwd(), 'data', 'embeddings', `${doc.id}.json`);
            const embeddingContent = await promises_1.default.readFile(embeddingFile, 'utf8');
            docEmbedding = JSON.parse(embeddingContent);
        }
        catch (error) {
            // If no embedding exists, generate one on the fly
            if (doc.content_chunk) {
                docEmbedding = await getEmbedding(doc.content_chunk);
                // Cache the embedding for future use
                if (docEmbedding) {
                    const embeddingDir = path_1.default.join(process.cwd(), 'data', 'embeddings');
                    await promises_1.default.mkdir(embeddingDir, { recursive: true });
                    const embeddingFile = path_1.default.join(embeddingDir, `${doc.id}.json`);
                    await promises_1.default.writeFile(embeddingFile, JSON.stringify(docEmbedding));
                }
            }
        }
        if (docEmbedding) {
            // Calculate similarity score
            const score = cosineSimilarity(queryEmbedding, docEmbedding);
            // Add to results if score is above threshold
            if (score > 0.7) {
                results.push({
                    documentId: doc.id,
                    documentName: doc.name,
                    excerpt: extractRelevantExcerpt(doc.content_chunk || ''),
                    score,
                    matchType: 'semantic'
                });
            }
        }
    }
    // Sort by similarity score and paginate
    return results
        .sort((a, b) => b.score - a.score)
        .slice(offset, offset + pageSize);
}
/**
 * Get total count for embedding search
 */
async function getEmbeddingSearchTotal(queryEmbedding, sqlCondition, params) {
    // For semantic search, we need to check relevant documents individually 
    // This is a placeholder - we'd need to check all documents
    return 100;
}
/**
 * Perform keyword-based search
 */
async function performKeywordSearch(query, sqlCondition, params, page, pageSize) {
    const db = (0, connection_1.getConnection)();
    const offset = (page - 1) * pageSize;
    // Add query parameters for keyword search
    const keywords = query.split(' ')
        .filter(word => word.length > 2)
        .map(word => `%${word}%`);
    if (keywords.length === 0) {
        return [];
    }
    // Create conditions for each keyword
    const keywordConditions = keywords.map(() => '(d.name LIKE ? OR d.description LIKE ? OR ck.content_chunk LIKE ?)').join(' OR ');
    // Add keyword parameters
    const keywordParams = [];
    for (const keyword of keywords) {
        keywordParams.push(keyword, keyword, keyword);
    }
    // Build complete query
    const finalCondition = sqlCondition ?
        `${sqlCondition} AND (${keywordConditions})` :
        `WHERE ${keywordConditions}`;
    const searchQuery = `
    SELECT d.id, d.name, ck.content_chunk
    FROM documents d
    LEFT JOIN case_knowledge ck ON d.id = ck.document_id
    LEFT JOIN document_shares ds ON d.id = ds.document_id
    LEFT JOIN document_folders df ON d.id = df.document_id
    ${finalCondition}
    GROUP BY d.id
    ORDER BY d.uploaded_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
    const allParams = [...params, ...keywordParams];
    const results = await db.query(searchQuery, allParams);
    // Format results
    return results.map((doc) => ({
        documentId: doc.id,
        documentName: doc.name,
        excerpt: extractRelevantExcerpt(doc.content_chunk || '', query),
        score: 0.5, // Default score for keyword matches
        matchType: 'keyword'
    }));
}
/**
 * Get total count for keyword search
 */
async function getKeywordSearchTotal(query, sqlCondition, params) {
    const db = (0, connection_1.getConnection)();
    // Add query parameters for keyword search
    const keywords = query.split(' ')
        .filter(word => word.length > 2)
        .map(word => `%${word}%`);
    if (keywords.length === 0) {
        return 0;
    }
    // Create conditions for each keyword
    const keywordConditions = keywords.map(() => '(d.name LIKE ? OR d.description LIKE ? OR ck.content_chunk LIKE ?)').join(' OR ');
    // Add keyword parameters
    const keywordParams = [];
    for (const keyword of keywords) {
        keywordParams.push(keyword, keyword, keyword);
    }
    // Build complete query
    const finalCondition = sqlCondition ?
        `${sqlCondition} AND (${keywordConditions})` :
        `WHERE ${keywordConditions}`;
    const countQuery = `
    SELECT COUNT(DISTINCT d.id) as total
    FROM documents d
    LEFT JOIN case_knowledge ck ON d.id = ck.document_id
    LEFT JOIN document_shares ds ON d.id = ds.document_id
    LEFT JOIN document_folders df ON d.id = df.document_id
    ${finalCondition}
  `;
    const allParams = [...params, ...keywordParams];
    const result = await db.query(countQuery, allParams);
    return result[0].total || 0;
}
/**
 * Extract a relevant excerpt from document content
 */
function extractRelevantExcerpt(content, query) {
    if (!content)
        return '';
    if (query && query.length > 0) {
        // Find most relevant excerpt based on query
        const keywords = query.toLowerCase().split(' ').filter(w => w.length > 2);
        if (keywords.length > 0) {
            // Find first occurrence of any keyword
            let bestPos = -1;
            for (const keyword of keywords) {
                const pos = content.toLowerCase().indexOf(keyword);
                if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
                    bestPos = pos;
                }
            }
            if (bestPos !== -1) {
                // Extract context around the keyword
                const start = Math.max(0, bestPos - 100);
                const end = Math.min(content.length, bestPos + 200);
                return content.substring(start, end) + '...';
            }
        }
    }
    // If no query or no match found, return beginning of content
    return content.substring(0, 300) + (content.length > 300 ? '...' : '');
}
/**
 * Get embedding for a specific document ID
 */
async function generateDocumentEmbedding(documentId) {
    try {
        const db = (0, connection_1.getConnection)();
        const docs = await db.query('SELECT d.id, ck.content_chunk FROM documents d LEFT JOIN case_knowledge ck ON d.id = ck.document_id WHERE d.id = ?', [documentId]);
        if (!docs || docs.length === 0 || !docs[0].content_chunk) {
            logger_1.logger.warn(`No content found for document ${documentId}`);
            return false;
        }
        // Generate embedding
        const text = docs[0].content_chunk;
        const embedding = await getEmbedding(text);
        if (!embedding) {
            logger_1.logger.warn(`Failed to generate embedding for document ${documentId}`);
            return false;
        }
        // Save embedding
        const embeddingDir = path_1.default.join(process.cwd(), 'data', 'embeddings');
        await promises_1.default.mkdir(embeddingDir, { recursive: true });
        const embeddingFile = path_1.default.join(embeddingDir, `${documentId}.json`);
        await promises_1.default.writeFile(embeddingFile, JSON.stringify(embedding));
        logger_1.logger.info(`Generated embedding for document ${documentId}`);
        return true;
    }
    catch (error) {
        logger_1.logger.error(`Error generating embedding for document ${documentId}:`, error);
        return false;
    }
}
