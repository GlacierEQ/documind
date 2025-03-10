"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addToKnowledgeBase = addToKnowledgeBase;
exports.getRelatedDocuments = getRelatedDocuments;
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const entityExtractor_1 = require("./entityExtractor");
/**
 * Add information to the case knowledge base
 */
async function addToKnowledgeBase(documentId, text) {
    if (!text) {
        logger_1.logger.warn(`No text provided for knowledge base, document ID: ${documentId}`);
        return;
    }
    const db = (0, connection_1.getConnection)();
    try {
        // First, extract entities (people, places, dates, etc.)
        const entities = await (0, entityExtractor_1.extractEntities)(text);
        // Store entities
        for (const entity of entities) {
            // Check if entity already exists
            const existingEntities = await db.query('SELECT id FROM case_entities WHERE name = ? AND type = ?', [entity.name, entity.type]);
            let entityId;
            if (existingEntities && existingEntities.length > 0) {
                entityId = existingEntities[0].id;
                // Update entity importance
                await db.query('UPDATE case_entities SET importance = importance + ? WHERE id = ?', [entity.importance, entityId]);
            }
            else {
                // Insert new entity
                const result = await db.query(`INSERT INTO case_entities (name, type, description, importance, created_at)
                     VALUES (?, ?, ?, ?, ?)`, [entity.name, entity.type, entity.description || '', entity.importance, new Date()]);
                entityId = result.insertId || result.lastID;
            }
            // Link entity to document
            await db.query(`INSERT INTO document_entities (document_id, entity_id, context, created_at)
                 VALUES (?, ?, ?, ?)`, [documentId, entityId, entity.context || '', new Date()]);
        }
        // Find references to other documents
        const references = await (0, entityExtractor_1.findReferences)(text);
        // Store document references
        for (const reference of references) {
            await db.query(`INSERT INTO document_references (source_id, target_id, context, confidence, created_at)
                 VALUES (?, ?, ?, ?, ?)`, [documentId, reference.targetId, reference.context, reference.confidence, new Date()]);
        }
        // Add document content to the knowledge base for semantic search
        await db.query(`INSERT INTO case_knowledge (document_id, content_chunk, created_at)
             VALUES (?, ?, ?)`, [documentId, text.substring(0, 8000), new Date()]);
        logger_1.logger.info(`Added document ${documentId} to case knowledge base with ${entities.length} entities and ${references.length} references`);
    }
    catch (error) {
        logger_1.logger.error(`Error adding document ${documentId} to knowledge base:`, error);
    }
}
/**
 * Get related documents for a specific document
 */
async function getRelatedDocuments(documentId) {
    const db = (0, connection_1.getConnection)();
    try {
        // Get directly referenced documents
        const directReferences = await db.query(`SELECT dr.target_id, dr.context, dr.confidence, d.name, d.uploaded_at
             FROM document_references dr
             JOIN documents d ON dr.target_id = d.id
             WHERE dr.source_id = ?
             ORDER BY dr.confidence DESC`, [documentId]);
        // Get documents that reference this one
        const backReferences = await db.query(`SELECT dr.source_id as document_id, dr.context, dr.confidence, d.name, d.uploaded_at
             FROM document_references dr
             JOIN documents d ON dr.source_id = d.id
             WHERE dr.target_id = ?
             ORDER BY dr.confidence DESC`, [documentId]);
        // Get documents with shared entities
        const sharedEntitiesQuery = `
            SELECT 
                d.id, 
                d.name,
                d.uploaded_at,
                COUNT(*) as shared_entities,
                GROUP_CONCAT(DISTINCT e.name SEPARATOR ', ') as entities
            FROM documents d
            JOIN document_entities de ON d.id = de.document_id
            JOIN case_entities e ON de.entity_id = e.id
            WHERE e.id IN (
                SELECT entity_id 
                FROM document_entities 
                WHERE document_id = ?
            )
            AND d.id != ?
            GROUP BY d.id
            ORDER BY shared_entities DESC
            LIMIT 10
        `;
        const sharedEntities = await db.query(sharedEntitiesQuery, [documentId, documentId]);
        return {
            directReferences,
            backReferences,
            sharedEntities
        };
    }
    catch (error) {
        logger_1.logger.error(`Error getting related documents for document ${documentId}:`, error);
        return [];
    }
}
