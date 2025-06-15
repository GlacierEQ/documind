"use strict";
/**
 * Granite AI Provider
 * Implementation for Granite AI language model integration
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWithGranite = generateWithGranite;
exports.getGraniteEmbedding = getGraniteEmbedding;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
/**
 * Process a prompt with Granite AI
 */
async function generateWithGranite(prompt, maxTokens = 1000) {
    const perfEnd = logger_1.performance.start('granite-generate');
    const config = (0, config_1.loadConfig)();
    if (!config.ai?.granite?.apiKey) {
        throw new Error('Granite API key not configured');
    }
    try {
        const response = await axios_1.default.post(config.ai.granite.endpoint || 'https://api.granite.io/v1/chat/completions', {
            model: config.ai.granite.model || 'granite-34b-instruct',
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: config.ai.granite.temperature || 0.2,
            max_tokens: maxTokens,
            top_p: config.ai.granite.topP || 0.9
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.ai.granite.apiKey}`
            }
        });
        const result = response.data.choices[0].message.content;
        logger_1.logger.info(`Granite AI response generated in ${perfEnd()}ms, ${result.length} chars`);
        return result;
    }
    catch (error) {
        logger_1.logger.error('Error generating response with Granite:', error);
        if (axios_1.default.isAxiosError(error) && error.response) {
            logger_1.logger.error(`Granite API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        }
        throw new Error(`Failed to generate response with Granite: ${error.message}`);
    }
}
/**
 * Get embeddings for a text using Granite
 */
async function getGraniteEmbedding(text) {
    const perfEnd = logger_1.performance.start('granite-embedding');
    const config = (0, config_1.loadConfig)();
    if (!config.ai?.granite?.apiKey) {
        throw new Error('Granite API key not configured');
    }
    try {
        const response = await axios_1.default.post(config.ai.granite.embeddingEndpoint || 'https://api.granite.io/v1/embeddings', {
            model: config.ai.granite.embeddingModel || 'granite-embedding',
            input: text
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.ai.granite.apiKey}`
            }
        });
        const embedding = response.data.data[0].embedding;
        logger_1.logger.info(`Granite embedding generated in ${perfEnd()}ms`);
        return embedding;
    }
    catch (error) {
        logger_1.logger.error('Error generating embedding with Granite:', error);
        throw new Error(`Failed to generate embedding: ${error.message}`);
    }
}
