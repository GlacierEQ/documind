import { getConnection } from './connection';
import { logger } from '../utils/logger';
import { loadConfig } from '../config/config';

/**
 * Initialize database schema
 */
export async function initializeSchema(): Promise<void> {
    logger.info('Initializing database schema...');
    const config = loadConfig();

    try {
        const db = getConnection();

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

        // Create admin user if none exists
        const users = await db.query('SELECT COUNT(*) as count FROM users');
        if (users[0].count === 0) {
            logger.info('Creating default admin user...');

            const bcrypt = await import('bcrypt');
            const defaultPassword = 'admin123'; // Should be changed immediately
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);

            await db.query(`
                INSERT INTO users (username, password, email, displayName, role)
                VALUES (?, ?, ?, ?, ?)
            `, ['admin', hashedPassword, 'admin@documind.local', 'Administrator', 'admin']);

            logger.info('Default admin user created. Username: admin, Password: admin123');
        }

        logger.info('Database schema initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize database schema:', error);
        throw error;
    }
}
