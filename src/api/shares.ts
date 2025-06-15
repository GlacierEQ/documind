import express from 'express';
import { getConnection } from '../database/connection';
import { isAuthenticated } from '../auth/auth';
import { logger } from '../utils/logger';

export const sharesRouter = express.Router();

// Get all shares for current user (both shared by user and shared with user)
sharesRouter.get('/', isAuthenticated, async (req, res) => {
    try {
        const db = getConnection();
        const currentUser = req.user as any;

        // Get documents shared by the user
        const sharedByUser = await db.query(`
            SELECT ds.*, d.name as document_name, u.username as shared_with_username
            FROM document_shares ds
            JOIN documents d ON ds.document_id = d.id
            JOIN users u ON ds.shared_with = u.id
            WHERE ds.shared_by = ?
            ORDER BY ds.created_at DESC
        `, [currentUser.id]);

        // Get documents shared with the user
        const sharedWithUser = await db.query(`
            SELECT ds.*, d.name as document_name, u.username as shared_by_username
            FROM document_shares ds
            JOIN documents d ON ds.document_id = d.id
            JOIN users u ON ds.shared_by = u.id
            WHERE ds.shared_with = ?
            ORDER BY ds.created_at DESC
        `, [currentUser.id]);

        res.json({
            sharedByUser,
            sharedWithUser
        });
    } catch (error) {
        logger.error('Error fetching shares:', error);
        res.status(500).json({ error: 'Failed to fetch shares' });
    }
});

// Share a document with another user
sharesRouter.post('/', isAuthenticated, async (req, res) => {
    try {
        const { documentId, sharedWithId, permission = 'read', expiresAt = null } = req.body;
        const currentUser = req.user as any;

        // Validate required fields
        if (!documentId || !sharedWithId) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['documentId', 'sharedWithId']
            });
        }

        // Validate permission
        const validPermissions = ['read', 'edit', 'admin'];
        if (!validPermissions.includes(permission)) {
            return res.status(400).json({
                error: 'Invalid permission',
                validPermissions
            });
        }

        const db = getConnection();

        // Check if document exists and belongs to user
        const documents = await db.query(
            'SELECT * FROM documents WHERE id = ? AND uploaded_by = ?',
            [documentId, currentUser.id]
        );

        if (!documents || documents.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        // Check if user exists
        const users = await db.query('SELECT id FROM users WHERE id = ?', [sharedWithId]);

        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if share already exists
        const existingShares = await db.query(
            'SELECT id FROM document_shares WHERE document_id = ? AND shared_with = ?',
            [documentId, sharedWithId]
        );

        if (existingShares && existingShares.length > 0) {
            // Update existing share instead of creating a new one
            await db.query(
                'UPDATE document_shares SET permission = ?, expires_at = ? WHERE document_id = ? AND shared_with = ?',
                [permission, expiresAt, documentId, sharedWithId]
            );

            return res.json({
                success: true,
                message: 'Share updated successfully',
                shareId: existingShares[0].id
            });
        }

        // Create share
        const result = await db.query(
            'INSERT INTO document_shares (document_id, shared_by, shared_with, permission, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
            [documentId, currentUser.id, sharedWithId, permission, new Date(), expiresAt]
        );

        const shareId = result.lastID || result.insertId;

        // Log the action
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'create',
                'share',
                shareId,
                `Shared document ${documentId} with user ${sharedWithId}`,
                new Date()
            ]
        );

        res.status(201).json({
            success: true,
            message: 'Document shared successfully',
            shareId
        });
    } catch (error) {
        logger.error('Error sharing document:', error);
        res.status(500).json({ error: 'Failed to share document' });
    }
});

// Delete a share
sharesRouter.delete('/:id', isAuthenticated, async (req, res) => {
    try {
        const shareId = parseInt(req.params.id);
        const currentUser = req.user as any;

        const db = getConnection();

        // Check if share exists and belongs to user
        const shares = await db.query(
            'SELECT * FROM document_shares WHERE id = ? AND shared_by = ?',
            [shareId, currentUser.id]
        );

        if (!shares || shares.length === 0) {
            return res.status(404).json({ error: 'Share not found or access denied' });
        }

        const share = shares[0];

        // Delete share
        await db.query('DELETE FROM document_shares WHERE id = ?', [shareId]);

        // Log the action
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'delete',
                'share',
                shareId,
                `Removed share of document ${share.document_id} with user ${share.shared_with}`,
                new Date()
            ]
        );

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error deleting share ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete share' });
    }
});
