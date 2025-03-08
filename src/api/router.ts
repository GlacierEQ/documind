import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { loadConfig } from '../config/config';
import { isAuthenticated, isAdmin } from '../auth/auth';
import { getConnection } from '../database/connection';
import { searchDocuments } from '../search/indexer';
import { deleteDocument } from '../storage/storage';
import { logger } from '../utils/logger';
import { mindMapRouter } from './mindmap';

// Load configuration
const config = loadConfig();

// Create router
export const apiRouter = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(config.storage.path, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
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
            cb(new Error(`File type not allowed. Allowed types: ${config.document.allowedTypes.join(', ')}`));
        }
    }
});

// Authentication endpoints
apiRouter.post('/auth/login', passport.authenticate('local'), (req, res) => {
    res.json({ user: req.user });
});

apiRouter.post('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.json({ success: true });
    });
});

apiRouter.get('/auth/status', (req, res) => {
    res.json({
        isAuthenticated: req.isAuthenticated(),
        user: req.user
    });
});

// Document endpoints
apiRouter.post('/documents', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const db = getConnection();
        const user = req.user as any;

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

        const result = await db.query(
            `INSERT INTO documents 
      (name, description, path, size, mime_type, uploaded_by, uploaded_at, tags) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                doc.name,
                doc.description,
                doc.path,
                doc.size,
                doc.mimeType,
                doc.uploadedBy,
                doc.uploadedAt,
                doc.tags
            ]
        );

        const docId = result.lastID || result.insertId;

        // Queue for indexing
        // This would typically be handled by a background worker
        // For simplicity, we're just calling the indexer directly
        indexDocument(docId, doc.path, doc.name, doc.mimeType);

        res.json({
            success: true,
            document: {
                id: docId,
                ...doc
            }
        });
    } catch (error) {
        logger.error('Error uploading document:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

apiRouter.get('/documents', isAuthenticated, async (req, res) => {
    try {
        const db = getConnection();

        const query = `
      SELECT d.*, u.username as uploader_username 
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      ORDER BY d.uploaded_at DESC
      LIMIT ? OFFSET ?
    `;

        const limit = parseInt(req.query.limit as string || '20');
        const offset = parseInt(req.query.offset as string || '0');

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
    } catch (error) {
        logger.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

apiRouter.get('/documents/:id', isAuthenticated, async (req, res) => {
    try {
        const db = getConnection();
        const documents = await db.query(
            `SELECT d.*, u.username as uploader_username 
       FROM documents d
       JOIN users u ON d.uploaded_by = u.id
       WHERE d.id = ?`,
            [req.params.id]
        );

        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json(documents[0]);
    } catch (error) {
        logger.error(`Error fetching document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});

apiRouter.get('/documents/:id/download', isAuthenticated, async (req, res) => {
    try {
        const db = getConnection();
        const documents = await db.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);

        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const document = documents[0];

        if (!fs.existsSync(document.path)) {
            return res.status(404).json({ error: 'Document file not found' });
        }

        res.download(document.path, document.name);
    } catch (error) {
        logger.error(`Error downloading document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to download document' });
    }
});

apiRouter.delete('/documents/:id', isAuthenticated, async (req, res) => {
    try {
        const db = getConnection();

        // Check if document exists
        const documents = await db.query('SELECT * FROM documents WHERE id = ?', [req.params.id]);

        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const document = documents[0];

        // Check if user is authorized (admin or document owner)
        const user = req.user as any;
        if (user.role !== 'admin' && user.id !== document.uploaded_by) {
            return res.status(403).json({ error: 'Not authorized to delete this document' });
        }

        // Delete from database
        await db.query('DELETE FROM documents WHERE id = ?', [req.params.id]);

        // Delete from storage
        await deleteDocument(document.path);

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error deleting document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

apiRouter.get('/search', isAuthenticated, async (req, res) => {
    try {
        const query = req.query.q as string;

        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const results = await searchDocuments(query);
        res.json({ results });
    } catch (error) {
        logger.error('Error searching documents:', error);
        res.status(500).json({ error: 'Failed to search documents' });
    }
});

// Admin endpoints
apiRouter.get('/admin/stats', isAdmin, async (req, res) => {
    try {
        const db = getConnection();

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
    } catch (error) {
        logger.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});

// Import passport here to avoid circular dependency
import passport from 'passport';
import { indexDocument } from '../search/indexer';
import { folderRouter } from './folders';
import { userRouter } from './users';
import { adminRouter } from './admin';
import { sharesRouter } from './shares';
import { editorsRouter } from './editors';
import { settingsRouter } from './settings';

// Mount additional routers
apiRouter.use('/folders', folderRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/shares', sharesRouter);
apiRouter.use('/editors', editorsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/mindmap', mindMapRouter);
