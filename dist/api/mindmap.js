"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mindMapRouter = void 0;
const express_1 = __importDefault(require("express"));
const connection_1 = require("../database/connection");
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
exports.mindMapRouter = express_1.default.Router();
// Get entity graph data for mind map visualization
exports.mindMapRouter.get('/', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('mind-map-generation');
        const db = (0, connection_1.getConnection)();
        const userId = req.user.id;
        // Optional filters
        const entityType = req.query.entityType;
        const importance = parseInt(req.query.importance || '0');
        const documentId = parseInt(req.query.documentId || '0');
        // Build query conditions
        const conditions = [];
        const params = [];
        if (entityType) {
            conditions.push('e.type = ?');
            params.push(entityType);
        }
        if (importance > 0) {
            conditions.push('e.importance >= ?');
            params.push(importance);
        }
        // Get entities accessible to the user
        const entityQuery = `
      SELECT e.id, e.name, e.type, e.description, e.importance
      FROM case_entities e
      WHERE e.id IN (
        SELECT DISTINCT de.entity_id
        FROM document_entities de
        JOIN documents d ON de.document_id = d.id
        WHERE d.uploaded_by = ? OR d.id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        )
        ${documentId ? 'AND de.document_id = ?' : ''}
      )
      ${conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : ''}
      ORDER BY e.importance DESC
      LIMIT 100
    `;
        const entityParams = [userId, userId];
        if (documentId) {
            entityParams.push(documentId);
        }
        const entities = await db.query(entityQuery, [...entityParams, ...params]);
        // Map entities to nodes
        const nodes = entities.map((entity) => ({
            id: `entity_${entity.id}`,
            label: entity.name,
            title: `${entity.type} (Importance: ${entity.importance})`,
            group: entity.type,
            size: Math.min(25 + entity.importance * 2, 50),
            shape: getEntityShape(entity.type)
        }));
        // Get connections between entities (based on co-occurrence in documents)
        const edgeQuery = `
      SELECT 
        de1.entity_id as source_id, 
        de2.entity_id as target_id,
        COUNT(DISTINCT de1.document_id) as weight
      FROM document_entities de1
      JOIN document_entities de2 ON de1.document_id = de2.document_id AND de1.entity_id < de2.entity_id
      JOIN documents d ON de1.document_id = d.id
      WHERE de1.entity_id IN (${entities.map((e) => e.id).join(',')})
      AND de2.entity_id IN (${entities.map((e) => e.id).join(',')})
      AND (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      ${documentId ? 'AND de1.document_id = ? AND de2.document_id = ?' : ''}
      GROUP BY de1.entity_id, de2.entity_id
      HAVING weight > 0
    `;
        const edgeParams = [userId, userId];
        if (documentId) {
            edgeParams.push(documentId, documentId);
        }
        const connections = await db.query(edgeQuery, edgeParams);
        // Map connections to edges
        const edges = connections.map((conn) => ({
            id: `edge_${conn.source_id}_${conn.target_id}`,
            from: `entity_${conn.source_id}`,
            to: `entity_${conn.target_id}`,
            value: conn.weight,
            title: `${conn.weight} shared document(s)`,
            width: Math.max(1, Math.min(conn.weight, 10)),
            arrows: {
                to: {
                    enabled: false
                }
            }
        }));
        // Get documents associated with each entity
        const entityDocumentMap = {};
        for (const entity of entities) {
            const docQuery = `
        SELECT d.id, d.name, d.uploaded_at
        FROM documents d
        JOIN document_entities de ON d.id = de.document_id
        WHERE de.entity_id = ?
        AND (d.uploaded_by = ? OR d.id IN (
          SELECT document_id FROM document_shares WHERE shared_with = ?
        ))
        ORDER BY d.uploaded_at DESC
        LIMIT 10
      `;
            const docs = await db.query(docQuery, [entity.id, userId, userId]);
            entityDocumentMap[entity.id] = docs;
        }
        logger_1.logger.info(`Generated mind map data in ${perfEnd()}ms with ${nodes.length} nodes and ${edges.length} edges`);
        res.json({
            nodes,
            edges,
            entityDocumentMap,
            nodeSets: getNodeSets()
        });
    }
    catch (error) {
        logger_1.logger.error('Error generating mind map data:', error);
        res.status(500).json({ error: 'Failed to generate mind map' });
    }
});
// Get detailed information about an entity including related entities
exports.mindMapRouter.get('/entity/:id', auth_1.isAuthenticated, async (req, res) => {
    try {
        const entityId = parseInt(req.params.id);
        const userId = req.user.id;
        const db = (0, connection_1.getConnection)();
        // Get entity details
        const entityQuery = `
      SELECT e.*
      FROM case_entities e
      WHERE e.id = ?
    `;
        const entities = await db.query(entityQuery, [entityId]);
        if (!entities || entities.length === 0) {
            return res.status(404).json({ error: 'Entity not found' });
        }
        const entity = entities[0];
        // Get documents mentioning this entity
        const docsQuery = `
      SELECT d.id, d.name, d.uploaded_at, de.context
      FROM documents d
      JOIN document_entities de ON d.id = de.document_id
      WHERE de.entity_id = ?
      AND (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      ORDER BY d.uploaded_at DESC
      LIMIT 20
    `;
        const documents = await db.query(docsQuery, [entityId, userId, userId]);
        // Get related entities (co-occurring in documents)
        const relatedQuery = `
      SELECT e.*, COUNT(DISTINCT de1.document_id) as occurrence_count
      FROM case_entities e
      JOIN document_entities de ON e.id = de.entity_id
      JOIN document_entities de1 ON de.document_id = de1.document_id
      WHERE de1.entity_id = ?
      AND e.id != ?
      GROUP BY e.id
      ORDER BY occurrence_count DESC
      LIMIT 10
    `;
        const relatedEntities = await db.query(relatedQuery, [entityId, entityId]);
        res.json({
            entity,
            documents,
            relatedEntities
        });
    }
    catch (error) {
        logger_1.logger.error(`Error getting entity details for ID ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to get entity details' });
    }
});
/**
 * Get node shape based on entity type
 */
function getEntityShape(type) {
    switch (type.toLowerCase()) {
        case 'person':
            return 'circularImage';
        case 'organization':
            return 'box';
        case 'location':
            return 'triangle';
        case 'date':
            return 'diamond';
        case 'legal_reference':
            return 'star';
        case 'case_number':
            return 'dot';
        case 'exhibit':
            return 'square';
        case 'currency':
            return 'hexagon';
        default:
            return 'ellipse';
    }
}
/**
 * Get node sets for filtering entities by type
 */
function getNodeSets() {
    return [
        { id: 'person', label: 'People', shape: 'circularImage', color: '#4287f5' },
        { id: 'organization', label: 'Organizations', shape: 'box', color: '#42c5f5' },
        { id: 'location', label: 'Locations', shape: 'triangle', color: '#f5a442' },
        { id: 'date', label: 'Dates', shape: 'diamond', color: '#f542c8' },
        { id: 'legal_reference', label: 'Legal References', shape: 'star', color: '#a142f5' },
        { id: 'currency', label: 'Currency', shape: 'hexagon', color: '#42f57e' },
        { id: 'other', label: 'Other', shape: 'ellipse', color: '#808080' }
    ];
}
