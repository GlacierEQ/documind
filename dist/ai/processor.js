"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAIProcessor = initializeAIProcessor;
exports.summarizeDocument = summarizeDocument;
exports.analyzeDocument = analyzeDocument;
exports.generateDocumentTags = generateDocumentTags;
exports.summarizeDocument = summarizeDocument;
exports.generateEmbeddings = generateEmbeddings;
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const text_1 = require("../utils/text");
// For OpenAI integration
const openai_1 = __importDefault(require("openai"));
// For Anthropic integration
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
// Import local provider functions
const localProvider_1 = require("./localProvider");
// Import Granite provider functions
const graniteProvider_1 = require("./graniteProvider");
// Track API usage
let apiCallsThisHour = 0;
let lastResetTime = Date.now();
/**
 * Initialize AI processor
 */
function initializeAIProcessor() {
    const config = (0, config_1.loadConfig)();
    if (config.ai.provider === 'none') {
        logger_1.logger.info('AI processing is disabled (provider: none)');
        return;
    }
    logger_1.logger.info(`Initializing AI processor (provider: ${config.ai.provider})`);
    // Reset API call counter every hour
    setInterval(() => {
        const previousCalls = apiCallsThisHour;
        apiCallsThisHour = 0;
        lastResetTime = Date.now();
        logger_1.logger.debug(`Reset AI API call counter. Previous hour: ${previousCalls} calls`);
    }, 60 * 60 * 1000);
}
/**
 * Generate a summary of a document
 */
async function summarizeDocument(documentId) {
    const config = (0, config_1.loadConfig)();
    if (config.ai.provider === 'none' || !config.ai.summarizationEnabled) {
        logger_1.logger.warn('Document summarization is disabled');
        return null;
    }
    const perfEnd = logger_1.performance.start(`summarize-doc-${documentId}`);
    const db = (0, connection_1.getConnection)();
    try {
        // Check cache first if enabled
        if (config.ai.cacheResults) {
            const cachedResults = await db.query('SELECT * FROM ai_summaries WHERE document_id = ? AND created_at > ?', [documentId, new Date(Date.now() - config.ai.cacheTTL * 1000)]);
            if (cachedResults && cachedResults.length > 0) {
                logger_1.logger.info(`Using cached summary for document ${documentId}`);
                const result = cachedResults[0];
                return {
                    summary: result.summary,
                    keyPoints: JSON.parse(result.key_points),
                    timestamp: result.created_at
                };
            }
        }
        // Get document text
        const text = await getDocumentText(documentId);
        if (!text) {
            logger_1.logger.warn(`No text found for document ${documentId}`);
            return null;
        }
        // Get summary from AI provider
        const result = await getAISummary(text);
        if (!result) {
            logger_1.logger.warn(`Failed to get AI summary for document ${documentId}`);
            return null;
        }
        // Save to cache if enabled
        if (config.ai.cacheResults) {
            await db.query(`INSERT INTO ai_summaries (document_id, summary, key_points, created_at) 
                 VALUES (?, ?, ?, ?)`, [documentId, result.summary, JSON.stringify(result.keyPoints), new Date()]);
        }
        logger_1.logger.info(`Document ${documentId} summarized in ${perfEnd()}ms`);
        return {
            ...result,
            timestamp: new Date()
        };
    }
    catch (error) {
        logger_1.logger.error(`Error summarizing document ${documentId}:`, error);
        return null;
    }
}
/**
 * Analyze a document for insights
 */
async function analyzeDocument(documentId) {
    const config = (0, config_1.loadConfig)();
    if (config.ai.provider === 'none' || !config.ai.analysisEnabled) {
        logger_1.logger.warn('Document analysis is disabled');
        return null;
    }
    const perfEnd = logger_1.performance.start(`analyze-doc-${documentId}`);
    const db = (0, connection_1.getConnection)();
    try {
        // Check cache first if enabled
        if (config.ai.cacheResults) {
            const cachedResults = await db.query('SELECT * FROM ai_analyses WHERE document_id = ? AND created_at > ?', [documentId, new Date(Date.now() - config.ai.cacheTTL * 1000)]);
            if (cachedResults && cachedResults.length > 0) {
                logger_1.logger.info(`Using cached analysis for document ${documentId}`);
                const result = cachedResults[0];
                return {
                    topics: JSON.parse(result.topics),
                    entities: JSON.parse(result.entities),
                    sentiment: JSON.parse(result.sentiment),
                    complexity: JSON.parse(result.complexity),
                    timestamp: result.created_at
                };
            }
        }
        // Get document text
        const text = await getDocumentText(documentId);
        if (!text) {
            logger_1.logger.warn(`No text found for document ${documentId}`);
            return null;
        }
        // Get analysis from AI provider
        const result = await getAIAnalysis(text);
        if (!result) {
            logger_1.logger.warn(`Failed to get AI analysis for document ${documentId}`);
            return null;
        }
        // Save to cache if enabled
        if (config.ai.cacheResults) {
            await db.query(`INSERT INTO ai_analyses (document_id, topics, entities, sentiment, complexity, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?)`, [
                documentId,
                JSON.stringify(result.topics),
                JSON.stringify(result.entities),
                JSON.stringify(result.sentiment),
                JSON.stringify(result.complexity),
                new Date()
            ]);
        }
        logger_1.logger.info(`Document ${documentId} analyzed in ${perfEnd()}ms`);
        return {
            ...result,
            timestamp: new Date()
        };
    }
    catch (error) {
        logger_1.logger.error(`Error analyzing document ${documentId}:`, error);
        return null;
    }
}
/**
 * Generate tags for a document
 */
async function generateDocumentTags(documentId) {
    const config = (0, config_1.loadConfig)();
    if (config.ai.provider === 'none' || !config.ai.taggingEnabled) {
        logger_1.logger.warn('Document tagging is disabled');
        return null;
    }
    const perfEnd = logger_1.performance.start(`tag-doc-${documentId}`);
    const db = (0, connection_1.getConnection)();
    try {
        // Check cache first if enabled
        if (config.ai.cacheResults) {
            const cachedResults = await db.query('SELECT * FROM ai_tags WHERE document_id = ? AND created_at > ?', [documentId, new Date(Date.now() - config.ai.cacheTTL * 1000)]);
            if (cachedResults && cachedResults.length > 0) {
                logger_1.logger.info(`Using cached tags for document ${documentId}`);
                return {
                    tags: JSON.parse(cachedResults[0].tags),
                    timestamp: cachedResults[0].created_at
                };
            }
        }
        // Get document text
        const text = await getDocumentText(documentId);
        if (!text) {
            logger_1.logger.warn(`No text found for document ${documentId}`);
            return null;
        }
        // Get tags from AI provider
        const tags = await getAITags(text);
        if (!tags || tags.length === 0) {
            logger_1.logger.warn(`Failed to get AI tags for document ${documentId}`);
            return null;
        }
        // Save to cache if enabled
        if (config.ai.cacheResults) {
            await db.query(`INSERT INTO ai_tags (document_id, tags, created_at) 
                 VALUES (?, ?, ?)`, [documentId, JSON.stringify(tags), new Date()]);
        }
        // Update document tags
        await db.query('UPDATE documents SET tags = ? WHERE id = ?', [JSON.stringify(tags), documentId]);
        logger_1.logger.info(`Document ${documentId} tagged in ${perfEnd()}ms with ${tags.length} tags`);
        return {
            tags,
            timestamp: new Date()
        };
    }
    catch (error) {
        logger_1.logger.error(`Error tagging document ${documentId}:`, error);
        return null;
    }
}
/**
 * Get text content of a document
 */
async function getDocumentText(documentId) {
    try {
        const db = (0, connection_1.getConnection)();
        const docs = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
        if (!docs || docs.length === 0) {
            return null;
        }
        const doc = docs[0];
        // Check if we have indexed text in our indexes
        const config = (0, config_1.loadConfig)();
        const indexDir = path_1.default.join(config.storage.path, 'indexes');
        const textFilePath = path_1.default.join(indexDir, `${documentId}.txt`);
        try {
            return await promises_1.default.readFile(textFilePath, 'utf8');
        }
        catch (error) {
            logger_1.logger.warn(`No indexed text found for document ${documentId}, fallback not implemented`);
            return null;
        }
    }
    catch (error) {
        logger_1.logger.error(`Error retrieving document text for ${documentId}:`, error);
        return null;
    }
}
/**
 * Get summary from AI provider
 */
async function getAISummary(text) {
    const config = (0, config_1.loadConfig)();
    // Ensure we're not exceeding API rate limits
    trackAPICall();
    // Truncate text if too long for the AI
    const truncatedText = (0, text_1.truncateText)(text, config.ai.maxTokens * 3);
    try {
        switch (config.ai.provider) {
            case 'openai':
                return await getOpenAISummary(truncatedText);
            case 'azure':
                return await getAzureOpenAISummary(truncatedText);
            case 'anthropic':
                return await getAnthropicSummary(truncatedText);
            case 'local':
                return await getLocalModelSummary(truncatedText);
            case 'granite':
                return await (0, graniteProvider_1.generateWithGranite)(truncatedText, config.ai.maxTokens);
            default:
                logger_1.logger.warn(`Unsupported AI provider: ${config.ai.provider}`);
                return null;
        }
    }
    catch (error) {
        logger_1.logger.error('Error getting AI summary:', error);
        return null;
    }
}
/**
 * Get analysis from AI provider
 */
async function getAIAnalysis(text) {
    const config = (0, config_1.loadConfig)();
    // Ensure we're not exceeding API rate limits
    trackAPICall();
    // Truncate text if too long for the AI
    const truncatedText = (0, text_1.truncateText)(text, config.ai.maxTokens * 3);
    try {
        switch (config.ai.provider) {
            case 'openai':
                return await getOpenAIAnalysis(truncatedText);
            case 'azure':
                return await getAzureOpenAIAnalysis(truncatedText);
            case 'anthropic':
                return await getAnthropicAnalysis(truncatedText);
            case 'local':
                return await getLocalModelAnalysis(truncatedText);
            default:
                logger_1.logger.warn(`Unsupported AI provider: ${config.ai.provider}`);
                return null;
        }
    }
    catch (error) {
        logger_1.logger.error('Error getting AI analysis:', error);
        return null;
    }
}
/**
 * Get tags from AI provider
 */
async function getAITags(text) {
    const config = (0, config_1.loadConfig)();
    // Ensure we're not exceeding API rate limits
    trackAPICall();
    // Truncate text if too long for the AI
    const truncatedText = (0, text_1.truncateText)(text, config.ai.maxTokens * 3);
    try {
        switch (config.ai.provider) {
            case 'openai':
                return await getOpenAITags(truncatedText);
            case 'azure':
                return await getAzureOpenAITags(truncatedText);
            case 'anthropic':
                return await getAnthropicTags(truncatedText);
            case 'local':
                return await getLocalModelTags(truncatedText);
            default:
                logger_1.logger.warn(`Unsupported AI provider: ${config.ai.provider}`);
                return null;
        }
    }
    catch (error) {
        logger_1.logger.error('Error getting AI tags:', error);
        return null;
    }
}
/**
 * Get summary using OpenAI
 */
async function getOpenAISummary(text) {
    const config = (0, config_1.loadConfig)();
    if (!config.ai.apiKey) {
        throw new Error('OpenAI API key not configured');
    }
    const openai = new openai_1.default({ apiKey: config.ai.apiKey });
    const response = await openai.chat.completions.create({
        model: config.ai.model || 'gpt-3.5-turbo',
        messages: [
            {
                role: 'system',
                content: 'You are a helpful assistant that summarizes documents. Provide a concise summary and key points.'
            },
            {
                role: 'user',
                content: `Please summarize the following document and provide 3-5 key points. Format your response in JSON with fields 'summary' and 'keyPoints' as an array.\n\nDocument content:\n${text}`
            }
        ],
        temperature: config.ai.temperature,
        max_tokens: config.ai.maxTokens,
        response_format: { type: 'json_object' }
    });
    const result = JSON.parse(response.choices[0].message.content || '{}');
    return {
        summary: result.summary || 'No summary generated',
        keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : []
    };
}
// Additional OpenAI functions for analysis and tagging
async function getOpenAIAnalysis(text) {
    // Implementation similar to getOpenAISummary but for analysis
    // This would return topics, entities, sentiment, and complexity analysis
    const config = (0, config_1.loadConfig)();
    const openai = new openai_1.default({ apiKey: config.ai.apiKey });
    const response = await openai.chat.completions.create({
        model: config.ai.model || 'gpt-3.5-turbo',
        messages: [
            {
                role: 'system',
                content: 'You are a document analysis assistant. Analyze the provided document and return structured insights.'
            },
            {
                role: 'user',
                content: `Analyze this document and provide: 
                1. Up to 5 main topics
                2. Key entities (people, organizations, locations) with their importance (0-10)
                3. Overall sentiment (score from -1 to 1, and label)
                4. Reading complexity (score from 0 to 1, and label)
                
                Format as JSON with 'topics' (array), 'entities' (array of objects with name, type, importance), 'sentiment' (object with score and label), and 'complexity' (object with score and label).
                
                Document: ${text}`
            }
        ],
        temperature: 0.3,
        max_tokens: config.ai.maxTokens,
        response_format: { type: 'json_object' }
    });
    const result = JSON.parse(response.choices[0].message.content || '{}');
    return {
        topics: result.topics || [],
        entities: result.entities || [],
        sentiment: result.sentiment || { score: 0, label: 'neutral' },
        complexity: result.complexity || { score: 0.5, label: 'moderate' },
        timestamp: new Date()
    };
}
async function getOpenAITags(text) {
    const config = (0, config_1.loadConfig)();
    const openai = new openai_1.default({ apiKey: config.ai.apiKey });
    const response = await openai.chat.completions.create({
        model: config.ai.model || 'gpt-3.5-turbo',
        messages: [
            {
                role: 'system',
                content: 'You are a document tagging assistant. Generate relevant tags for the provided document.'
            },
            {
                role: 'user',
                content: `Generate 5-10 relevant tags for this document. Return them as a JSON array of strings. Tags should be short (1-2 words) and descriptive.\n\nDocument: ${text}`
            }
        ],
        temperature: 0.3,
        max_tokens: 150,
        response_format: { type: 'json_object' }
    });
    const result = JSON.parse(response.choices[0].message.content || '{}');
    return Array.isArray(result.tags) ? result.tags : [];
}
// Additional implementations for other AI providers
// These are placeholders - actual implementations would follow similar patterns to the OpenAI functions
async function getAzureOpenAISummary(text) {
    // Similar to OpenAI but using Azure endpoint
    return { summary: 'Azure OpenAI summary placeholder', keyPoints: ['Point 1', 'Point 2'] };
}
async function getAzureOpenAIAnalysis(text) {
    // Placeholder
    return defaultAnalysisResult();
}
async function getAzureOpenAITags(text) {
    // Placeholder
    return ['azure', 'tag', 'placeholder'];
}
async function getAnthropicSummary(text) {
    const config = (0, config_1.loadConfig)();
    if (!config.ai.apiKey) {
        throw new Error('Anthropic API key not configured');
    }
    const anthropic = new sdk_1.default({ apiKey: config.ai.apiKey });
    const response = await anthropic.messages.create({
        model: config.ai.model || 'claude-3-sonnet-20240229',
        max_tokens: config.ai.maxTokens,
        system: 'You are a helpful assistant that summarizes documents. Provide a concise summary and key points.',
        messages: [
            {
                role: 'user',
                content: `Please summarize the following document and provide 3-5 key points. Format your response in JSON with fields 'summary' and 'keyPoints' as an array.\n\nDocument content:\n${text}`
            }
        ]
    });
    try {
        // Try to extract JSON from the response
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : '{}';
        const result = JSON.parse(jsonStr);
        return {
            summary: result.summary || 'No summary generated',
            keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : []
        };
    }
    catch (e) {
        logger_1.logger.error('Error parsing Anthropic response:', e);
        return {
            summary: 'Error parsing AI response',
            keyPoints: []
        };
    }
}
async function getAnthropicAnalysis(text) {
    // Placeholder
    return defaultAnalysisResult();
}
async function getAnthropicTags(text) {
    // Placeholder
    return ['anthropic', 'tag', 'placeholder'];
}
/**
 * Get summary using local model
 */
async function getLocalModelSummary(text) {
    // Call the local model provider
    const result = await (0, localProvider_1.getLocalSummary)(text);
    return {
        summary: result.summary,
        keyPoints: result.keyPoints
    };
}
/**
 * Get analysis using local model
 */
async function getLocalModelAnalysis(text) {
    // Call the local model provider
    return await (0, localProvider_1.getLocalAnalysis)(text);
}
/**
 * Get tags using local model
 */
async function getLocalModelTags(text) {
    // Call the local model provider
    return await (0, localProvider_1.getLocalTags)(text);
}
// Helper functions
function defaultAnalysisResult() {
    return {
        topics: ['Sample Topic 1', 'Sample Topic 2'],
        entities: [
            { name: 'Example Person', type: 'person', importance: 8 },
            { name: 'Example Organization', type: 'organization', importance: 6 }
        ],
        sentiment: { score: 0, label: 'neutral' },
        complexity: { score: 0.5, label: 'moderate' },
        timestamp: new Date()
    };
}
function trackAPICall() {
    // Track API calls and ensure we're not exceeding rate limits
    apiCallsThisHour++;
    // Reset counter if it's been more than an hour
    if (Date.now() - lastResetTime > 60 * 60 * 1000) {
        apiCallsThisHour = 1;
        lastResetTime = Date.now();
    }
    // Log every 10 calls
    if (apiCallsThisHour % 10 === 0) {
        logger_1.logger.info(`AI API calls this hour: ${apiCallsThisHour}`);
    }
    // If we're making too many calls, add a slight delay to avoid rate limits
    if (apiCallsThisHour > 100) {
        const delay = Math.min(apiCallsThisHour - 100, 2000); // Max 2 second delay
        return new Promise(resolve => setTimeout(resolve, delay));
    }
}
/**
 * Generate a summary or response using the configured AI provider
 */
async function summarizeDocument(prompt, maxTokens = 1000) {
    const config = (0, config_1.loadConfig)();
    if (!config.ai || !config.ai.provider || config.ai.provider === 'none') {
        throw new Error('AI provider not configured');
    }
    try {
        switch (config.ai.provider) {
            case 'granite':
                return await (0, graniteProvider_1.generateWithGranite)(prompt, maxTokens);
            case 'openai':
            // ...existing code...
            // ...other cases...
            default:
                throw new Error(`Unsupported AI provider: ${config.ai.provider}`);
        }
    }
    catch (error) {
        // ...existing code...
    }
}
/**
 * Generate document embeddings using the configured AI provider
 */
async function generateEmbeddings(text) {
    const config = (0, config_1.loadConfig)();
    if (!config.ai || !config.ai.provider || config.ai.provider === 'none') {
        throw new Error('AI provider not configured');
    }
    try {
        switch (config.ai.provider) {
            case 'granite':
                return await (0, graniteProvider_1.getGraniteEmbedding)(text);
            case 'openai':
            // ...existing code...
            // ...other cases...
            default:
                throw new Error(`Unsupported AI provider for embeddings: ${config.ai.provider}`);
        }
    }
    catch (error) {
        // ...existing code...
    }
}
