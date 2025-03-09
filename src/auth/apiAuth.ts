/**
 * API Authentication Module
 * Handles API key authentication and management
 */

import { Request, Response, NextFunction } from 'express';
import { getConnection } from '../database/connection';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { AuditAction, AuditCategory, logAuditEvent, AuditSeverity } from '../audit/auditLogger';

/**
 * API key authentication middleware
 * Accepts either API key or session authentication
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // Skip if already authenticated via session
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  try {
    // Check for API key in header
    const apiKey = req.header('X-API-KEY');
    if (!apiKey) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }
    
    // Verify API key
    const user = await getUserByApiKey(apiKey);
    if (!user) {
      // Log failed auth attempt
      logAuditEvent({
        category: AuditCategory.AUTHENTICATION,
        action: AuditAction.API_REQUEST,
        details: { 
          failedAuth: true,
          endpoint: req.originalUrl
        },
        severity: AuditSeverity.WARNING,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key'
        }
      });
    }
    
    // Update last used timestamp
    await updateApiKeyUsage(apiKey);
    
    // Set user object on request
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isApiRequest: true
    };
    
    next();
  } catch (error) {
    logger.error('API key authentication error:', error);
    return res.status(500).json({
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication error'
      }
    });
  }
}

/**
 * Get user by API key
 */
async function getUserByApiKey(apiKey: string) {
  const db = getConnection();
  
  try {
    const keys = await db.query(`
      SELECT k.*, u.id as user_id, u.username, u.email, u.role
      FROM api_keys k
      JOIN users u ON k.user_id = u.id
      WHERE k.key_value = ?
      AND k.revoked = 0
      AND (k.expires_at IS NULL OR k.expires_at > ?)
    `, [apiKey, new Date()]);
    
    if (keys && keys.length > 0) {
      return {
        id: keys[0].user_id,
        username: keys[0].username,
        email: keys[0].email,
        role: keys[0].role,
        keyId: keys[0].id
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Error fetching API key:', error);
    return null;
  }
}

/**
 * Update API key last used timestamp
 */
async function updateApiKeyUsage(apiKey: string) {
  const db = getConnection();
  
  try {
    await db.query(
      'UPDATE api_keys SET last_used = ? WHERE key_value = ?',
      [new Date(), apiKey]
    );
  } catch (error) {
    logger.error('Error updating API key usage:', error);
  }
}

/**
 * Generate a new API key for a user
 */
export async function generateApiKey(
  userId: number,
  name: string,
  expiresAt?: Date,
  scopes?: string[]
): Promise<string | null> {
  const db = getConnection();
  const apiKey = uuidv4().replace(/-/g, '');
  const scopesJson = scopes ? JSON.stringify(scopes) : null;
  
  try {
    await db.query(
      `INSERT INTO api_keys 
       (user_id, name, key_value, created_at, expires_at, scopes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, name, apiKey, new Date(), expiresAt || null, scopesJson]
    );
    
    // Log key creation
    logAuditEvent({
      userId,
      category: AuditCategory.API,
      action: AuditAction.API_KEY_ISSUED,
      details: { name, expiresAt, scopes },
      severity: AuditSeverity.INFO
    });
    
    return apiKey;
  } catch (error) {
    logger.error('Error generating API key:', error);
    return null;
  }
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId: number, userId: number): Promise<boolean> {
  const db = getConnection();
  
  try {
    // Check if key belongs to user
    const keys = await db.query(
      'SELECT * FROM api_keys WHERE id = ? AND user_id = ?',
      [keyId, userId]
    );
    
    if (!keys || keys.length === 0) {
      return false;
    }
    
    // Revoke the key
    await db.query(
      'UPDATE api_keys SET revoked = 1, revoked_at = ? WHERE id = ?',
      [new Date(), keyId]
    );
    
    // Log key revocation
    logAuditEvent({
      userId,
      category: AuditCategory.API,
      action: AuditAction.API_KEY_REVOKED,
      details: { keyId, keyName: keys[0].name },
      severity: AuditSeverity.INFO
    });
    
    return true;
  } catch (error) {
    logger.error('Error revoking API key:', error);
    return false;
  }
}

/**
 * List API keys for a user
 */
export async function listApiKeys(userId: number) {
  const db = getConnection();
  
  try {
    return await db.query(
      `SELECT id, name, created_at, last_used, expires_at, revoked, revoked_at, scopes
       FROM api_keys
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
  } catch (error) {
    logger.error('Error listing API keys:', error);
    return [];
  }
}
