/**
 * Granite AI Provider
 * Implementation for Granite AI language model integration
 */

import axios from 'axios';
import { logger, performance } from '../utils/logger';
import { loadConfig } from '../config/config';

/**
 * Process a prompt with Granite AI
 */
export async function generateWithGranite(prompt: string, maxTokens: number = 1000): Promise<string> {
  const perfEnd = performance.start('granite-generate');
  const config = loadConfig();
  
  if (!config.ai?.granite?.apiKey) {
    throw new Error('Granite API key not configured');
  }
  
  try {
    const response = await axios.post(
      config.ai.granite.endpoint || 'https://api.granite.io/v1/chat/completions',
      {
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
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ai.granite.apiKey}`
        }
      }
    );

    const result = response.data.choices[0].message.content;
    logger.info(`Granite AI response generated in ${perfEnd()}ms, ${result.length} chars`);
    
    return result;
  } catch (error) {
    logger.error('Error generating response with Granite:', error);
    
    if (axios.isAxiosError(error) && error.response) {
      logger.error(`Granite API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    
    throw new Error(`Failed to generate response with Granite: ${error.message}`);
  }
}

/**
 * Get embeddings for a text using Granite
 */
export async function getGraniteEmbedding(text: string): Promise<number[]> {
  const perfEnd = performance.start('granite-embedding');
  const config = loadConfig();
  
  if (!config.ai?.granite?.apiKey) {
    throw new Error('Granite API key not configured');
  }
  
  try {
    const response = await axios.post(
      config.ai.granite.embeddingEndpoint || 'https://api.granite.io/v1/embeddings',
      {
        model: config.ai.granite.embeddingModel || 'granite-embedding',
        input: text
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ai.granite.apiKey}`
        }
      }
    );

    const embedding = response.data.data[0].embedding;
    logger.info(`Granite embedding generated in ${perfEnd()}ms`);
    
    return embedding;
  } catch (error) {
    logger.error('Error generating embedding with Granite:', error);
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}
