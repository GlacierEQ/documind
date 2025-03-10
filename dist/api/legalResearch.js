"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.legalResearchRouter = void 0;
const express_1 = __importDefault(require("express"));
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
const legalDatabases_1 = require("../integration/legalDatabases");
const config_1 = require("../config/config");
const connection_1 = require("../database/connection");
exports.legalResearchRouter = express_1.default.Router();
// Search legal databases
exports.legalResearchRouter.post('/search', auth_1.isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const config = (0, config_1.loadConfig)();
        // Check if legal database integration is configured
        if (!config.integration?.westlaw?.apiKey && !config.integration?.lexisnexis?.apiKey) {
            return res.status(400).json({
                error: 'Legal database integration not configured',
                message: 'Please configure Westlaw or LexisNexis API integration in your settings.'
            });
        }
        const { query, source, jurisdiction, dateFrom, dateTo, courtLevel, documentTypes, page, pageSize } = req.body;
        // Basic validation
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return res.status(400).json({ error: 'Search query is required' });
        }
        // Set up search options
        const searchOptions = {
            query: query.trim(),
            source: source || 'all',
            page: page || 1,
            pageSize: pageSize || 10
        };
        // Add optional filters
        if (jurisdiction)
            searchOptions.jurisdiction = jurisdiction;
        if (dateFrom)
            searchOptions.dateFrom = new Date(dateFrom);
        if (dateTo)
            searchOptions.dateTo = new Date(dateTo);
        if (courtLevel)
            searchOptions.courtLevel = courtLevel;
        if (documentTypes && Array.isArray(documentTypes)) {
            searchOptions.documentTypes = documentTypes;
        }
        // Perform search
        const results = await (0, legalDatabases_1.searchLegalDatabases)(searchOptions, userId);
        res.json(results);
    }
    catch (error) {
        logger_1.logger.error('Error in legal database search API:', error);
        res.status(500).json({ error: 'Failed to search legal databases' });
    }
});
// Get document from legal database
exports.legalResearchRouter.get('/document/:source/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const { source, id } = req.params;
        const config = (0, config_1.loadConfig)();
        // Validate source
        if (source !== 'westlaw' && source !== 'lexisnexis') {
            return res.status(400).json({ error: 'Invalid source. Must be "westlaw" or "lexisnexis"' });
        }
        // Check if the requested source is configured
        if ((source === 'westlaw' && !config.integration?.westlaw?.apiKey) ||
            (source === 'lexisnexis' && !config.integration?.lexisnexis?.apiKey)) {
            return res.status(400).json({
                error: `${source} integration not configured`,
                message: `Please configure ${source} API integration in your settings.`
            });
        }
        // Get the document
        const document = await (0, legalDatabases_1.getLegalDocument)(id, source, userId);
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        res.json({ document });
    }
    catch (error) {
        logger_1.logger.error('Error retrieving legal document:', error);
        res.status(500).json({ error: 'Failed to retrieve legal document' });
    }
});
// Add legal reference to a document
exports.legalResearchRouter.post('/references/add', auth_1.isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const { documentId, externalId, source, citation, context } = req.body;
        // Basic validation
        if (!documentId) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        if (!externalId || !source) {
            return res.status(400).json({ error: 'External document ID and source are required' });
        }
        if (!citation) {
            return res.status(400).json({ error: 'Citation is required' });
        }
        // Validate source
        if (source !== 'westlaw' && source !== 'lexisnexis') {
            return res.status(400).json({ error: 'Invalid source. Must be "westlaw" or "lexisnexis"' });
        }
        // Check if user has access to the document
        const db = (0, connection_1.getConnection)();
        const docs = await db.query(`SELECT d.id FROM documents d
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares WHERE shared_with = ? AND permission = 'edit'
         )
       )`, [documentId, userId, userId]);
        if (!docs || docs.length === 0) {
            return res.status(403).json({ error: 'Access denied to document' });
        }
        // Add the reference
        const success = await (0, legalDatabases_1.addLegalReference)(documentId, externalId, source, citation, context || '', userId);
        if (!success) {
            return res.status(500).json({ error: 'Failed to add legal reference' });
        }
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error('Error adding legal reference:', error);
        res.status(500).json({ error: 'Failed to add legal reference' });
    }
});
// Get legal references for a document
exports.legalResearchRouter.get('/references/:documentId', auth_1.isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const documentId = parseInt(req.params.documentId);
        // Check if user has access to the document
        const db = (0, connection_1.getConnection)();
        const docs = await db.query(`SELECT d.id FROM documents d
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares WHERE shared_with = ?
         )
       )`, [documentId, userId, userId]);
        if (!docs || docs.length === 0) {
            return res.status(403).json({ error: 'Access denied to document' });
        }
        // Get references
        const references = await (0, legalDatabases_1.getDocumentLegalReferences)(documentId);
        res.json({ references });
    }
    catch (error) {
        logger_1.logger.error('Error getting legal references:', error);
        res.status(500).json({ error: 'Failed to get legal references' });
    }
});
// Extract citations from text
exports.legalResearchRouter.post('/extract-citations', auth_1.isAuthenticated, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }
        const citations = (0, legalDatabases_1.extractCitations)(text);
        res.json({ citations });
    }
    catch (error) {
        logger_1.logger.error('Error extracting citations:', error);
        res.status(500).json({ error: 'Failed to extract citations' });
    }
});
