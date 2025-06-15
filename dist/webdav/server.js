"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebDavServer = startWebDavServer;
const webdav_server_1 = require("webdav-server");
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config/config");
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const crypto_1 = __importDefault(require("crypto"));
const activeSessions = new Map();
/**
 * Start WebDAV server for document editing
 */
function startWebDavServer(port = 1900) {
    const config = (0, config_1.loadConfig)();
    if (!config.webdav?.enabled) {
        logger_1.logger.info('WebDAV server is disabled in configuration');
        return;
    }
    try {
        logger_1.logger.info('Starting WebDAV server for document editing integration...');
        // Create server and user manager
        const server = (0, webdav_server_1.createServer)({
            port,
            httpAuthentication: {
                realm: 'Documind WebDAV'
            }
        });
        const userManager = new webdav_server_1.v2.SimpleUserManager();
        const privilegeManager = new webdav_server_1.v2.SimplePathPrivilegeManager();
        // Add admin user for WebDAV access
        const username = config.webdav.username || 'documind';
        const password = config.webdav.password || crypto_1.default.randomBytes(16).toString('hex');
        userManager.addUser(username, password);
        logger_1.logger.info(`WebDAV credentials: ${username} / ${password}`);
        // Create virtual file system for documents
        const virtualFileSystem = new webdav_server_1.v2.VirtualFileSystem();
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
                    return callback(webdav_server_1.v2.Errors.ResourceNotFound);
                }
                const documentId = parseInt(match[1]);
                const db = (0, connection_1.getConnection)();
                // Get document from database
                const docs = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
                if (!docs || docs.length === 0) {
                    return callback(webdav_server_1.v2.Errors.ResourceNotFound);
                }
                const doc = docs[0];
                // Create session token for tracking this edit
                const token = crypto_1.default.randomBytes(16).toString('hex');
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
                fs_1.default.readFile(doc.path, (err, data) => {
                    if (err) {
                        logger_1.logger.error(`Error reading file for WebDAV: ${err.message}`);
                        return callback(webdav_server_1.v2.Errors.ResourceNotFound);
                    }
                    callback(undefined, data);
                });
            }
            catch (error) {
                logger_1.logger.error('WebDAV readFile error:', error);
                callback(webdav_server_1.v2.Errors.InternalServerError);
            }
        });
        // Handle saving edited documents
        virtualFileSystem.on('writeFile', async (ctx, path, data, callback) => {
            try {
                // Extract document ID from path
                const match = path.match(/\/document-([0-9]+)/);
                if (!match) {
                    return callback(webdav_server_1.v2.Errors.ResourceNotFound);
                }
                const documentId = parseInt(match[1]);
                const db = (0, connection_1.getConnection)();
                // Get document from database
                const docs = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
                if (!docs || docs.length === 0) {
                    return callback(webdav_server_1.v2.Errors.ResourceNotFound);
                }
                const doc = docs[0];
                // Save the updated file
                fs_1.default.writeFile(doc.path, data, async (err) => {
                    if (err) {
                        logger_1.logger.error(`Error writing file from WebDAV: ${err.message}`);
                        return callback(webdav_server_1.v2.Errors.InternalServerError);
                    }
                    // Update document metadata
                    const stats = fs_1.default.statSync(doc.path);
                    await db.query('UPDATE documents SET size = ?, modified_at = ? WHERE id = ?', [stats.size, new Date(), documentId]);
                    // Log activity
                    await db.query(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
                         VALUES (?, ?, ?, ?, ?, ?)`, [
                        ctx.context.user.uid,
                        'update',
                        'document',
                        documentId,
                        `Document edited via WebDAV`,
                        new Date()
                    ]);
                    logger_1.logger.info(`Document ${documentId} updated via WebDAV by user ${ctx.context.user.uid}`);
                    callback();
                });
            }
            catch (error) {
                logger_1.logger.error('WebDAV writeFile error:', error);
                callback(webdav_server_1.v2.Errors.InternalServerError);
            }
        });
        // Get document information for directory listing
        virtualFileSystem.on('readdir', async (ctx, path, callback) => {
            try {
                const db = (0, connection_1.getConnection)();
                // List accessible documents
                const docs = await db.query('SELECT * FROM documents ORDER BY id DESC LIMIT 100');
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
            }
            catch (error) {
                logger_1.logger.error('WebDAV readdir error:', error);
                callback(webdav_server_1.v2.Errors.InternalServerError);
            }
        });
        // Start server
        server.start(() => {
            logger_1.logger.info(`WebDAV server started on port ${port}`);
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start WebDAV server:', error);
    }
}
