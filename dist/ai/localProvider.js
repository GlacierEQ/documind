"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalModelType = void 0;
exports.getLocalSummary = getLocalSummary;
exports.getLocalAnalysis = getLocalAnalysis;
exports.getLocalTags = getLocalTags;
const child_process_1 = require("child_process");
const util_1 = require("util");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const os_1 = __importDefault(require("os"));
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Interface for supported local model types
var LocalModelType;
(function (LocalModelType) {
    LocalModelType["DeepSeek"] = "deepseek";
    LocalModelType["Llama"] = "llama";
})(LocalModelType || (exports.LocalModelType = LocalModelType = {}));
// Function to run Python script with retries
async function runPythonScript(args, retries = 2) {
    const config = (0, config_1.loadConfig)();
    const pythonPath = config.ai.localModelConfig?.pythonPath || 'python';
    const scriptDir = path_1.default.join(__dirname, 'python');
    const scriptPath = path_1.default.join(scriptDir, 'deepseek_service.py');
    let tempInputFile = '';
    let tempOutputFile = '';
    try {
        // Create temporary files
        const tempDir = os_1.default.tmpdir();
        tempInputFile = path_1.default.join(tempDir, `documind_input_${(0, uuid_1.v4)()}.txt`);
        tempOutputFile = path_1.default.join(tempDir, `documind_output_${(0, uuid_1.v4)()}.json`);
        // Find and extract text content argument index
        const textIndex = args.indexOf('--input') + 1;
        const textContent = args[textIndex];
        // Write text to temp file
        await promises_1.default.writeFile(tempInputFile, textContent);
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
                logger_1.logger.debug(`Running Python command (attempt ${attempt + 1}): ${command}`);
                const { stdout, stderr } = await execAsync(command);
                if (stderr) {
                    logger_1.logger.debug(`Python stderr: ${stderr}`);
                }
                // Read output JSON file
                const output = await promises_1.default.readFile(tempOutputFile, 'utf8');
                return JSON.parse(output);
            }
            catch (err) {
                error = err;
                logger_1.logger.error(`Error running Python script (attempt ${attempt + 1}):`, err);
                attempt++;
                if (attempt <= retries) {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }
        throw error;
    }
    finally {
        // Clean up temp files
        if (tempInputFile) {
            try {
                await promises_1.default.unlink(tempInputFile);
            }
            catch (e) {
                logger_1.logger.debug(`Failed to delete temp input file: ${e}`);
            }
        }
        if (tempOutputFile) {
            try {
                await promises_1.default.unlink(tempOutputFile);
            }
            catch (e) {
                logger_1.logger.debug(`Failed to delete temp output file: ${e}`);
            }
        }
    }
}
/**
 * Get summary using a local model
 */
async function getLocalSummary(text) {
    const config = (0, config_1.loadConfig)();
    const modelType = config.ai.localModelConfig?.modelType || LocalModelType.DeepSeek;
    const modelName = config.ai.localModelConfig?.modelPath || '';
    const perfEnd = logger_1.performance.start('local-model-summary');
    try {
        const args = [
            '--operation', 'summarize',
            '--input', text
        ];
        if (modelName) {
            args.push('--model', modelName);
        }
        const result = await runPythonScript(args);
        logger_1.logger.debug(`Local model summary generated in ${perfEnd()}ms`);
        return {
            summary: result.summary || 'No summary generated',
            keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : [],
            timestamp: new Date()
        };
    }
    catch (error) {
        logger_1.logger.error('Error getting local model summary:', error);
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
async function getLocalAnalysis(text) {
    const config = (0, config_1.loadConfig)();
    const modelType = config.ai.localModelConfig?.modelType || LocalModelType.DeepSeek;
    const modelName = config.ai.localModelConfig?.modelPath || '';
    const perfEnd = logger_1.performance.start('local-model-analysis');
    try {
        const args = [
            '--operation', 'analyze',
            '--input', text
        ];
        if (modelName) {
            args.push('--model', modelName);
        }
        const result = await runPythonScript(args);
        logger_1.logger.debug(`Local model analysis generated in ${perfEnd()}ms`);
        return {
            topics: result.topics || [],
            entities: result.entities || [],
            sentiment: result.sentiment || { score: 0, label: 'neutral' },
            complexity: result.complexity || { score: 0.5, label: 'moderate' },
            timestamp: new Date()
        };
    }
    catch (error) {
        logger_1.logger.error('Error getting local model analysis:', error);
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
async function getLocalTags(text) {
    const config = (0, config_1.loadConfig)();
    const modelType = config.ai.localModelConfig?.modelType || LocalModelType.DeepSeek;
    const modelName = config.ai.localModelConfig?.modelPath || '';
    const perfEnd = logger_1.performance.start('local-model-tags');
    try {
        const args = [
            '--operation', 'tags',
            '--input', text
        ];
        if (modelName) {
            args.push('--model', modelName);
        }
        const result = await runPythonScript(args);
        logger_1.logger.debug(`Local model tags generated in ${perfEnd()}ms`);
        return Array.isArray(result.tags) ? result.tags : [];
    }
    catch (error) {
        logger_1.logger.error('Error getting local model tags:', error);
        return ['error', 'processing', 'document'];
    }
}
