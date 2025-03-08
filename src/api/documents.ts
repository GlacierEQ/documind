import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from '../database/connection';
import { isAuthenticated } from '../auth/auth';
import { logger, performance } from '../utils/logger';
import { loadConfig } from '../config/config';
import { indexDocument } from '../search/indexer';
import { summarizeDocument, analyzeDocument, generateDocumentTags } from '../ai/processor';

export const documentsRouter = express.Router();

// Configure storage
const config = loadConfig();
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.storage.path);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: config.document.maxFileSize * 1024 * 1024 // Convert MB to bytes
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().substring(1);

        if (config.document.allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} is not allowed`));
        }
    }
});

// Get all documents for the authenticated user
documentsRouter.get('/', isAuthenticated, async (req, res) => {
    try {
        const db = getConnection();
        const currentUser = req.user as any;
        const limit = parseInt(req.query.limit as string || '50');
        const offset = parseInt(req.query.offset as string || '0');
        const query = req.query.q as string;
        const folderId = req.query.folder_id ? parseInt(req.query.folder_id as string) : null;

        // Build the SQL query
        let sql = `
      SELECT d.*, u.username as uploader_username
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      WHERE d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      )
    `;

        const params: any[] = [currentUser.id, currentUser.id];

        // Filter by folder if specified
        if (folderId) {
            sql += ' AND d.id IN (SELECT document_id FROM document_folders WHERE folder_id = ?)';
            params.push(folderId);
        }

        // Filter by search query if specified
        if (query) {
            sql += ' AND (d.name LIKE ? OR d.description LIKE ?)';
            params.push(`%${query}%`, `%${query}%`);
        }

        // Add order, limit and offset
        sql += ' ORDER BY d.uploaded_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const documents = await db.query(sql, params);

        // Get total count
        const countSql = `
      SELECT COUNT(*) as total
      FROM documents d
      WHERE d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      )
    `;

        const countParams = [currentUser.id, currentUser.id];

        if (folderId) {
            countSql + ' AND d.id IN (SELECT document_id FROM document_folders WHERE folder_id = ?)';
            countParams.push(folderId);
        }

        if (query) {
            countSql + ' AND (d.name LIKE ? OR d.description LIKE ?)';
            countParams.push(`%${query}%`, `%${query}%`);
        }

        const countResult = await db.query(countSql, countParams);
        const total = countResult[0].total;

        res.json({
            documents,
            pagination: {
                total,
                limit,
                offset
            }
        });
    } catch (error) {
        logger.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// Upload a new document
documentsRouter.post('/upload', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        const perfEnd = performance.start('document-upload');

        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const { originalname, path: filePath, size, mimetype } = req.file;
        const description = req.body.description || '';
        const currentUser = req.user as any;

        // Determine if the file is a PDF
        const isPdf = mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf');

        // Add document to database
        const db = getConnection();
        const result = await db.query(
            `INSERT INTO documents 
      (name, path, size, mime_type, description, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [originalname, filePath, size, mimetype, description, currentUser.id, new Date()]
        );

        const documentId = result.insertId || result.lastID;

        // Add to folder if specified
        const folderId = req.body.folder_id ? parseInt(req.body.folder_id) : null;
        if (folderId) {
            // Verify folder exists and belongs to user
            const folders = await db.query(
                'SELECT * FROM folders WHERE id = ? AND created_by = ?',
                [folderId, currentUser.id]
            );

            if (folders && folders.length > 0) {
                await db.query(
                    'INSERT INTO document_folders (document_id, folder_id, added_at) VALUES (?, ?, ?)',
                    [documentId, folderId, new Date()]
                );
            }
        }

        // Log activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'upload',
                'document',
                documentId,
                `Uploaded document "${originalname}"`,
                new Date()
            ]
        );

        // Start indexing the document asynchronously
        indexDocument(documentId).catch(err => {
            logger.error(`Error indexing document ${documentId}:`, err);
        });

        // For PDF files, trigger AI processing if enabled
        if (isPdf && config.ai.provider !== 'none') {
            // Queue AI processing tasks asynchronously
            if (config.ai.summarizationEnabled) {
                setTimeout(() => {
                    summarizeDocument(documentId).catch(err => {
                        logger.error(`Error summarizing document ${documentId}:`, err);
                    });
                }, 1000);
            }

            if (config.ai.analysisEnabled) {
                setTimeout(() => {
                    analyzeDocument(documentId).catch(err => {
                        logger.error(`Error analyzing document ${documentId}:`, err);
                    });
                }, 2000);
            }

            if (config.ai.taggingEnabled) {
                setTimeout(() => {
                    generateDocumentTags(documentId).catch(err => {
                        logger.error(`Error generating tags for document ${documentId}:`, err);
                    });
                }, 3000);
            }
        }

        logger.info(`Document ${documentId} uploaded in ${perfEnd()}ms`);

        res.status(201).json({
            id: documentId,
            name: originalname,
            size,
            mime_type: mimetype,
            uploaded_at: new Date()
        });
    } catch (error) {
        logger.error('Error uploading document:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

// Get a single document by ID
documentsRouter.get('/:id', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user as any;

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            `SELECT d.*, u.username as uploader_username
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      WHERE d.id = ? AND (
        d.uploaded_by = ? OR d.id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        )
      )`,
            [documentId, currentUser.id, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        const doc = docs[0];

        // Get document shares
        const shares = await db.query(
            `SELECT ds.*, u.username, u.displayName
       FROM document_shares ds
       JOIN users u ON ds.shared_with = u.id
       WHERE ds.document_id = ?`,
            [documentId]
        );

        // Get document folders
        const folders = await db.query(
            `SELECT f.* 
       FROM folders f
       JOIN document_folders df ON f.id = df.folder_id
       WHERE df.document_id = ?`,
            [documentId]
        );

        // Log view activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'view',
                'document',
                documentId,
                `Viewed document "${doc.name}"`,
                new Date()
            ]
        );

        res.json({
            document: doc,
            shares,
            folders
        });
    } catch (error) {
        logger.error(`Error fetching document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});

// Download document
documentsRouter.get('/:id/download', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user as any;

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            `SELECT * FROM documents 
       WHERE id = ? AND (
        uploaded_by = ? OR id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        )
      )`,
            [documentId, currentUser.id, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        const doc = docs[0];

        // Check if file exists
        try {
            await fs.access(doc.path);
        } catch (error) {
            logger.error(`File not found at ${doc.path}`);
            return res.status(404).json({ error: 'File not found on server' });
        }

        // Log download activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'download',
                'document',
                documentId,
                `Downloaded document "${doc.name}"`,
                new Date()
            ]
        );

        // Send file
        res.download(doc.path, doc.name);
    } catch (error) {
        logger.error(`Error downloading document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to download document' });
    }
});

// Stream document raw content
documentsRouter.get('/:id/raw', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user as any;

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            `SELECT * FROM documents 
       WHERE id = ? AND (
        uploaded_by = ? OR id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        )
      )`,
            [documentId, currentUser.id, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        const doc = docs[0];

        // Check if file exists
        try {
            await fs.access(doc.path);
        } catch (error) {
            logger.error(`File not found at ${doc.path}`);
            return res.status(404).json({ error: 'File not found on server' });
        }

        // Get file stats
        const stats = await fs.stat(doc.path);

        // Set headers
        res.setHeader('Content-Type', doc.mime_type);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);

        // Stream file
        const fileStream = fs.createReadStream(doc.path);
        fileStream.pipe(res);
    } catch (error) {
        logger.error(`Error streaming document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to stream document' });
    }
});

// Update document content
documentsRouter.post('/:id/update', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user as any;
        const perfEnd = performance.start('document-update');

        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            `SELECT * FROM documents 
       WHERE id = ? AND (
        uploaded_by = ? OR id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        )
      )`,
            [documentId, currentUser.id, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        const doc = docs[0];
        const oldPath = doc.path;
        const { path: newPath, size, mimetype } = req.file;

        // Update document in database
        await db.query(
            `UPDATE documents 
       SET path = ?, size = ?, mime_type = ?, modified_at = ?, modified_by = ?, indexed = 0, indexed_at = NULL
       WHERE id = ?`,
            [newPath, size, mimetype, new Date(), currentUser.id, documentId]
        );

        // Log update activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'update',
                'document',
                documentId,
                `Updated document "${doc.name}"`,
                new Date()
            ]
        );

        // Create document version
        await db.query(
            `INSERT INTO document_versions (document_id, version_path, size, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
            [documentId, oldPath, doc.size, currentUser.id, new Date()]
        );

        // Start re-indexing the document
        indexDocument(documentId).catch(err => {
            logger.error(`Error re-indexing document ${documentId}:`, err);
        });

        logger.info(`Document ${documentId} updated in ${perfEnd()}ms`);

        res.json({
            success: true,
            message: 'Document updated successfully'
        });
    } catch (error) {
        logger.error(`Error updating document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to update document' });
    }
});

// Delete document
documentsRouter.delete('/:id', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user as any;

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            'SELECT * FROM documents WHERE id = ? AND uploaded_by = ?',
            [documentId, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        const doc = docs[0];

        // Delete document from database
        await db.query('DELETE FROM documents WHERE id = ?', [documentId]);

        // Delete document file
        try {
            await fs.unlink(doc.path);
        } catch (error) {
            logger.warn(`Could not delete file at ${doc.path}:`, error);
        }

        // Log delete activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'delete',
                'document',
                documentId,
                `Deleted document "${doc.name}"`,
                new Date()
            ]
        );

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error deleting document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

// Share document with another user
documentsRouter.post('/:id/share', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const { username, permission = 'read' } = req.body;
        const currentUser = req.user as any;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        // Validate permission
        const validPermissions = ['read', 'edit'];
        if (!validPermissions.includes(permission)) {
            return res.status(400).json({
                error: 'Invalid permission',
                validPermissions
            });
        }

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            'SELECT * FROM documents WHERE id = ? AND uploaded_by = ?',
            [documentId, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        // Get user by username
        const users = await db.query('SELECT id FROM users WHERE username = ?', [username]);

        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const sharedWithId = users[0].id;

        // Check if document is already shared with this user
        const existingShares = await db.query(
            'SELECT * FROM document_shares WHERE document_id = ? AND shared_with = ?',
            [documentId, sharedWithId]
        );

        if (existingShares && existingShares.length > 0) {
            // Update existing share
            await db.query(
                'UPDATE document_shares SET permission = ? WHERE document_id = ? AND shared_with = ?',
                [permission, documentId, sharedWithId]
            );
        } else {
            // Create new share
            await db.query(
                `INSERT INTO document_shares 
        (document_id, shared_by, shared_with, permission, created_at)
        VALUES (?, ?, ?, ?, ?)`,
                [documentId, currentUser.id, sharedWithId, permission, new Date()]
            );
        }

        // Log share activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'share',
                'document',
                documentId,
                `Shared document with user "${username}" (${permission})`,
                new Date()
            ]
        );

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error sharing document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to share document' });
    }
});

// Get document versions
documentsRouter.get('/:id/versions', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user as any;

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            `SELECT * FROM documents 
       WHERE id = ? AND (
        uploaded_by = ? OR id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        )
      )`,
            [documentId, currentUser.id, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        // Get versions
        const versions = await db.query(
            `SELECT dv.*, u.username as created_by_username
       FROM document_versions dv
       JOIN users u ON dv.created_by = u.id
       WHERE dv.document_id = ?
       ORDER BY dv.created_at DESC`,
            [documentId]
        );

        res.json({ versions });
    } catch (error) {
        logger.error(`Error fetching versions for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch document versions' });
    }
});

// Download a specific version of a document
documentsRouter.get('/:id/versions/:versionId/download', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const versionId = parseInt(req.params.versionId);
        const currentUser = req.user as any;

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            `SELECT * FROM documents 
       WHERE id = ? AND (
        uploaded_by = ? OR id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        )
      )`,
            [documentId, currentUser.id, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        // Get version
        const versions = await db.query(
            'SELECT * FROM document_versions WHERE document_id = ? AND id = ?',
            [documentId, versionId]
        );

        if (!versions || versions.length === 0) {
            return res.status(404).json({ error: 'Version not found' });
        }

        const version = versions[0];
        const doc = docs[0];

        // Check if file exists
        try {
            await fs.access(version.version_path);
        } catch (error) {
            logger.error(`Version file not found at ${version.version_path}`);
            return res.status(404).json({ error: 'Version file not found on server' });
        }

        // Log download activity
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'download',
                'document_version',
                versionId,
                `Downloaded version ${versionId} of document "${doc.name}"`,
                new Date()
            ]
        );

        // Send file
        res.download(version.version_path, doc.name);
    } catch (error) {
        logger.error(`Error downloading version ${req.params.versionId} of document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to download document version' });
    }
});

// View document with Apryse WebViewer
documentsRouter.get('/:id/view', isAuthenticated, (req, res) => {
    const documentId = req.params.id;
    res.redirect(`/pdf/viewer/${documentId}`);
});

// AI Summary Endpoint
documentsRouter.get('/:id/ai/summary', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);

        // Get document summary
        const summary = await summarizeDocument(documentId);

        if (!summary) {
            return res.status(404).json({ error: 'Summary not available for this document' });
        }

        res.json(summary);
    } catch (error) {
        logger.error(`Error getting AI summary for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to get document summary' });
    }
});

// AI Analysis Endpoint
documentsRouter.get('/:id/ai/analysis', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);

        // Get document analysis
        const analysis = await analyzeDocument(documentId);

        if (!analysis) {
            return res.status(404).json({ error: 'Analysis not available for this document' });
        }

        res.json(analysis);
    } catch (error) {
        logger.error(`Error getting AI analysis for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to get document analysis' });
    }
});

// AI Tags Endpoint
documentsRouter.get('/:id/ai/tags', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);

        // Get document tags
        const tags = await generateDocumentTags(documentId);

        if (!tags) {
            return res.status(404).json({ error: 'Tags not available for this document' });
        }

        res.json(tags);
    } catch (error) {
        logger.error(`Error getting AI tags for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to get document tags' });
    }
});

// OCR processing endpoint
documentsRouter.post('/:id/ocr', isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const currentUser = req.user as any;

        // Get document from database
        const db = getConnection();
        const docs = await db.query(
            `SELECT * FROM documents WHERE id = ? AND (
        uploaded_by = ? OR id IN (
          SELECT document_id FROM document_shares ds 
          WHERE ds.shared_with = ? AND ds.permission = 'edit'
        )
      )`,
            [documentId, currentUser.id, currentUser.id]
        );

        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        // Document exists and user has access - process OCR
        // This would call your actual OCR implementation

        // Log OCR request
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'ocr',
                'document',
                documentId,
                `Requested OCR processing for document`,
                new Date()
            ]
        );

        res.json({ success: true, message: 'OCR processing started' });
    } catch (error) {
        logger.error(`Error processing OCR for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to process OCR' });
    }
});
