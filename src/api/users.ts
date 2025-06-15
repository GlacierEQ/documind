import express from 'express';
import bcrypt from 'bcrypt';
import { getConnection } from '../database/connection';
import { isAuthenticated, isAdmin } from '../auth/auth';
import { logger } from '../utils/logger';
import { randomBytes } from 'crypto';

export const userRouter = express.Router();

// Get all users (admin only)
userRouter.get('/', isAdmin, async (req, res) => {
    try {
        const db = getConnection();
        const users = await db.query(`
            SELECT id, username, email, displayName, role, created_at, last_login
            FROM users ORDER BY id
        `);

        res.json({ users });
    } catch (error) {
        logger.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get a single user by ID
userRouter.get('/:id', isAuthenticated, async (req, res) => {
    try {
        const currentUser = req.user as any;
        const userId = parseInt(req.params.id);

        // Only admins can view other users' details
        if (currentUser.role !== 'admin' && currentUser.id !== userId) {
            return res.status(403).json({ error: 'Not authorized to view this user' });
        }

        const db = getConnection();
        const users = await db.query(`
            SELECT id, username, email, displayName, role, created_at, last_login
            FROM users WHERE id = ?
        `, [userId]);

        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(users[0]);
    } catch (error) {
        logger.error(`Error fetching user ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Create a new user (admin only)
userRouter.post('/', isAdmin, async (req, res) => {
    try {
        const { username, email, displayName, password, role } = req.body;

        // Validate required fields
        if (!username || !email || !displayName || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'email', 'displayName', 'password']
            });
        }

        // Validate role
        const validRoles = ['user', 'admin'];
        const userRole = role || 'user';
        if (!validRoles.includes(userRole)) {
            return res.status(400).json({
                error: 'Invalid role',
                validRoles
            });
        }

        const db = getConnection();

        // Check if username or email already exists
        const existingUsers = await db.query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existingUsers && existingUsers.length > 0) {
            return res.status(409).json({ error: 'Username or email already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the user
        const result = await db.query(
            `INSERT INTO users (username, email, displayName, password, role, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, email, displayName, hashedPassword, userRole, new Date()]
        );

        const userId = result.lastID || result.insertId;

        // Log the action
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                (req.user as any).id,
                'create',
                'user',
                userId,
                `Created user ${username}`,
                new Date()
            ]
        );

        res.status(201).json({
            id: userId,
            username,
            email,
            displayName,
            role: userRole
        });
    } catch (error) {
        logger.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user
userRouter.put('/:id', isAuthenticated, async (req, res) => {
    try {
        const currentUser = req.user as any;
        const userId = parseInt(req.params.id);
        const { email, displayName, role } = req.body;

        // Only admins can update other users or change roles
        if (currentUser.role !== 'admin' && (currentUser.id !== userId || role)) {
            return res.status(403).json({ error: 'Not authorized to update this user' });
        }

        const db = getConnection();

        // Check if user exists
        const users = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Build update query
        const updates: string[] = [];
        const values: any[] = [];

        if (email) {
            updates.push('email = ?');
            values.push(email);
        }

        if (displayName) {
            updates.push('displayName = ?');
            values.push(displayName);
        }

        if (role && currentUser.role === 'admin') {
            const validRoles = ['user', 'admin'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({
                    error: 'Invalid role',
                    validRoles
                });
            }
            updates.push('role = ?');
            values.push(role);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        // Add user ID to values array
        values.push(userId);

        // Execute update
        await db.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        // Log the action
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'update',
                'user',
                userId,
                `Updated user profile`,
                new Date()
            ]
        );

        // Fetch updated user
        const updatedUsers = await db.query(
            'SELECT id, username, email, displayName, role FROM users WHERE id = ?',
            [userId]
        );

        res.json(updatedUsers[0]);
    } catch (error) {
        logger.error(`Error updating user ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Change password
userRouter.post('/:id/change-password', isAuthenticated, async (req, res) => {
    try {
        const currentUser = req.user as any;
        const userId = parseInt(req.params.id);
        const { currentPassword, newPassword } = req.body;

        // Only admins can change other users' passwords without current password
        if (currentUser.role !== 'admin' && currentUser.id !== userId) {
            return res.status(403).json({ error: 'Not authorized to change this user\'s password' });
        }

        const db = getConnection();

        // Check if user exists
        const users = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        // Verify current password if not admin or changing own password
        if (currentUser.role !== 'admin' || currentUser.id === userId) {
            if (!currentPassword) {
                return res.status(400).json({ error: 'Current password is required' });
            }

            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await db.query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, userId]
        );

        // Log the action
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'update',
                'user',
                userId,
                `Changed password`,
                new Date()
            ]
        );

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error changing password for user ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// Delete user (admin only)
userRouter.delete('/:id', isAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const currentUser = req.user as any;

        // Prevent self-deletion
        if (currentUser.id === userId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const db = getConnection();

        // Check if user exists
        const users = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        // Delete user
        await db.query('DELETE FROM users WHERE id = ?', [userId]);

        // Log the action
        await db.query(
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                currentUser.id,
                'delete',
                'user',
                userId,
                `Deleted user ${user.username}`,
                new Date()
            ]
        );

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error deleting user ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});
