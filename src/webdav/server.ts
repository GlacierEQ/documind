import { createServer, v2 as webdav } from 'webdav-server';
import path from 'path';
import fs from 'fs';
import { loadConfig } from '../config/config';
import { getConnection } from '../database/connection';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// Track active editing sessions
interface EditSession {
    documentId: number;
    originalPath: string;
    fileName: string;
    userId: number;
    startedAt: Date;
    token: string;
    lockToken?: string;
}

const activeSessions: Map<string, EditSession> = new Map();

/**
 * Start WebDAV server for document editing
 */
export function startWebDavServer(port = 1900): void {
    const config = loadConfig();

    if (!config.webdav?.enabled) {
        logger.info('WebDAV server is disabled in configuration');
        return;
    }

    try {
        logger.info('Starting WebDAV server for document editing integration...');

        // Create server and user manager
        const server = createServer({
            port,
            httpAuthentication: {
                realm: 'Documind WebDAV'
            }
        });

        const userManager = new webdav.SimpleUserManager();
        const privilegeManager = new webdav.SimplePathPrivilegeManager();

        // Add admin user for WebDAV access
        const username = config.webdav.username || 'documind';
        const password = config.webdav.password || crypto.randomBytes(16).toString('hex');

        userManager.addUser(username, password);

        logger.info(`WebDAV credentials: ${username} / ${password}`);

        // Create virtual file system for documents
        const virtualFileSystem = new webdav.VirtualFileSystem();
        server.setFileSystemSync('/', virtualFileSystem);

        // Set authentication and privileges
        server.httpAuthentication.setUserManager(userManager);
        server.privilegeManager.setPathPrivilegeManager(privilegeManager);

        // Handle file access and modifications
        virtualFileSystem.on('readFile', async (ctx, path, callback) => {
            try {
                // Extract document ID from path
                const match = path.match(/\/document-([0-9]+)/);
                if (!match) {
                    return callback(webdav.Errors.ResourceNotFound);
                }

                const documentId = parseInt(match[1]);
                const db = getConnection();

                // Get document from database
                const docs = await db.query(
                    'SELECT * FROM documents WHERE id = ?',
                    [documentId]
                );

                if (!docs || docs.length === 0) {
                    return callback(webdav.Errors.ResourceNotFound);
                }

                const doc = docs[0];

                // Create session token for tracking this edit
                const token = crypto.randomBytes(16).toString('hex');
                const fileName = doc.name;

                // Store session info
                activeSessions.set(token, {
                    documentId,
                    originalPath: doc.path,
                    fileName,
                    userId: ctx.context.user.uid,
                    startedAt: new Date(),
                    token
                });

                // Read file content
                fs.readFile(doc.path, (err, data) => {
                    if (err) {
                        logger.error(`Error reading file for WebDAV: ${err.message}`);
                        return callback(webdav.Errors.ResourceNotFound);
                    }

                    callback(undefined, data);
                });
            } catch (error) {
                logger.error('WebDAV readFile error:', error);
                callback(webdav.Errors.InternalServerError);
            }
        });

        // Handle saving edited documents
        virtualFileSystem.on('writeFile', async (ctx, path, data, callback) => {
            try {
                // Extract document ID from path
                const match = path.match(/\/document-([0-9]+)/);
                if (!match) {
                    return callback(webdav.Errors.ResourceNotFound);
                }

                const documentId = parseInt(match[1]);
                const db = getConnection();

                // Get document from database
                const docs = await db.query(
                    'SELECT * FROM documents WHERE id = ?',
                    [documentId]
                );

                if (!docs || docs.length === 0) {
                    return callback(webdav.Errors.ResourceNotFound);
                }

                const doc = docs[0];

                // Save the updated file
                fs.writeFile(doc.path, data, async (err) => {
                    if (err) {
                        logger.error(`Error writing file from WebDAV: ${err.message}`);
                        return callback(webdav.Errors.InternalServerError);
                    }

                    // Update document metadata
                    const stats = fs.statSync(doc.path);
                    await db.query(
                        'UPDATE documents SET size = ?, modified_at = ? WHERE id = ?',
                        [stats.size, new Date(), documentId]
                    );

                    // Log activity
                    await db.query(
                        `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            ctx.context.user.uid,
                            'update',
                            'document',
                            documentId,
                            `Document edited via WebDAV`,
                            new Date()
                        ]
                    );

                    logger.info(`Document ${documentId} updated via WebDAV by user ${ctx.context.user.uid}`);
                    callback();
                });
            } catch (error) {
                logger.error('WebDAV writeFile error:', error);
                callback(webdav.Errors.InternalServerError);
            }
        });

        // Get document information for directory listing
        virtualFileSystem.on('readdir', async (ctx, path, callback) => {
            try {
                const db = getConnection();

                // List accessible documents
                const docs = await db.query(
                    'SELECT * FROM documents ORDER BY id DESC LIMIT 100'
                );

                if (!docs || docs.length === 0) {
                    return callback(undefined, []);
                }

                // Convert to WebDAV file structure
                const files = docs.map(doc => {
                    return {
                        name: `document-${doc.id}`,
                        lastModified: doc.modified_at || doc.uploaded_at,
                        creationDate: doc.uploaded_at,
                        size: doc.size,
                        type: 'file'
                    };
                });

                callback(undefined, files);
            } catch (error) {
                logger.error('WebDAV readdir error:', error);
                callback(webdav.Errors.InternalServerError);
            }
        });

        // Start server
        server.start(() => {
            logger.info(`WebDAV server started on port ${port}`);
        });

    } catch (error) {
        logger.error('Failed to start WebDAV server:', error);
    }
}
