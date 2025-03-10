"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.editorsRouter = void 0;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("../auth/auth");
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const editors_1 = require("../config/editors");
const config_1 = require("../config/config");
exports.editorsRouter = express_1.default.Router();
// Get available editors for a specific document
exports.editorsRouter.get('/document/:id/editors', auth_1.isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const db = (0, connection_1.getConnection)();
        // Get document details
        const docs = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        const doc = docs[0];
        const fileExt = path_1.default.extname(doc.name);
        // Get suitable editors for this file type
        const editors = (0, editors_1.getEditorsForFileType)(fileExt);
        res.json({ editors });
    }
    catch (error) {
        logger_1.logger.error(`Error getting editors for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to get document editors' });
    }
});
// Generate a URL to open document in external editor
exports.editorsRouter.get('/document/:id/edit/:editorId', auth_1.isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const editorId = req.params.editorId;
        const config = (0, config_1.loadConfig)();
        const db = (0, connection_1.getConnection)();
        // Get document details
        const docs = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        const doc = docs[0];
        const fileExt = path_1.default.extname(doc.name);
        // Get suitable editors for this file type
        const editors = (0, editors_1.getEditorsForFileType)(fileExt);
        const editor = editors.find(e => e.id === editorId);
        if (!editor) {
            return res.status(404).json({ error: 'Editor not found or not compatible with this document' });
        }
        // Generate direct file URL
        let fileUrl = '';
        if (editor.isDesktopApp) {
            // For desktop apps, use WebDAV URL if WebDAV is enabled
            if (config.webdav?.enabled) {
                const webdavHost = config.webdav.externalUrl || `http://localhost:${config.webdav.port || 1900}`;
                fileUrl = `${webdavHost}/document-${documentId}`;
            }
            else {
                // Fall back to local file path
                fileUrl = doc.path;
            }
        }
        else {
            // For web apps, generate a secure, time-limited download URL
            const baseUrl = config.server.externalUrl || `http://localhost:${config.server.port}`;
            fileUrl = `${baseUrl}/api/documents/${documentId}/download`;
        }
        // Generate editor launch URL
        const editorUrl = (0, editors_1.generateEditorUrl)(editor, doc.path, fileUrl, documentId);
        // Log the editing activity
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [
            req.user.id,
            'view',
            'document',
            documentId,
            `Opened document in ${editor.name}`,
            new Date()
        ]);
        res.json({
            editorUrl,
            editor: editor.name,
            documentName: doc.name
        });
    }
    catch (error) {
        logger_1.logger.error(`Error generating editor URL for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to generate editor URL' });
    }
});
