import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { DocumentSummary, DocumentAnalysis } from './processor';
import { logger, performance } from '../utils/logger';
import { loadConfig } from '../config/config';

const execAsync = promisify(exec);

// Interface for supported local model types
export enum LocalModelType {
    DeepSeek = 'deepseek',
    Llama = 'llama'
}

// Function to run Python script with retries
async function runPythonScript(args: string[], retries = 2): Promise<any> {
    const config = loadConfig();
    const pythonPath = config.ai.localModelConfig?.pythonPath || 'python';
    const scriptDir = path.join(__dirname, 'python');
    const scriptPath = path.join(scriptDir, 'deepseek_service.py');

    let tempInputFile = '';
    let tempOutputFile = '';

    try {
        // Create temporary files
        const tempDir = os.tmpdir();
        tempInputFile = path.join(tempDir, `documind_input_${uuidv4()}.txt`);
        tempOutputFile = path.join(tempDir, `documind_output_${uuidv4()}.json`);

        // Find and extract text content argument index
        const textIndex = args.indexOf('--input') + 1;
        const textContent = args[textIndex];

        // Write text to temp file
        await fs.writeFile(tempInputFile, textContent);

        // Replace text content with temp file path
        args[textIndex] = tempInputFile;

        // Add output file
        args.push('--output');
        args.push(tempOutputFile);

        // Build command
        const command = `"${pythonPath}" "${scriptPath}" ${args.join(' ')}`;

        // Execute command with retries
        let attempt = 0;
        let error;

        while (attempt <= retries) {
            try {
                logger.debug(`Running Python command (attempt ${attempt + 1}): ${command}`);
                const { stdout, stderr } = await execAsync(command);

                if (stderr) {
                    logger.debug(`Python stderr: ${stderr}`);
                }

                // Read output JSON file
                const output = await fs.readFile(tempOutputFile, 'utf8');
                return JSON.parse(output);
            } catch (err) {
                error = err;
                logger.error(`Error running Python script (attempt ${attempt + 1}):`, err);
                attempt++;

                if (attempt <= retries) {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        throw error;
    } finally {
        // Clean up temp files
        if (tempInputFile) {
            try {
                await fs.unlink(tempInputFile);
            } catch (e) {
                logger.debug(`Failed to delete temp input file: ${e}`);
            }
        }

        if (tempOutputFile) {
            try {
                await fs.unlink(tempOutputFile);
            } catch (e) {
                logger.debug(`Failed to delete temp output file: ${e}`);
            }
        }
    }
}

/**
 * Get summary using a local model
 */
export async function getLocalSummary(text: string): Promise<DocumentSummary> {
    const config = loadConfig();
    const modelType = config.ai.localModelConfig?.modelType || LocalModelType.DeepSeek;
    const modelName = config.ai.localModelConfig?.modelPath || '';

    const perfEnd = performance.start('local-model-summary');

    try {
        const args = [
            '--operation', 'summarize',
            '--input', text
        ];

        if (modelName) {
            args.push('--model', modelName);
        }

        const result = await runPythonScript(args);

        logger.debug(`Local model summary generated in ${perfEnd()}ms`);

        return {
            summary: result.summary || 'No summary generated',
            keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : [],
            timestamp: new Date()
        };
    } catch (error) {
        logger.error('Error getting local model summary:', error);
        return {
            summary: 'Error generating summary with local model',
            keyPoints: [],
            timestamp: new Date()
        };
    }
}

/**
 * Get analysis using a local model
 */
export async function getLocalAnalysis(text: string): Promise<DocumentAnalysis> {
    const config = loadConfig();
    const modelType = config.ai.localModelConfig?.modelType || LocalModelType.DeepSeek;
    const modelName = config.ai.localModelConfig?.modelPath || '';

    const perfEnd = performance.start('local-model-analysis');

    try {
        const args = [
            '--operation', 'analyze',
            '--input', text
        ];

        if (modelName) {
            args.push('--model', modelName);
        }

        const result = await runPythonScript(args);

        logger.debug(`Local model analysis generated in ${perfEnd()}ms`);

        return {
            topics: result.topics || [],
            entities: result.entities || [],
            sentiment: result.sentiment || { score: 0, label: 'neutral' },
            complexity: result.complexity || { score: 0.5, label: 'moderate' },
            timestamp: new Date()
        };
    } catch (error) {
        logger.error('Error getting local model analysis:', error);
        return {
            topics: ['Error processing document'],
            entities: [],
            sentiment: { score: 0, label: 'neutral' },
            complexity: { score: 0.5, label: 'moderate' },
            timestamp: new Date()
        };
    }
}

/**
 * Get tags using a local model
 */
export async function getLocalTags(text: string): Promise<string[]> {
    const config = loadConfig();
    const modelType = config.ai.localModelConfig?.modelType || LocalModelType.DeepSeek;
    const modelName = config.ai.localModelConfig?.modelPath || '';

    const perfEnd = performance.start('local-model-tags');

    try {
        const args = [
            '--operation', 'tags',
            '--input', text
        ];

        if (modelName) {
            args.push('--model', modelName);
        }

        const result = await runPythonScript(args);

        logger.debug(`Local model tags generated in ${perfEnd()}ms`);

        return Array.isArray(result.tags) ? result.tags : [];
    } catch (error) {
        logger.error('Error getting local model tags:', error);
        return ['error', 'processing', 'document'];
    }
}
