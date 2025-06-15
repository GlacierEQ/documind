"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config/config");
const auth_1 = require("../auth/auth");
const connection_1 = require("../database/connection");
const indexer_1 = require("../search/indexer");
const storage_1 = require("../storage/storage");
const logger_1 = require("../utils/logger");
const mindmap_1 = require("./mindmap");
const documentEditor_1 = require("./documentEditor");
const advancedSearch_1 = require("./advancedSearch");
const clustering_1 = require("./clustering");
const caseSummary_1 = require("./caseSummary");
const legalResearch_1 = require("./legalResearch");
const briefAssistant_1 = require("./briefAssistant");
// Load configuration
const config = (0, config_1.loadConfig)();
// Create router
exports.apiRouter = express_1.default.Router();
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path_1.default.join(config.storage.path, 'uploads');
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: config.document.maxFileSize * 1024 * 1024 // Convert MB to bytes
    },
    fileFilter: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase().substring(1);
        if (config.document.allowedTypes.includes(ext)) {
            cb(null, true);
        }
        else {
            cb(new Error(`File type not allowed. Allowed types: ${config.document.allowedTypes.join(', ')}`));
        }
    }
});
// Authentication endpoints
exports.apiRouter.post('/auth/login', passport_1.default.authenticate('local'), (req, res) => {
    res.json({ user: req.user });
});
exports.apiRouter.post('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.json({ success: true });
    });
});
exports.apiRouter.get('/auth/status', (req, res) => {
    res.json({
        isAuthenticated: req.isAuthenticated(),
        user: req.user
    });
});
// Document endpoints
exports.apiRouter.post('/documents', auth_1.isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const db = (0, connection_1.getConnection)();
        const user = req.user;
        // Insert document record
        const doc = {
            name: req.body.name || req.file.originalname,
            description: req.body.description || '',
            path: req.file.path,
            size: req.file.size,
            mimeType: req.file.mimetype,
            uploadedBy: user.id,
            uploadedAt: new Date(),
            tags: req.body.tags ? JSON.stringify(req.body.tags.split(',')) : '[]'
        };
        const result = await db.query(`INSERT INTO documents 
      (name, description, path, size, mime_type, uploaded_by, uploaded_at, tags) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            doc.name,
            doc.description,
            doc.path,
            doc.size,
            doc.mimeType,
            doc.uploadedBy,
            doc.uploadedAt,
            doc.tags
        ]);
        const docId = result.lastID || result.insertId;
        // Queue for indexing
        // This would typically be handled by a background worker
        // For simplicity, we're just calling the indexer directly
        (0, indexer_2.indexDocument)(docId, doc.path, doc.name, doc.mimeType);
        res.json({
            success: true,
            document: {
                id: docId,
                ...doc
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Error uploading document:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});
exports.apiRouter.get('/documents', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        const query = `
      SELECT d.*, u.username as uploader_username 
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      ORDER BY d.uploaded_at DESC
      LIMIT ? OFFSET ?
    `;
        const limit = parseInt(req.query.limit || '20');
        const offset = parseInt(req.query.offset || '0');
        const documents = await db.query(query, [limit, offset]);
        // Get total count
        const countResult = await db.query('SELECT COUNT(*) as count FROM documents');
        const totalCount = countResult[0].count;
        res.json({
            documents,
            pagination: {
                total: totalCount,
                limit,
                offset
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});
exports.apiRouter.get('/documents/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        const documents = await db.query(`SELECT d.*, u.username as uploader_username 
       FROM documents d
       JOIN users u ON d.uploaded_by = u.id
       WHERE d.id = ?`, [req.params.id]);
        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        res.json(documents[0]);
    }
    catch (error) {
        logger_1.logger.error(`Error fetching document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});
exports.apiRouter.get('/documents/:id/download', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        const documents = await db.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        const document = documents[0];
        if (!fs_1.default.existsSync(document.path)) {
            return res.status(404).json({ error: 'Document file not found' });
        }
        res.download(document.path, document.name);
    }
    catch (error) {
        logger_1.logger.error(`Error downloading document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to download document' });
    }
});
exports.apiRouter.delete('/documents/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        // Check if document exists
        const documents = await db.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);
        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        const document = documents[0];
        // Check if user is authorized (admin or document owner)
        const user = req.user;
        if (user.role !== 'admin' && user.id !== document.uploaded_by) {
            return res.status(403).json({ error: 'Not authorized to delete this document' });
        }
        // Delete from database
        await db.query('DELETE FROM documents WHERE id = ?', [req.params.id]);
        // Delete from storage
        await (0, storage_1.deleteDocument)(document.path);
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error(`Error deleting document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});
exports.apiRouter.get('/search', auth_1.isAuthenticated, async (req, res) => {
    try {
        const query = req.query.q;
        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: 'Search query is required' });
        }
        const results = await (0, indexer_1.searchDocuments)(query);
        res.json({ results });
    }
    catch (error) {
        logger_1.logger.error('Error searching documents:', error);
        res.status(500).json({ error: 'Failed to search documents' });
    }
});
// Admin endpoints
exports.apiRouter.get('/admin/stats', auth_1.isAdmin, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        // Get document stats
        const documentStats = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(size) as totalSize,
        COUNT(DISTINCT uploaded_by) as uniqueUploaders,
        MAX(uploaded_at) as lastUpload
      FROM documents
    `);
        // Get user stats
        const userStats = await db.query(`
      SELECT COUNT(*) as total FROM users
    `);
        res.json({
            documents: {
                count: documentStats[0].total || 0,
                totalSize: documentStats[0].totalSize || 0,
                uniqueUploaders: documentStats[0].uniqueUploaders || 0,
                lastUpload: documentStats[0].lastUpload || null
            },
            users: {
                count: userStats[0].total || 0
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});
// Import passport here to avoid circular dependency
const passport_1 = __importDefault(require("passport"));
const indexer_2 = require("../search/indexer");
const folders_1 = require("./folders");
const users_1 = require("./users");
const admin_1 = require("./admin");
const shares_1 = require("./shares");
const editors_1 = require("./editors");
const settings_1 = require("./settings");
// Mount additional routers
exports.apiRouter.use('/folders', folders_1.folderRouter);
exports.apiRouter.use('/users', users_1.userRouter);
exports.apiRouter.use('/admin', admin_1.adminRouter);
exports.apiRouter.use('/shares', shares_1.sharesRouter);
exports.apiRouter.use('/editors', editors_1.editorsRouter);
exports.apiRouter.use('/settings', settings_1.settingsRouter);
exports.apiRouter.use('/mindmap', mindmap_1.mindMapRouter);
exports.apiRouter.use('/document-editor', documentEditor_1.documentEditorRouter);
exports.apiRouter.use('/advanced-search', advancedSearch_1.advancedSearchRouter);
exports.apiRouter.use('/clustering', clustering_1.clusteringRouter);
exports.apiRouter.use('/case-summary', caseSummary_1.caseSummaryRouter);
exports.apiRouter.use('/legal-research', legalResearch_1.legalResearchRouter);
exports.apiRouter.use('/brief-assistant', briefAssistant_1.briefAssistantRouter);
