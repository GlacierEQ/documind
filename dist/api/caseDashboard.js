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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.caseDashboardRouter = void 0;
const express_1 = __importDefault(require("express"));
const connection_1 = require("../database/connection");
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
const deadlineTracker_1 = require("../case/deadlineTracker");
exports.caseDashboardRouter = express_1.default.Router();
// Get case dashboard summary
exports.caseDashboardRouter.get('/summary', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('case-dashboard-summary');
        const db = (0, connection_1.getConnection)();
        const userId = req.user.id;
        // Get document count
        const docCountResult = await db.query(`
      SELECT COUNT(*) as total
      FROM documents d
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.case_related = 1
    `, [userId, userId]);
        const documentCount = docCountResult[0].total || 0;
        // Get entity count
        const entityCountResult = await db.query(`
      SELECT COUNT(*) as total
      FROM case_entities e
      WHERE e.id IN (
        SELECT DISTINCT de.entity_id
        FROM document_entities de
        JOIN documents d ON de.document_id = d.id
        WHERE (d.uploaded_by = ? OR d.id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        ))
      )
    `, [userId, userId]);
        const entityCount = entityCountResult[0].total || 0;
        // Get upcoming deadlines
        const deadlines = await (0, deadlineTracker_1.getUpcomingDeadlines)(14); // Get deadlines for next 14 days
        // Get top entities by importance
        const topEntities = await db.query(`
      SELECT e.id, e.name, e.type, e.importance, COUNT(de.document_id) as document_count
      FROM case_entities e
      JOIN document_entities de ON e.id = de.entity_id
      JOIN documents d ON de.document_id = d.id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      GROUP BY e.id
      ORDER BY e.importance DESC, document_count DESC
      LIMIT 10
    `, [userId, userId]);
        // Get recent documents
        const recentDocuments = await db.query(`
      SELECT d.id, d.name, d.uploaded_at, d.size,
        (SELECT COUNT(*) FROM document_entities WHERE document_id = d.id) as entity_count
      FROM documents d
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.case_related = 1
      ORDER BY d.uploaded_at DESC
      LIMIT 5
    `, [userId, userId]);
        // Get document types distribution
        const documentTypes = await db.query(`
      SELECT 
        CASE 
          WHEN mime_type LIKE '%pdf%' THEN 'PDF'
          WHEN mime_type LIKE '%doc%' THEN 'Word'
          WHEN mime_type LIKE '%xls%' THEN 'Excel'
          WHEN mime_type LIKE '%image%' THEN 'Image'
          ELSE 'Other'
        END as type,
        COUNT(*) as count
      FROM documents d
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.case_related = 1
      GROUP BY type
    `, [userId, userId]);
        // Get document timeline - documents added over time
        const timelineQuery = `
      SELECT 
        DATE_FORMAT(uploaded_at, '%Y-%m-01') as month,
        COUNT(*) as document_count
      FROM documents d
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.case_related = 1
      GROUP BY month
      ORDER BY month ASC
      LIMIT 12
    `;
        const documentTimeline = await db.query(timelineQuery, [userId, userId]);
        // Calculate case progress metrics
        const caseProgress = {
            documentsAnalyzed: documentCount,
            entitiesIdentified: entityCount,
            upcomingDeadlines: deadlines.length,
            completionPercentage: Math.min(Math.round((documentCount * 15) / 100), 100) // Simple estimate
        };
        const result = {
            documentCount,
            entityCount,
            deadlines,
            topEntities,
            recentDocuments,
            documentTypes,
            documentTimeline,
            caseProgress
        };
        logger_1.logger.info(`Generated case dashboard summary in ${perfEnd()}ms`);
        res.json(result);
    }
    catch (error) {
        logger_1.logger.error('Error generating case dashboard summary:', error);
        res.status(500).json({ error: 'Failed to generate dashboard summary' });
    }
});
// Get case timeline events
exports.caseDashboardRouter.get('/timeline', auth_1.isAuthenticated, async (req, res) => {
    try {
        const days = parseInt(req.query.days || '365');
        const db = (0, connection_1.getConnection)();
        const userId = req.user.id;
        // Get timeline events
        const eventsQuery = `
      SELECT te.*, d.name as document_name
      FROM timeline_events te
      JOIN documents d ON te.document_id = d.id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      ORDER BY te.event_date ASC
    `;
        const events = await db.query(eventsQuery, [userId, userId]);
        // Get relevant entities
        const entitiesQuery = `
      SELECT e.name, e.type, COUNT(de.document_id) as occurrences
      FROM case_entities e
      JOIN document_entities de ON e.id = de.entity_id
      JOIN documents d ON de.document_id = d.id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      GROUP BY e.id
      HAVING occurrences > 1
      ORDER BY occurrences DESC
      LIMIT 20
    `;
        const entities = await db.query(entitiesQuery, [userId, userId]);
        res.json({ events, entities });
    }
    catch (error) {
        logger_1.logger.error('Error fetching case timeline:', error);
        res.status(500).json({ error: 'Failed to fetch case timeline' });
    }
});
// Scan documents for timeline events
exports.caseDashboardRouter.post('/scan-documents-for-events', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        const userId = req.user.id;
        // Get case-related documents
        const documents = await db.query(`
      SELECT d.id, i.text_content
      FROM documents d
      LEFT JOIN document_index i ON d.id = i.document_id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.case_related = 1
    `, [userId, userId]);
        let eventsExtracted = 0;
        // Process each document to extract events
        for (const doc of documents) {
            if (!doc.text_content)
                continue;
            // Import dynamically to avoid circular dependencies
            const { extractTimelineFromDocument } = await Promise.resolve().then(() => __importStar(require('../case/timelineExtractor')));
            const events = await extractTimelineFromDocument(doc.id, doc.text_content);
            eventsExtracted += events.length;
        }
        res.json({
            success: true,
            documentsProcessed: documents.length,
            eventsExtracted
        });
    }
    catch (error) {
        logger_1.logger.error('Error scanning documents for events:', error);
        res.status(500).json({ error: 'Failed to scan documents' });
    }
});
// Get document similarity analysis
exports.caseDashboardRouter.get('/document-similarity/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const documentId = parseInt(req.params.id);
        const userId = req.user.id;
        const db = (0, connection_1.getConnection)();
        // Check if user has access to the document
        const docAccess = await db.query(`
      SELECT COUNT(*) as count
      FROM documents d
      WHERE d.id = ? AND (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
    `, [documentId, userId, userId]);
        if (!docAccess[0]?.count) {
            return res.status(403).json({ error: 'Access denied to this document' });
        }
        // Get similar documents based on shared entities
        const similarByEntities = await db.query(`
      SELECT 
        d.id, 
        d.name, 
        COUNT(DISTINCT de.entity_id) as shared_entities,
        GROUP_CONCAT(DISTINCT e.name SEPARATOR ', ') as entity_names
      FROM documents d
      JOIN document_entities de ON d.id = de.document_id
      JOIN case_entities e ON de.entity_id = e.id
      WHERE de.entity_id IN (
        SELECT entity_id FROM document_entities WHERE document_id = ?
      )
      AND d.id != ?
      AND (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      GROUP BY d.id
      ORDER BY shared_entities DESC
      LIMIT 7
    `, [documentId, documentId, userId, userId]);
        // Get documents with similar content (using references)
        const similarByReferences = await db.query(`
      SELECT 
        d.id, 
        d.name, 
        'Referenced directly' as relationship,
        dr.context,
        dr.confidence
      FROM document_references dr
      JOIN documents d ON dr.target_id = d.id 
      WHERE dr.source_id = ?
      
      UNION
      
      SELECT 
        d.id, 
        d.name, 
        'References this document' as relationship,
        dr.context,
        dr.confidence
      FROM document_references dr
      JOIN documents d ON dr.source_id = d.id
      WHERE dr.target_id = ?
      
      ORDER BY confidence DESC
      LIMIT 7
    `, [documentId, documentId]);
        // Get documents uploaded around same time
        const similarByTime = await db.query(`
      SELECT 
        d.id, 
        d.name, 
        d.uploaded_at, 
        ABS(TIMESTAMPDIFF(HOUR, d.uploaded_at, (
          SELECT uploaded_at FROM documents WHERE id = ?
        ))) as hours_difference
      FROM documents d
      WHERE d.id != ?
      AND d.case_related = 1
      AND (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      ORDER BY hours_difference ASC
      LIMIT 5
    `, [documentId, documentId, userId, userId]);
        res.json({
            similarByEntities,
            similarByReferences,
            similarByTime
        });
    }
    catch (error) {
        logger_1.logger.error(`Error analyzing document similarity for document ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to analyze document similarity' });
    }
});
// Get case insights
exports.caseDashboardRouter.get('/insights', auth_1.isAuthenticated, async (req, res) => {
    try {
        const db = (0, connection_1.getConnection)();
        const userId = req.user.id;
        // Get key entities by type
        const keyEntitiesByType = await db.query(`
      SELECT 
        e.type,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', e.id,
            'name', e.name,
            'importance', e.importance,
            'documentCount', COUNT(DISTINCT de.document_id)
          )
        ) as entities
      FROM case_entities e
      JOIN document_entities de ON e.id = de.entity_id
      JOIN documents d ON de.document_id = d.id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      GROUP BY e.type
      ORDER BY e.type
    `, [userId, userId]);
        // Get important connections between entities
        const entityConnections = await db.query(`
      WITH entity_pairs AS (
        SELECT 
          de1.entity_id as entity1_id,
          de2.entity_id as entity2_id,
          COUNT(DISTINCT de1.document_id) as shared_documents
        FROM document_entities de1
        JOIN document_entities de2 ON de1.document_id = de2.document_id AND de1.entity_id < de2.entity_id
        JOIN documents d ON de1.document_id = d.id
        WHERE (d.uploaded_by = ? OR d.id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        ))
        GROUP BY entity1_id, entity2_id
        HAVING shared_documents > 1
        ORDER BY shared_documents DESC
        LIMIT 20
      )
      SELECT 
        e1.id as entity1_id,
        e1.name as entity1_name,
        e1.type as entity1_type,
        e2.id as entity2_id,
        e2.name as entity2_name,
        e2.type as entity2_type,
        ep.shared_documents
      FROM entity_pairs ep
      JOIN case_entities e1 ON ep.entity1_id = e1.id
      JOIN case_entities e2 ON ep.entity2_id = e2.id
      ORDER BY ep.shared_documents DESC
    `, [userId, userId]);
        // Get key dates in case
        const keyDates = await db.query(`
      SELECT 
        te.event_date,
        te.event_type,
        COUNT(*) as event_count,
        GROUP_CONCAT(te.description SEPARATOR ' | ') as descriptions
      FROM timeline_events te
      JOIN documents d ON te.document_id = d.id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      GROUP BY DATE(te.event_date), te.event_type
      ORDER BY event_count DESC, te.event_date
      LIMIT 10
    `, [userId, userId]);
        // Get case activity by document type
        const activityByDocType = await db.query(`
      SELECT 
        CASE 
          WHEN mime_type LIKE '%pdf%' THEN 'PDF'
          WHEN mime_type LIKE '%doc%' THEN 'Word'
          WHEN mime_type LIKE '%xls%' THEN 'Excel'
          WHEN mime_type LIKE '%image%' THEN 'Image'
          ELSE 'Other'
        END as type,
        DATE_FORMAT(uploaded_at, '%Y-%m') as month,
        COUNT(*) as count
      FROM documents d
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.case_related = 1
      AND d.uploaded_at > DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY type, month
      ORDER BY month, type
    `, [userId, userId]);
        res.json({
            keyEntitiesByType,
            entityConnections,
            keyDates,
            activityByDocType
        });
    }
    catch (error) {
        logger_1.logger.error('Error generating case insights:', error);
        res.status(500).json({ error: 'Failed to generate case insights' });
    }
});
