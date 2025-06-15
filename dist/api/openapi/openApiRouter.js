"use strict";
/**
 * OpenAPI Gateway Router
 * Provides a fully documented REST API for programmatic access to Documind
 */
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
exports.openApiRouter = void 0;
const express_1 = __importDefault(require("express"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const specGenerator_1 = require("./specGenerator");
const rbac_1 = require("../../auth/rbac");
const rbac_2 = require("../../auth/rbac");
const apiAuth_1 = require("../../auth/apiAuth");
const auditLogger_1 = require("../../audit/auditLogger");
const logger_1 = require("../../utils/logger");
exports.openApiRouter = express_1.default.Router();
// Generate OpenAPI specification
const openApiSpec = (0, specGenerator_1.generateSpec)();
// Serve Swagger UI documentation
exports.openApiRouter.use('/docs', swagger_ui_express_1.default.serve);
exports.openApiRouter.get('/docs', swagger_ui_express_1.default.setup(openApiSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Documind API Documentation',
    customfavIcon: '/favicon.ico'
}));
// Serve OpenAPI spec as JSON
exports.openApiRouter.get('/spec', (req, res) => {
    res.json(openApiSpec);
});
// API Health Check
exports.openApiRouter.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
    });
});
// API Version endpoint
exports.openApiRouter.get('/version', (req, res) => {
    res.json({
        version: process.env.npm_package_version || '1.0.0',
        apiVersion: 'v1',
        build: process.env.BUILD_ID || 'development'
    });
});
// Document Operations
// GET /api/v1/documents - List documents
exports.openApiRouter.get('/documents', apiAuth_1.apiKeyAuth, async (req, res) => {
    try {
        const userId = req.user?.id;
        // Query params for filtering
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const folder = req.query.folder ? parseInt(req.query.folder) : undefined;
        const search = req.query.search;
        const type = req.query.type;
        const sortBy = req.query.sortBy || 'uploaded_at';
        const sortDir = req.query.sortDir || 'desc';
        // Import and use the documents module
        const { getDocuments } = await Promise.resolve().then(() => __importStar(require('../documents')));
        const documents = await getDocuments({
            userId,
            limit,
            offset,
            folderId: folder,
            searchQuery: search,
            documentType: type,
            sortBy,
            sortDir
        });
        // Audit the request
        (0, auditLogger_1.logAuditEvent)({
            userId,
            category: auditLogger_1.AuditCategory.API,
            action: auditLogger_1.AuditAction.API_REQUEST,
            resourceType: 'documents',
            details: { method: 'GET', params: req.query },
            severity: 'info'
        });
        res.json({
            data: documents.items,
            pagination: {
                total: documents.total,
                limit,
                offset,
                hasMore: offset + documents.items.length < documents.total
            }
        });
    }
    catch (error) {
        logger_1.logger.error('API error in GET /documents:', error);
        res.status(500).json({ error: 'Failed to retrieve documents' });
    }
});
// GET /api/v1/documents/:id - Get document details
exports.openApiRouter.get('/documents/:id', apiAuth_1.apiKeyAuth, async (req, res) => {
    try {
        const userId = req.user?.id;
        const documentId = parseInt(req.params.id);
        // Import and use the document module
        const { getDocument } = await Promise.resolve().then(() => __importStar(require('../documents')));
        const document = await getDocument(documentId, userId);
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        // Audit the request
        (0, auditLogger_1.logAuditEvent)({
            userId,
            category: auditLogger_1.AuditCategory.API,
            action: auditLogger_1.AuditAction.API_REQUEST,
            resourceType: 'documents',
            resourceId: documentId,
            details: { method: 'GET' },
            severity: 'info'
        });
        res.json({ data: document });
    }
    catch (error) {
        logger_1.logger.error(`API error in GET /documents/${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to retrieve document' });
    }
});
// POST /api/v1/documents - Upload document
exports.openApiRouter.post('/documents', apiAuth_1.apiKeyAuth, (0, rbac_1.requirePermission)(rbac_2.PermissionType.CREATE, rbac_2.ResourceType.DOCUMENT), async (req, res) => {
    try {
        // Handle document upload here
        // This would typically involve multipart handling
        res.status(501).json({ error: 'Document upload via API is not yet implemented' });
    }
    catch (error) {
        logger_1.logger.error('API error in POST /documents:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});
// Rate limiting middleware
exports.openApiRouter.use((req, res, next) => {
    // Apply rate limiting logic based on user or API key
    // This would typically check a counter in Redis or another data store
    next();
});
// Error handler
exports.openApiRouter.use((err, req, res, next) => {
    logger_1.logger.error('API Gateway error:', err);
    // Standardized error response
    res.status(err.status || 500).json({
        error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message || 'An unexpected error occurred',
            details: process.env.NODE_ENV === 'production' ? undefined : err.stack
        }
    });
});
exports.default = exports.openApiRouter;
