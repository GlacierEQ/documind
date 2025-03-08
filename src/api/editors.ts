import express from 'express';
import path from 'path';
import { isAuthenticated } from '../auth/auth';
import { getConnection } from '../database/connection';
import { logger } from '../utils/logger';
import { getEditorsForFileType, generateEditorUrl } from '../config/editors';
import { loadConfig } from '../config/config';

export const editorsRouter = express.Router();

// Get available editors for a specific document
editorsRouter.get('/document/:id/editors', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const db = getConnection();

        // Get document details
        const docs = await db.query(
            'SELECT * FROM documents WHERE id = ?',
            [documentId]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const doc = docs[0];
        const fileExt = path.extname(doc.name);

        // Get suitable editors for this file type
        const editors = getEditorsForFileType(fileExt);

        res.json({ editors });
    } catch (error) {
        logger.error(`Error getting editors for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to get document editors' });
    }
});

// Generate a URL to open document in external editor
editorsRouter.get('/document/:id/edit/:editorId', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const editorId = req.params.editorId;
        const config = loadConfig();
        const db = getConnection();

        // Get document details
        const docs = await db.query(
            'SELECT * FROM documents WHERE id = ?',
            [documentId]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const doc = docs[0];
        const fileExt = path.extname(doc.name);

        // Get suitable editors for this file type
        const editors = getEditorsForFileType(fileExt);
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
            } else {
                // Fall back to local file path
                fileUrl = doc.path;
            }
        } else {
            // For web apps, generate a secure, time-limited download URL
            const baseUrl = config.server.externalUrl || `http://localhost:${config.server.port}`;
            fileUrl = `${baseUrl}/api/documents/${documentId}/download`;
        }

        // Generate editor launch URL
        const editorUrl = generateEditorUrl(editor, doc.path, fileUrl, documentId);

        // Log the editing activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                (req.user as any).id,
                'view',
                'document',
                documentId,
                `Opened document in ${editor.name}`,
                new Date()
            ]
        );

        res.json({
            editorUrl,
            editor: editor.name,
            documentName: doc.name
        });
    } catch (error) {
        logger.error(`Error generating editor URL for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to generate editor URL' });
    }
});
