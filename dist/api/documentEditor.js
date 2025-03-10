"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentEditorRouter = void 0;
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const auth_1 = require("../auth/auth");
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const entityExtractor_1 = require("../case/entityExtractor");
const deadlineTracker_1 = require("../case/deadlineTracker");
const knowledgeBase_1 = require("../case/knowledgeBase");
exports.documentEditorRouter = express_1.default.Router();
// Document templates path
const TEMPLATES_DIR = path_1.default.join(process.cwd(), 'data', 'templates');
// Configure temp upload storage
const tempStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path_1.default.join(process.cwd(), 'temp'));
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${(0, uuid_1.v4)()}-${file.originalname}`);
    }
});
const upload = (0, multer_1.default)({ storage: tempStorage });
// Create a new document
exports.documentEditorRouter.post('/create', auth_1.isAuthenticated, async (req, res) => {
    try {
        const { title, templateId, folderId, description } = req.body;
        const currentUser = req.user;
        const db = (0, connection_1.getConnection)();
        const config = (0, config_1.loadConfig)();
        if (!title) {
            return res.status(400).json({ error: 'Document title is required' });
        }
        // Create document entry in database
        let initialContent = '';
        // Use template if provided
        if (templateId) {
            try {
                const templates = await db.query('SELECT * FROM document_templates WHERE id = ?', [templateId]);
                if (templates && templates.length > 0) {
                    initialContent = templates[0].content;
                    // Replace template variables
                    initialContent = initialContent
                        .replace(/\{\{user\}\}/g, currentUser.username)
                        .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())
                        .replace(/\{\{time\}\}/g, new Date().toLocaleTimeString());
                }
            }
            catch (error) {
                logger_1.logger.warn('Error loading template:', error);
            }
        }
        // Create new document file
        const documentFilename = `${(0, uuid_1.v4)()}.html`;
        const documentPath = path_1.default.join(config.storage.path, documentFilename);
        // Save initial content
        await promises_1.default.mkdir(path_1.default.dirname(documentPath), { recursive: true });
        await promises_1.default.writeFile(documentPath, initialContent);
        // Add to database
        const result = await db.query(`INSERT INTO documents
       (name, path, size, mime_type, description, uploaded_by, created_at, uploaded_at, document_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            title,
            documentPath,
            initialContent.length,
            'text/html',
            description || '',
            currentUser.id,
            new Date(),
            new Date(),
            'edited'
        ]);
        const documentId = result.insertId || result.lastID;
        // Add to folder if specified
        if (folderId) {
            await db.query('INSERT INTO document_folders (document_id, folder_id, added_at) VALUES (?, ?, ?)', [documentId, folderId, new Date()]);
        }
        // Log activity
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'create',
            'document',
            documentId,
            `Created new document "${title}"`,
            new Date()
        ]);
        res.json({
            success: true,
            documentId,
            title,
            editUrl: `/document/${documentId}/edit`
        });
    }
    catch (error) {
        logger_1.logger.error('Error creating document:', error);
        res.status(500).json({ error: 'Failed to create document' });
    }
});
// Get document for editing
exports.documentEditorRouter.get('/:id/edit', auth_1.isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user;
        // Get document from database
        const db = (0, connection_1.getConnection)();
        const docs = await db.query(`SELECT d.*, u.username as owner_username
       FROM documents d
       JOIN users u ON d.uploaded_by = u.id
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares 
           WHERE shared_with = ? AND permission = 'edit'
         )
       )`, [documentId, currentUser.id, currentUser.id]);
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }
        const doc = docs[0];
        // Read document content
        let content;
        try {
            content = await promises_1.default.readFile(doc.path, 'utf8');
        }
        catch (error) {
            logger_1.logger.error(`Error reading document file at ${doc.path}:`, error);
            content = ''; // Default to empty if file can't be read
        }
        // Get document collaborators
        const shares = await db.query(`SELECT ds.*, u.username, u.displayName
       FROM document_shares ds
       JOIN users u ON ds.shared_with = u.id
       WHERE ds.document_id = ?`, [documentId]);
        // Log edit activity
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'edit',
            'document',
            documentId,
            `Opened document "${doc.name}" for editing`,
            new Date()
        ]);
        res.json({
            document: {
                ...doc,
                content
            },
            shares,
            currentUser: {
                id: currentUser.id,
                username: currentUser.username,
                displayName: currentUser.displayName
            }
        });
    }
    catch (error) {
        logger_1.logger.error(`Error fetching document ${req.params.id} for editing:`, error);
        res.status(500).json({ error: 'Failed to fetch document for editing' });
    }
});
// Save document content
exports.documentEditorRouter.post('/:id/save', auth_1.isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const { content } = req.body;
        const currentUser = req.user;
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'Content must be provided as a string' });
        }
        // Verify document access
        const db = (0, connection_1.getConnection)();
        const docs = await db.query(`SELECT d.* FROM documents d
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares 
           WHERE shared_with = ? AND permission = 'edit'
         )
       )`, [documentId, currentUser.id, currentUser.id]);
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }
        const doc = docs[0];
        // Create version of previous content
        try {
            if ((0, fs_1.existsSync)(doc.path)) {
                const previousContent = await promises_1.default.readFile(doc.path, 'utf8');
                // Only create a version if the content has actually changed
                if (previousContent !== content) {
                    const versionFilename = `${path_1.default.basename(doc.path, path_1.default.extname(doc.path))}-${Date.now()}.html`;
                    const versionPath = path_1.default.join(process.cwd(), 'data', 'versions', versionFilename);
                    // Ensure versions directory exists
                    await promises_1.default.mkdir(path_1.default.dirname(versionPath), { recursive: true });
                    // Save old content as a version
                    await promises_1.default.writeFile(versionPath, previousContent);
                    // Add version to database
                    await db.query(`INSERT INTO document_versions
             (document_id, version_path, size, created_by, created_at)
             VALUES (?, ?, ?, ?, ?)`, [
                        documentId,
                        versionPath,
                        previousContent.length,
                        currentUser.id,
                        new Date()
                    ]);
                }
            }
        }
        catch (error) {
            logger_1.logger.warn(`Warning: Could not create document version for ${documentId}:`, error);
            // Continue even if version creation fails
        }
        // Save new content
        await promises_1.default.writeFile(doc.path, content);
        // Update document in database
        await db.query(`UPDATE documents 
       SET size = ?, modified_at = ?, modified_by = ?
       WHERE id = ?`, [content.length, new Date(), currentUser.id, documentId]);
        // Process content for knowledge extraction
        setTimeout(async () => {
            try {
                // Extract entities
                const entities = await (0, entityExtractor_1.extractEntities)(stripHtml(content));
                logger_1.logger.info(`Extracted ${entities.length} entities from edited document ${documentId}`);
                // Extract deadlines
                const deadlines = await (0, deadlineTracker_1.extractLegalDeadlines)(documentId, stripHtml(content));
                logger_1.logger.info(`Extracted ${deadlines.length} deadlines from edited document ${documentId}`);
                // Add to knowledge base
                await (0, knowledgeBase_1.addToKnowledgeBase)(documentId, stripHtml(content));
            }
            catch (error) {
                logger_1.logger.error(`Error processing edited document ${documentId} for knowledge extraction:`, error);
            }
        }, 100);
        // Log save activity
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'save',
            'document',
            documentId,
            `Saved changes to document "${doc.name}"`,
            new Date()
        ]);
        res.json({ success: true, savedAt: new Date() });
    }
    catch (error) {
        logger_1.logger.error(`Error saving document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to save document' });
    }
});
// Get document templates
exports.documentEditorRouter.get('/templates', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        // Get templates from database
        const templates = await db.query(`SELECT id, name, description, category, thumbnail, created_at 
       FROM document_templates 
       ORDER BY category, name`);
        res.json({ templates });
    }
    catch (error) {
        logger_1.logger.error('Error fetching document templates:', error);
        res.status(500).json({ error: 'Failed to fetch document templates' });
    }
});
// Insert image into document
exports.documentEditorRouter.post('/:id/upload-image', auth_1.isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user;
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        // Verify document access
        const db = (0, connection_1.getConnection)();
        const docs = await db.query(`SELECT d.* FROM documents d
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares 
           WHERE shared_with = ? AND permission = 'edit'
         )
       )`, [documentId, currentUser.id, currentUser.id]);
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }
        const config = (0, config_1.loadConfig)();
        const uniqueFilename = `${Date.now()}-${(0, uuid_1.v4)()}-${path_1.default.basename(req.file.originalname)}`;
        const imagePath = path_1.default.join(config.storage.path, 'images', uniqueFilename);
        // Ensure images directory exists
        await promises_1.default.mkdir(path_1.default.dirname(imagePath), { recursive: true });
        // Copy file from temp location to permanent storage
        await promises_1.default.copyFile(req.file.path, imagePath);
        // Delete temp file
        await promises_1.default.unlink(req.file.path).catch(err => {
            logger_1.logger.warn(`Warning: Could not delete temp file ${req.file.path}:`, err);
        });
        // Return URL for the image
        const imageUrl = `/api/document-editor/images/${uniqueFilename}`;
        res.json({
            success: true,
            imageUrl,
            width: req.body.width,
            height: req.body.height
        });
    }
    catch (error) {
        logger_1.logger.error(`Error uploading image for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});
// Serve images
exports.documentEditorRouter.get('/images/:filename', async (req, res) => {
    try {
        const config = (0, config_1.loadConfig)();
        const imagePath = path_1.default.join(config.storage.path, 'images', req.params.filename);
        if (!(0, fs_1.existsSync)(imagePath)) {
            return res.status(404).send('Image not found');
        }
        res.sendFile(imagePath);
    }
    catch (error) {
        logger_1.logger.error(`Error serving image ${req.params.filename}:`, error);
        res.status(500).send('Error loading image');
    }
});
// Compare document versions
exports.documentEditorRouter.get('/:id/compare/:versionId', auth_1.isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const versionId = parseInt(req.params.versionId);
        const currentUser = req.user;
        // Verify document access
        const db = (0, connection_1.getConnection)();
        const docs = await db.query(`SELECT d.* FROM documents d
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares WHERE shared_with = ?
         )
       )`, [documentId, currentUser.id, currentUser.id]);
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }
        const doc = docs[0];
        // Get version
        const versions = await db.query('SELECT * FROM document_versions WHERE document_id = ? AND id = ?', [documentId, versionId]);
        if (!versions || versions.length === 0) {
            return res.status(404).json({ error: 'Version not found' });
        }
        const version = versions[0];
        // Read current content
        let currentContent;
        try {
            currentContent = await promises_1.default.readFile(doc.path, 'utf8');
        }
        catch (error) {
            logger_1.logger.error(`Error reading current document file at ${doc.path}:`, error);
            currentContent = '';
        }
        // Read version content
        let versionContent;
        try {
            versionContent = await promises_1.default.readFile(version.version_path, 'utf8');
        }
        catch (error) {
            logger_1.logger.error(`Error reading version file at ${version.version_path}:`, error);
            versionContent = '';
        }
        res.json({
            document: {
                id: doc.id,
                name: doc.name
            },
            version: {
                id: version.id,
                createdAt: version.created_at
            },
            currentContent,
            versionContent
        });
    }
    catch (error) {
        logger_1.logger.error(`Error comparing document versions for ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to compare document versions' });
    }
});
/**
 * Strip HTML tags from content to get plain text
 */
function stripHtml(html) {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
