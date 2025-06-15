"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.briefAssistantRouter = void 0;
const express_1 = __importDefault(require("express"));
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
const briefAssistant_1 = require("../ai/briefAssistant");
const config_1 = require("../config/config");
exports.briefAssistantRouter = express_1.default.Router();
// Get available brief types and sections
exports.briefAssistantRouter.get('/options', auth_1.isAuthenticated, (req, res) => {
    try {
        const options = {
            briefTypes: briefAssistant_1.BRIEF_TYPES,
            sectionTypes: briefAssistant_1.BRIEF_SECTIONS
        };
        res.json(options);
    }
    catch (error) {
        logger_1.logger.error('Error fetching brief assistant options:', error);
        res.status(500).json({ error: 'Failed to fetch options' });
    }
});
// Generate a complete document
exports.briefAssistantRouter.post('/generate-document', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('generate-document-api');
        const userId = req.user.id;
        const config = (0, config_1.loadConfig)();
        // Check if AI is enabled
        if (!config.ai?.provider || config.ai.provider === 'none') {
            return res.status(400).json({
                error: 'AI provider not configured',
                message: 'Please enable and configure an AI provider in your settings.'
            });
        }
        const { documentType, caseDescription, relevantFacts, legalIssues, clientGoals, jurisdiction, tone, existingDocumentIds, includeAuthorities } = req.body;
        // Validate required fields
        if (!documentType || !caseDescription) {
            return res.status(400).json({ error: 'Document type and case description are required' });
        }
        // Generate the document
        const result = await (0, briefAssistant_1.generateDocument)({
            documentType,
            caseDescription,
            relevantFacts,
            legalIssues,
            clientGoals,
            jurisdiction,
            tone,
            existingDocumentIds,
            includeAuthorities
        }, userId);
        logger_1.logger.info(`Document generation API completed in ${perfEnd()}ms`);
        res.json(result);
    }
    catch (error) {
        logger_1.logger.error('Error in generate document API:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate document',
        });
    }
});
// Generate a specific section
exports.briefAssistantRouter.post('/generate-section', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('generate-section-api');
        const userId = req.user.id;
        const config = (0, config_1.loadConfig)();
        // Check if AI is enabled
        if (!config.ai?.provider || config.ai.provider === 'none') {
            return res.status(400).json({
                error: 'AI provider not configured',
                message: 'Please enable and configure an AI provider in your settings.'
            });
        }
        const { briefType, sectionType, caseDescription, relevantFacts, existingContent, tone, length, keyPoints, jurisdiction } = req.body;
        // Validate required fields
        if (!briefType || !sectionType || !caseDescription) {
            return res.status(400).json({ error: 'Brief type, section type, and case description are required' });
        }
        // Generate the section
        const result = await (0, briefAssistant_1.generateSection)({
            briefType,
            sectionType,
            caseDescription,
            relevantFacts,
            existingContent,
            tone: tone,
            length: length,
            keyPoints,
            jurisdiction
        }, userId);
        logger_1.logger.info(`Section generation API completed in ${perfEnd()}ms`);
        res.json(result);
    }
    catch (error) {
        logger_1.logger.error('Error in generate section API:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate section',
        });
    }
});
// Save generated content as document
exports.briefAssistantRouter.post('/save-as-document', auth_1.isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const { title, content, folderId } = req.body;
        // Validate required fields
        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required' });
        }
        // Import document creation functionality
        const { createDocumentFromText } = await Promise.resolve().then(() => __importStar(require('../api/documents')));
        // Create the document
        const documentId = await createDocumentFromText(title, content, userId, folderId);
        res.json({
            success: true,
            documentId,
            message: 'Document created successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Error saving generated content as document:', error);
        res.status(500).json({ error: 'Failed to create document' });
    }
});
