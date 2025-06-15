/**
 * OpenAPI Gateway Router
 * Provides a fully documented REST API for programmatic access to Documind
 */

import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { generateSpec } from './specGenerator';
import { isAuthenticated } from '../../auth/auth';
import { requirePermission } from '../../auth/rbac';
import { PermissionType, ResourceType } from '../../auth/rbac';
import { apiKeyAuth } from '../../auth/apiAuth';
import { AuditAction, AuditCategory, logAuditEvent } from '../../audit/auditLogger';
import { logger } from '../../utils/logger';

export const openApiRouter = express.Router();

// Generate OpenAPI specification
const openApiSpec = generateSpec();

// Serve Swagger UI documentation
openApiRouter.use('/docs', swaggerUi.serve);
openApiRouter.get('/docs', swaggerUi.setup(openApiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Documind API Documentation',
  customfavIcon: '/favicon.ico'
}));

// Serve OpenAPI spec as JSON
openApiRouter.get('/spec', (req, res) => {
  res.json(openApiSpec);
});

// API Health Check
openApiRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Version endpoint
openApiRouter.get('/version', (req, res) => {
  res.json({
    version: process.env.npm_package_version || '1.0.0',
    apiVersion: 'v1',
    build: process.env.BUILD_ID || 'development'
  });
});

// Document Operations
// GET /api/v1/documents - List documents
openApiRouter.get('/documents', apiKeyAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    
    // Query params for filtering
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const folder = req.query.folder ? parseInt(req.query.folder as string) : undefined;
    const search = req.query.search as string;
    const type = req.query.type as string;
    const sortBy = req.query.sortBy as string || 'uploaded_at';
    const sortDir = req.query.sortDir as string || 'desc';
    
    // Import and use the documents module
    const { getDocuments } = await import('../documents');
    const documents = await getDocuments({
      userId,
      limit,
      offset,
      folderId: folder,
      searchQuery: search,
      documentType: type,
      sortBy,
      sortDir
    });
    
    // Audit the request
    logAuditEvent({
      userId,
      category: AuditCategory.API,
      action: AuditAction.API_REQUEST,
      resourceType: 'documents',
      details: { method: 'GET', params: req.query },
      severity: 'info'
    });
    
    res.json({
      data: documents.items,
      pagination: {
        total: documents.total,
        limit,
        offset,
        hasMore: offset + documents.items.length < documents.total
      }
    });
  } catch (error) {
    logger.error('API error in GET /documents:', error);
    res.status(500).json({ error: 'Failed to retrieve documents' });
  }
});

// GET /api/v1/documents/:id - Get document details
openApiRouter.get('/documents/:id', apiKeyAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const documentId = parseInt(req.params.id);
    
    // Import and use the document module
    const { getDocument } = await import('../documents');
    const document = await getDocument(documentId, userId);
    
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Audit the request
    logAuditEvent({
      userId,
      category: AuditCategory.API,
      action: AuditAction.API_REQUEST,
      resourceType: 'documents',
      resourceId: documentId,
      details: { method: 'GET' },
      severity: 'info'
    });
    
    res.json({ data: document });
  } catch (error) {
    logger.error(`API error in GET /documents/${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// POST /api/v1/documents - Upload document
openApiRouter.post('/documents', apiKeyAuth, requirePermission(
  PermissionType.CREATE, 
  ResourceType.DOCUMENT
), async (req, res) => {
  try {
    // Handle document upload here
    // This would typically involve multipart handling
    res.status(501).json({ error: 'Document upload via API is not yet implemented' });
  } catch (error) {
    logger.error('API error in POST /documents:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Rate limiting middleware
openApiRouter.use((req, res, next) => {
  // Apply rate limiting logic based on user or API key
  // This would typically check a counter in Redis or another data store
  next();
});

// Error handler
openApiRouter.use((err, req, res, next) => {
  logger.error('API Gateway error:', err);
  
  // Standardized error response
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'production' ? undefined : err.stack
    }
  });
});

export default openApiRouter;
