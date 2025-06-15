/**
 * Database Migration System with Versioning
 * Supports multiple database types and schema versioning
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getConnection } from '../connection';
import { logger, performance } from '../../utils/logger';

interface MigrationFile {
  id: number;
  name: string;
  path: string;
}

/**
 * Run database migrations to bring schema up to current version
 */
export async function runMigrations(): Promise<void> {
  const perfEnd = performance.start('db-migrations');
  logger.info('Checking database migrations...');
  
  try {
    const db = getConnection();
    const dbType = process.env.DB_TYPE || 'sqlite';
    
    // Ensure migrations table exists
    await ensureMigrationsTable(db);
    
    // Get applied migrations
    const appliedMigrations = await db.query('SELECT id, name FROM migrations ORDER BY id ASC');
    const appliedIds = new Set(appliedMigrations.map(m => m.id));
    
    // Get available migration files
    const migrationsDir = path.join(__dirname, dbType);
    const availableMigrations = await loadMigrationFiles(migrationsDir);
    
    // Filter migrations that need to be applied
    const pendingMigrations = availableMigrations.filter(m => !appliedIds.has(m.id));
    
    if (pendingMigrations.length === 0) {
      logger.info(`Database schema is up to date (${appliedMigrations.length} migrations applied)`);
      return;
    }
    
    logger.info(`Found ${pendingMigrations.length} pending database migrations`);
    
    // Apply pending migrations in a transaction
    await db.beginTransaction();
    
    try {
      for (const migration of pendingMigrations) {
        const migrationPerfEnd = performance.start(`migration-${migration.id}`);
        
        logger.info(`Applying migration ${migration.id}: ${migration.name}...`);
        
        // Load and execute migration
        const sql = await fs.readFile(migration.path, 'utf8');
        const statements = sql.split(';').filter(s => s.trim().length > 0);
        
        for (const statement of statements) {
          await db.query(statement);
        }
        
        // Record migration as applied
        await db.query(
          'INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)',
          [migration.id, migration.name, new Date()]
        );
        
        logger.info(`Migration ${migration.id} completed in ${migrationPerfEnd()}ms`);
      }
      
      await db.commit();
      logger.info(`Successfully applied ${pendingMigrations.length} migrations in ${perfEnd()}ms`);
    } catch (error) {
      await db.rollback();
      logger.error('Error applying migrations:', error);
      throw new Error(`Migration failed: ${error.message}`);
    }
  } catch (error) {
    logger.error('Database migration system failed:', error);
    throw error;
  }
}

/**
 * Create migrations table if it doesn't exist
 */
async function ensureMigrationsTable(db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP NOT NULL
    )
  `);
}

/**
 * Load migration files from directory
 */
async function loadMigrationFiles(directory: string): Promise<MigrationFile[]> {
  try {
    // Ensure migrations directory exists
    try {
      await fs.access(directory);
    } catch {
      await fs.mkdir(directory, { recursive: true });
      return []; // No migrations yet
    }
    
    // Read migration files
    const files = await fs.readdir(directory);
    const migrationFiles: MigrationFile[] = [];
    
    // Parse migration filenames (format: 001_create_users_table.sql)
    for (const file of files) {
      if (file.endsWith('.sql')) {
        const match = file.match(/^(\d+)_(.+)\.sql$/);
        if (match) {
          const id = parseInt(match[1], 10);
          const name = match[2].replace(/_/g, ' ');
          migrationFiles.push({
            id,
            name,
            path: path.join(directory, file)
          });
        }
      }
    }
    
    // Sort by ID
    return migrationFiles.sort((a, b) => a.id - b.id);
  } catch (error) {
    logger.error(`Failed to load migration files from ${directory}:`, error);
    throw error;
  }
}
