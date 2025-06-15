"use strict";
/**
 * Enterprise Audit Logging System
 * Comprehensive audit trail for compliance and security
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditSeverity = exports.AuditAction = exports.AuditCategory = void 0;
exports.logAuditEvent = logAuditEvent;
exports.auditApiRequest = auditApiRequest;
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
// Audit event categories
var AuditCategory;
(function (AuditCategory) {
    AuditCategory["AUTHENTICATION"] = "authentication";
    AuditCategory["AUTHORIZATION"] = "authorization";
    AuditCategory["DOCUMENT"] = "document";
    AuditCategory["FOLDER"] = "folder";
    AuditCategory["USER"] = "user";
    AuditCategory["ADMIN"] = "admin";
    AuditCategory["SYSTEM"] = "system";
    AuditCategory["API"] = "api";
    AuditCategory["SECURITY"] = "security";
    AuditCategory["DATA"] = "data";
})(AuditCategory || (exports.AuditCategory = AuditCategory = {}));
// Audit event types
var AuditAction;
(function (AuditAction) {
    // Authentication/Authorization
    AuditAction["LOGIN"] = "login";
    AuditAction["LOGOUT"] = "logout";
    AuditAction["LOGIN_FAILED"] = "login_failed";
    AuditAction["PASSWORD_CHANGE"] = "password_change";
    AuditAction["TOKEN_ISSUED"] = "token_issued";
    AuditAction["TOKEN_REVOKED"] = "token_revoked";
    AuditAction["PERMISSION_DENIED"] = "permission_denied";
    // Document actions
    AuditAction["DOCUMENT_VIEW"] = "document_view";
    AuditAction["DOCUMENT_CREATE"] = "document_create";
    AuditAction["DOCUMENT_UPDATE"] = "document_update";
    AuditAction["DOCUMENT_DELETE"] = "document_delete";
    AuditAction["DOCUMENT_SHARE"] = "document_share";
    AuditAction["DOCUMENT_UNSHARE"] = "document_unshare";
    AuditAction["DOCUMENT_DOWNLOAD"] = "document_download";
    AuditAction["DOCUMENT_PRINT"] = "document_print";
    AuditAction["DOCUMENT_OCR"] = "document_ocr";
    AuditAction["DOCUMENT_AI_PROCESS"] = "document_ai_process";
    // Folder actions
    AuditAction["FOLDER_CREATE"] = "folder_create";
    AuditAction["FOLDER_UPDATE"] = "folder_update";
    AuditAction["FOLDER_DELETE"] = "folder_delete";
    AuditAction["FOLDER_SHARE"] = "folder_share";
    AuditAction["FOLDER_UNSHARE"] = "folder_unshare";
    // User actions
    AuditAction["USER_CREATE"] = "user_create";
    AuditAction["USER_UPDATE"] = "user_update";
    AuditAction["USER_DELETE"] = "user_delete";
    AuditAction["USER_ROLE_CHANGE"] = "user_role_change";
    // Admin actions
    AuditAction["SETTING_CHANGE"] = "setting_change";
    AuditAction["SYSTEM_CONFIG"] = "system_config";
    AuditAction["MAINTENANCE"] = "maintenance";
    // System events
    AuditAction["SYSTEM_STARTUP"] = "system_startup";
    AuditAction["SYSTEM_SHUTDOWN"] = "system_shutdown";
    AuditAction["BACKUP_CREATE"] = "backup_create";
    AuditAction["BACKUP_RESTORE"] = "backup_restore";
    AuditAction["SCHEDULED_TASK"] = "scheduled_task";
    // API actions
    AuditAction["API_KEY_ISSUED"] = "api_key_issued";
    AuditAction["API_KEY_REVOKED"] = "api_key_revoked";
    AuditAction["API_REQUEST"] = "api_request";
    // Security events
    AuditAction["SECURITY_ALERT"] = "security_alert";
    AuditAction["SUSPICIOUS_ACTIVITY"] = "suspicious_activity";
    // Data actions
    AuditAction["DATA_EXPORT"] = "data_export";
    AuditAction["DATA_IMPORT"] = "data_import";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
// Audit log severity levels
var AuditSeverity;
(function (AuditSeverity) {
    AuditSeverity["INFO"] = "info";
    AuditSeverity["WARNING"] = "warning";
    AuditSeverity["ERROR"] = "error";
    AuditSeverity["CRITICAL"] = "critical";
})(AuditSeverity || (exports.AuditSeverity = AuditSeverity = {}));
/**
 * Log an audit event
 */
async function logAuditEvent(entry) {
    try {
        const db = (0, connection_1.getConnection)();
        const timestamp = entry.timestamp || new Date();
        // Insert audit record
        await db.query(`INSERT INTO audit_logs
       (user_id, username, ip_address, user_agent, category, action, resource_type, 
        resource_id, details, severity, timestamp, session_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
        ]);
        // For critical events, also log to system logger
        if (entry.severity === AuditSeverity.CRITICAL) {
            logger_1.logger.warn(`CRITICAL AUDIT EVENT: [${entry.category}] ${entry.action} - User: ${entry.userId || 'unknown'}, Resource: ${entry.resourceType || ''}:${entry.resourceId || ''}`);
        }
    }
    catch (error) {
        // Log to system logger if audit logging fails
        logger_1.logger.error('Failed to write audit log:', error);
        logger_1.logger.error('Audit event details:', JSON.stringify(entry));
    }
}
/**
 * Express middleware to audit API requests
 */
function auditApiRequest(category = AuditCategory.API) {
    return (req, res, next) => {
        const originalEnd = res.end;
        const requestStartTime = Date.now();
        // Override end method to capture response
        res.end = function (chunk, encoding) {
            // Restore original end method
            res.end = originalEnd;
            // Calculate request duration
            const requestDuration = Date.now() - requestStartTime;
            // Build audit entry
            const userId = req.user?.id;
            const username = req.user?.username;
            // Determine action from request
            let action = AuditAction.API_REQUEST;
            let resourceType = req.baseUrl.split('/').pop() || 'unknown';
            let resourceId = undefined;
            // Try to determine the specific action and resource
            if (req.method === 'GET') {
                action = `${resourceType}_view`;
                resourceId = req.params.id;
            }
            else if (req.method === 'POST') {
                action = `${resourceType}_create`;
            }
            else if (req.method === 'PUT' || req.method === 'PATCH') {
                action = `${resourceType}_update`;
                resourceId = req.params.id;
            }
            else if (req.method === 'DELETE') {
                action = `${resourceType}_delete`;
                resourceId = req.params.id;
            }
            // Determine severity based on response status
            let severity = AuditSeverity.INFO;
            if (res.statusCode >= 400 && res.statusCode < 500) {
                severity = AuditSeverity.WARNING;
            }
            else if (res.statusCode >= 500) {
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
                logger_1.logger.error('Failed to log audit event for API request:', err);
            });
            // Call original end method
            return originalEnd.apply(res, arguments);
        };
        next();
    };
}
