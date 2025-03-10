"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.folderRouter = void 0;
const express_1 = __importDefault(require("express"));
const connection_1 = require("../database/connection");
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
exports.folderRouter = express_1.default.Router();
// Get all folders for the authenticated user
exports.folderRouter.get('/', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        const currentUser = req.user;
        // Get user's folders
        const folders = await db.query(`
            SELECT f.*, 
                  (SELECT COUNT(*) FROM document_folders df WHERE df.folder_id = f.id) as document_count
            FROM folders f
            WHERE f.created_by = ? OR f.id IN (
                SELECT DISTINCT folder_id FROM document_folders df
                JOIN document_shares ds ON df.document_id = ds.document_id
                WHERE ds.shared_with = ?
            )
            ORDER BY f.name
        `, [currentUser.id, currentUser.id]);
        res.json({ folders });
    }
    catch (error) {
        logger_1.logger.error('Error fetching folders:', error);
        res.status(500).json({ error: 'Failed to fetch folders' });
    }
});
// Create a new folder
exports.folderRouter.post('/', auth_1.isAuthenticated, async (req, res) => {
    try {
        const { name, parent_id } = req.body;
        const currentUser = req.user;
        // Validate required fields
        if (!name) {
            return res.status(400).json({ error: 'Folder name is required' });
        }
        const db = (0, connection_1.getConnection)();
        // Check if folder with same name exists at same level
        const existingFolders = await db.query('SELECT id FROM folders WHERE name = ? AND parent_id IS ? AND created_by = ?', [name, parent_id || null, currentUser.id]);
        if (existingFolders && existingFolders.length > 0) {
            return res.status(409).json({ error: 'Folder with this name already exists' });
        }
        // If parent_id is provided, check if it exists and belongs to the user
        if (parent_id) {
            const parentFolders = await db.query('SELECT id FROM folders WHERE id = ? AND created_by = ?', [parent_id, currentUser.id]);
            if (!parentFolders || parentFolders.length === 0) {
                return res.status(404).json({ error: 'Parent folder not found or access denied' });
            }
        }
        // Create folder
        const result = await db.query('INSERT INTO folders (name, parent_id, created_by, created_at) VALUES (?, ?, ?, ?)', [name, parent_id || null, currentUser.id, new Date()]);
        const folderId = result.lastID || result.insertId;
        // Log the action
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'create',
            'folder',
            folderId,
            `Created folder "${name}"`,
            new Date()
        ]);
        // Return the created folder
        const folders = await db.query('SELECT * FROM folders WHERE id = ?', [folderId]);
        res.status(201).json(folders[0]);
    }
    catch (error) {
        logger_1.logger.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});
// Get a single folder by ID
exports.folderRouter.get('/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id);
        const currentUser = req.user;
        const db = (0, connection_1.getConnection)();
        // Check if folder exists and user has access
        const folders = await db.query(`
            SELECT f.*,
                  (SELECT COUNT(*) FROM document_folders df WHERE df.folder_id = f.id) as document_count
            FROM folders f
            WHERE f.id = ? AND (
                f.created_by = ? OR f.id IN (
                    SELECT DISTINCT folder_id FROM document_folders df
                    JOIN document_shares ds ON df.document_id = ds.document_id
                    WHERE ds.shared_with = ?
                )
            )
        `, [folderId, currentUser.id, currentUser.id]);
        if (!folders || folders.length === 0) {
            return res.status(404).json({ error: 'Folder not found or access denied' });
        }
        // Get documents in this folder
        const documents = await db.query(`
            SELECT d.*, u.username as uploader_username
            FROM documents d
            JOIN document_folders df ON d.id = df.document_id
            JOIN users u ON d.uploaded_by = u.id
            WHERE df.folder_id = ? AND (
                d.uploaded_by = ? OR d.id IN (
                    SELECT document_id FROM document_shares
                    WHERE shared_with = ?
                )
            )
            ORDER BY d.uploaded_at DESC
        `, [folderId, currentUser.id, currentUser.id]);
        // Get subfolders
        const subfolders = await db.query(`
            SELECT f.*,
                  (SELECT COUNT(*) FROM document_folders df WHERE df.folder_id = f.id) as document_count
            FROM folders f
            WHERE f.parent_id = ? AND f.created_by = ?
            ORDER BY f.name
        `, [folderId, currentUser.id]);
        res.json({
            folder: folders[0],
            documents,
            subfolders
        });
    }
    catch (error) {
        logger_1.logger.error(`Error fetching folder ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch folder' });
    }
});
// Update folder
exports.folderRouter.put('/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id);
        const { name, parent_id } = req.body;
        const currentUser = req.user;
        const db = (0, connection_1.getConnection)();
        // Check if folder exists and belongs to user
        const folders = await db.query('SELECT * FROM folders WHERE id = ? AND created_by = ?', [folderId, currentUser.id]);
        if (!folders || folders.length === 0) {
            return res.status(404).json({ error: 'Folder not found or access denied' });
        }
        const folder = folders[0];
        // If parent_id is provided, check if it exists and belongs to the user
        if (parent_id && parent_id !== folder.parent_id) {
            // Prevent circular reference
            if (parent_id === folderId) {
                return res.status(400).json({ error: 'Folder cannot be its own parent' });
            }
            const parentFolders = await db.query('SELECT id FROM folders WHERE id = ? AND created_by = ?', [parent_id, currentUser.id]);
            if (!parentFolders || parentFolders.length === 0) {
                return res.status(404).json({ error: 'Parent folder not found or access denied' });
            }
            // Check for circular reference (ensure the new parent is not a descendant of this folder)
            const checkCircular = async (checkId, targetId) => {
                if (checkId === targetId) {
                    return true;
                }
                const children = await db.query('SELECT id FROM folders WHERE parent_id = ?', [checkId]);
                for (const child of children) {
                    if (await checkCircular(child.id, targetId)) {
                        return true;
                    }
                }
                return false;
            };
            if (await checkCircular(folderId, parent_id)) {
                return res.status(400).json({ error: 'Circular folder reference detected' });
            }
        }
        // Build update query
        const updates = [];
        const values = [];
        if (name && name !== folder.name) {
            // Check if folder with same name exists at same level
            const existingFolders = await db.query('SELECT id FROM folders WHERE name = ? AND parent_id IS ? AND created_by = ? AND id != ?', [name, parent_id || folder.parent_id || null, currentUser.id, folderId]);
            if (existingFolders && existingFolders.length > 0) {
                return res.status(409).json({ error: 'Folder with this name already exists' });
            }
            updates.push('name = ?');
            values.push(name);
        }
        if (parent_id !== undefined) {
            updates.push('parent_id = ?');
            values.push(parent_id || null);
        }
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        // Add folder ID to values array
        values.push(folderId);
        // Execute update
        await db.query(`UPDATE folders SET ${updates.join(', ')} WHERE id = ?`, values);
        // Log the action
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'update',
            'folder',
            folderId,
            `Updated folder "${folder.name}"`,
            new Date()
        ]);
        // Fetch updated folder
        const updatedFolders = await db.query('SELECT * FROM folders WHERE id = ?', [folderId]);
        res.json(updatedFolders[0]);
    }
    catch (error) {
        logger_1.logger.error(`Error updating folder ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to update folder' });
    }
});
// Delete folder
exports.folderRouter.delete('/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id);
        const currentUser = req.user;
        const db = (0, connection_1.getConnection)();
        // Check if folder exists and belongs to user
        const folders = await db.query('SELECT * FROM folders WHERE id = ? AND created_by = ?', [folderId, currentUser.id]);
        if (!folders || folders.length === 0) {
            return res.status(404).json({ error: 'Folder not found or access denied' });
        }
        const folder = folders[0];
        // Check for subfolders
        const subfolders = await db.query('SELECT COUNT(*) as count FROM folders WHERE parent_id = ?', [folderId]);
        if (subfolders[0].count > 0) {
            return res.status(400).json({
                error: 'Folder contains subfolders. Delete or move them first.',
                subfolderCount: subfolders[0].count
            });
        }
        // Remove document associations
        await db.query('DELETE FROM document_folders WHERE folder_id = ?', [folderId]);
        // Delete the folder
        await db.query('DELETE FROM folders WHERE id = ?', [folderId]);
        // Log the action
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'delete',
            'folder',
            folderId,
            `Deleted folder "${folder.name}"`,
            new Date()
        ]);
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error(`Error deleting folder ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete folder' });
    }
});
// Add document to folder
exports.folderRouter.post('/:id/documents/:documentId', auth_1.isAuthenticated, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id);
        const documentId = parseInt(req.params.documentId);
        const currentUser = req.user;
        const db = (0, connection_1.getConnection)();
        // Check if folder exists and belongs to user
        const folders = await db.query('SELECT * FROM folders WHERE id = ? AND created_by = ?', [folderId, currentUser.id]);
        if (!folders || folders.length === 0) {
            return res.status(404).json({ error: 'Folder not found or access denied' });
        }
        // Check if document exists and user has access
        const documents = await db.query('SELECT * FROM documents WHERE id = ? AND (uploaded_by = ? OR id IN (SELECT document_id FROM document_shares WHERE shared_with = ?))', [documentId, currentUser.id, currentUser.id]);
        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }
        // Check if document is already in the folder
        const existing = await db.query('SELECT * FROM document_folders WHERE document_id = ? AND folder_id = ?', [documentId, folderId]);
        if (existing && existing.length > 0) {
            return res.status(409).json({ error: 'Document is already in this folder' });
        }
        // Add document to folder
        await db.query('INSERT INTO document_folders (document_id, folder_id, added_at) VALUES (?, ?, ?)', [documentId, folderId, new Date()]);
        // Log the action
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'update',
            'folder',
            folderId,
            `Added document ${documentId} to folder`,
            new Date()
        ]);
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error(`Error adding document ${req.params.documentId} to folder ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to add document to folder' });
    }
});
// Remove document from folder
exports.folderRouter.delete('/:id/documents/:documentId', auth_1.isAuthenticated, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id);
        const documentId = parseInt(req.params.documentId);
        const currentUser = req.user;
        const db = (0, connection_1.getConnection)();
        // Check if folder exists and belongs to user
        const folders = await db.query('SELECT * FROM folders WHERE id = ? AND created_by = ?', [folderId, currentUser.id]);
        if (!folders || folders.length === 0) {
            return res.status(404).json({ error: 'Folder not found or access denied' });
        }
        // Remove document from folder
        await db.query('DELETE FROM document_folders WHERE document_id = ? AND folder_id = ?', [documentId, folderId]);
        // Log the action
        await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [
            currentUser.id,
            'update',
            'folder',
            folderId,
            `Removed document ${documentId} from folder`,
            new Date()
        ]);
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error(`Error removing document ${req.params.documentId} from folder ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to remove document from folder' });
    }
});
