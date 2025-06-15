"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSchema = initializeSchema;
const connection_1 = require("./connection");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
/**
 * Initialize database schema
 */
async function initializeSchema() {
    logger_1.logger.info('Initializing database schema...');
    const config = (0, config_1.loadConfig)();
    try {
        const db = (0, connection_1.getConnection)();
        // Create users table
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                username VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255),
                email VARCHAR(255) NOT NULL,
                displayName VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP NULL
            )
        `);
        // Create documents table
        await db.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                name VARCHAR(255) NOT NULL,
                description TEXT,
                path VARCHAR(1024) NOT NULL,
                size BIGINT NOT NULL,
                mime_type VARCHAR(255) NOT NULL,
                uploaded_by INTEGER NOT NULL,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                tags TEXT DEFAULT '[]',
                indexed BOOLEAN DEFAULT FALSE,
                indexed_at TIMESTAMP NULL,
                FOREIGN KEY (uploaded_by) REFERENCES users(id)
            )
        `);
        // Create document_terms table for search indexing
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_terms (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                document_id INTEGER NOT NULL,
                term VARCHAR(255) NOT NULL,
                frequency INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
            )
        `);
        // Create folders table
        await db.query(`
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                name VARCHAR(255) NOT NULL,
                parent_id INTEGER NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);
        // Create document_folders table for organizing documents
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_folders (
                document_id INTEGER NOT NULL,
                folder_id INTEGER NOT NULL,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (document_id, folder_id),
                FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
                FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
            )
        `);
        // Create document_shares table for document sharing
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_shares (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                document_id INTEGER NOT NULL,
                shared_by INTEGER NOT NULL,
                shared_with INTEGER NOT NULL,
                permission VARCHAR(50) NOT NULL DEFAULT 'read', -- read, edit, admin
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NULL,
                FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
                FOREIGN KEY (shared_by) REFERENCES users(id),
                FOREIGN KEY (shared_with) REFERENCES users(id)
            )
        `);
        // Create activity_log table for audit trail
        await db.query(`
            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                user_id INTEGER NOT NULL,
                action VARCHAR(50) NOT NULL,
                entity_type VARCHAR(50) NOT NULL,
                entity_id INTEGER NOT NULL,
                details TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        // Create annotation table for PDF annotations
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_annotations (
                document_id INTEGER NOT NULL,
                user_id INTEGER,
                annotations TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME,
                PRIMARY KEY (document_id, user_id),
                FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
            )
        `);
        // Create document versions table for version control
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                version_path TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at DATETIME NOT NULL,
                notes TEXT,
                FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
            )
        `);
        // Create AI process table to track AI processing status
        await db.query(`
            CREATE TABLE IF NOT EXISTS ai_processes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                process_type TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at DATETIME NOT NULL,
                completed_at DATETIME,
                error TEXT,
                FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
            )
        `);
        // Create document templates table
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_templates (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                name TEXT NOT NULL,
                description TEXT,
                content TEXT NOT NULL,
                category TEXT,
                thumbnail TEXT,
                created_by INTEGER,
                created_at DATETIME,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);
        // Create document clusters table
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_clusters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                keywords TEXT,
                user_id INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        // Create cluster documents table
        await db.query(`
            CREATE TABLE IF NOT EXISTS cluster_documents (
                cluster_id TEXT NOT NULL,
                document_id INTEGER NOT NULL,
                similarity REAL NOT NULL,
                PRIMARY KEY (cluster_id, document_id),
                FOREIGN KEY (cluster_id) REFERENCES document_clusters(id),
                FOREIGN KEY (document_id) REFERENCES documents(id)
            )
        `);
        // Legal database integration tables
        await db.query(`
            CREATE TABLE IF NOT EXISTS legal_document_cache (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                external_id TEXT NOT NULL,
                source TEXT NOT NULL,
                title TEXT,
                citation TEXT,
                court TEXT,
                date DATETIME,
                content TEXT,
                content_type TEXT DEFAULT 'text/html',
                metadata TEXT,
                retrieved_at DATETIME,
                UNIQUE(external_id, source)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS legal_references (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                document_id INTEGER NOT NULL,
                external_id TEXT NOT NULL,
                source TEXT NOT NULL,
                citation TEXT NOT NULL,
                context TEXT,
                added_by INTEGER NOT NULL,
                added_at DATETIME,
                FOREIGN KEY (document_id) REFERENCES documents(id),
                FOREIGN KEY (added_by) REFERENCES users(id)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS search_history (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                user_id INTEGER NOT NULL,
                query TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_retrieve_history (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                user_id INTEGER NOT NULL,
                external_id TEXT NOT NULL,
                source TEXT NOT NULL,
                retrieved_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        // Brief Assistant tables
        await db.query(`
            CREATE TABLE IF NOT EXISTS document_generation_history (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                user_id INTEGER NOT NULL,
                document_type TEXT NOT NULL,
                word_count INTEGER,
                jurisdiction TEXT,
                tone TEXT,
                created_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS section_generation_history (
                id INTEGER PRIMARY KEY ${config.database.driver === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
                user_id INTEGER NOT NULL,
                document_type TEXT NOT NULL,
                section_type TEXT NOT NULL,
                word_count INTEGER,
                tone TEXT,
                created_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        // Create admin user if none exists
        const users = await db.query('SELECT COUNT(*) as count FROM users');
        if (users[0].count === 0) {
            logger_1.logger.info('Creating default admin user...');
            const bcrypt = await Promise.resolve().then(() => __importStar(require('bcrypt')));
            const defaultPassword = 'admin123'; // Should be changed immediately
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            await db.query(`
                INSERT INTO users (username, password, email, displayName, role)
                VALUES (?, ?, ?, ?, ?)
            `, ['admin', hashedPassword, 'admin@documind.local', 'Administrator', 'admin']);
            logger_1.logger.info('Default admin user created. Username: admin, Password: admin123');
        }
        logger_1.logger.info('Database schema initialized successfully');
    }
    catch (error) {
        logger_1.logger.error('Failed to initialize database schema:', error);
        throw error;
    }
}
