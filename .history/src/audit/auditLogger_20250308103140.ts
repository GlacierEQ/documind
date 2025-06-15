/**
 * Enterprise Audit Logging System
 * Comprehensive audit trail for compliance and security
 */

import { getConnection } from '../database/connection';
import { logger } from '../utils/logger';

// Audit event categories
export enum AuditCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  DOCUMENT = 'document',
  FOLDER = 'folder',
  USER = 'user',
  ADMIN = 'admin',
  SYSTEM = 'system',
  API = 'api',
  SECURITY = 'security',
  DATA = 'data'
}

// Audit event types
export enum AuditAction {
  // Authentication/Authorization
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  PASSWORD_CHANGE = 'password_change',
  TOKEN_ISSUED = 'token_issued',
  TOKEN_REVOKED = 'token_revoked',
  PERMISSION_DENIED = 'permission_denied',
  
  // Document actions
  DOCUMENT_VIEW = 'document_view',
  DOCUMENT_CREATE = 'document_create',
  DOCUMENT_UPDATE = 'document_update',
  DOCUMENT_DELETE = 'document_delete',
  DOCUMENT_SHARE = 'document_share',
  DOCUMENT_UNSHARE = 'document_unshare',
  DOCUMENT_DOWNLOAD = 'document_download',
  DOCUMENT_PRINT = 'document_print',
  DOCUMENT_OCR = 'document_ocr',
  DOCUMENT_AI_PROCESS = 'document_ai_process',
  
  // Folder actions
  FOLDER_CREATE = 'folder_create',
  FOLDER_UPDATE = 'folder_update',
  FOLDER_DELETE = 'folder_delete',
  FOLDER_SHARE = 'folder_share',
  FOLDER_UNSHARE = 'folder_unshare',
  
  // User actions
  USER_CREATE = 'user_create',
  USER_UPDATE = 'user_update',
  USER_DELETE = 'user_delete',
  USER_ROLE_CHANGE = 'user_role_change',
  
  // Admin actions
  SETTING_CHANGE = 'setting_change',
  SYSTEM_CONFIG = 'system_config',
  MAINTENANCE = 'maintenance',
  
  // System events
  SYSTEM_STARTUP = 'system_startup',
  SYSTEM_SHUTDOWN = 'system_shutdown',
  BACKUP_CREATE = 'backup_create',
  BACKUP_RESTORE = 'backup_restore',
  SCHEDULED_TASK = 'scheduled_task',
  
  // API actions
  API_KEY_ISSUED = 'api_key_issued',
  API_KEY_REVOKED = 'api_key_revoked',
  API_REQUEST = 'api_request',
  
  // Security events
  SECURITY_ALERT = 'security_alert',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  
  // Data actions
  DATA_EXPORT = 'data_export',
  DATA_IMPORT = 'data_import'
}

// Audit log severity levels
export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

// Audit log entry interface
export interface AuditLogEntry {
  userId?: number;
  username?: string;
  ipAddress?: string;
  userAgent?: string;
  category: AuditCategory;
  action: AuditAction;
  resourceType?: string;
  resourceId?: number | string;
  details?: Record<string, any>;
  severity: AuditSeverity;
  timestamp?: Date;
  sessionId?: string;
  status?: 'success' | 'failure';
}

/**
 * Log an audit event
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const db = getConnection();
    const timestamp = entry.timestamp || new Date();
    
    // Insert audit record
    await db.query(
      `INSERT INTO audit_logs
       (user_id, username, ip_address, user_agent, category, action, resource_type, 
        resource_id, details, severity, timestamp, session_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.userId || null,
        entry.username || null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.category,
        entry.action,
        entry.resourceType || null,
        entry.resourceId || null,
        JSON.stringify(entry.details || {}),
        entry.severity,
        timestamp,
        entry.sessionId || null,
        entry.status || 'success'
      ]
    );
    
    // For critical events, also log to system logger
    if (entry.severity === AuditSeverity.CRITICAL) {
      logger.warn(`CRITICAL AUDIT EVENT: [${entry.category}] ${entry.action} - User: ${entry.userId || 'unknown'}, Resource: ${entry.resourceType || ''}:${entry.resourceId || ''}`);
    }
  } catch (error) {
    // Log to system logger if audit logging fails
    logger.error('Failed to write audit log:', error);
    logger.error('Audit event details:', JSON.stringify(entry));
  }
}

/**
 * Express middleware to audit API requests
 */
export function auditApiRequest(category: AuditCategory = AuditCategory.API) {
  return (req, res, next) => {
    const originalEnd = res.end;
    const requestStartTime = Date.now();
    
    // Override end method to capture response
    res.end = function(chunk, encoding) {
      // Restore original end method
      res.end = originalEnd;
      
      // Calculate request duration
      const requestDuration = Date.now() - requestStartTime;
      
      // Build audit entry
      const userId = (req.user as any)?.id;
      const username = (req.user as any)?.username;
      
      // Determine action from request
      let action = AuditAction.API_REQUEST;
      let resourceType = req.baseUrl.split('/').pop() || 'unknown';
      let resourceId = undefined;
      
      // Try to determine the specific action and resource
      if (req.method === 'GET') {
        action = `${resourceType}_view` as AuditAction;
        resourceId = req.params.id;
      } else if (req.method === 'POST') {
        action = `${resourceType}_create` as AuditAction;
      } else if (req.method === 'PUT' || req.method === 'PATCH') {
        action = `${resourceType}_update` as AuditAction;
        resourceId = req.params.id;
      } else if (req.method === 'DELETE') {
        action = `${resourceType}_delete` as AuditAction;
        resourceId = req.params.id;
      }
      
      // Determine severity based on response status
      let severity = AuditSeverity.INFO;
      if (res.statusCode >= 400 && res.statusCode < 500) {
        severity = AuditSeverity.WARNING;
      } else if (res.statusCode >= 500) {
        severity = AuditSeverity.ERROR;
      }
      
      // Log audit event
      logAuditEvent({
        userId,
        username,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        category: category,
        action: action,
        resourceType: resourceType,
        resourceId: resourceId,
        details: {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          requestDuration: `${requestDuration}ms`,
          query: req.query,
          // Don't log full body for security, but log structure
          requestBodyKeys: req.body ? Object.keys(req.body) : undefined
        },
        severity: severity,
        sessionId: req.sessionID,
        status: res.statusCode < 400 ? 'success' : 'failure'
      }).catch(err => {
        logger.error('Failed to log audit event for API request:', err);
      });
      
      // Call original end method
      return originalEnd.apply(res, arguments);
    };
    
    next();
  };
}
