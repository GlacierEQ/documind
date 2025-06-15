"use strict";
/**
 * Document Clustering Service
 * Groups similar documents using NLP techniques
 */
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
exports.createDocumentClusters = createDocumentClusters;
exports.getDocumentClusters = getDocumentClusters;
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const config_1 = require("../config/config");
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const child_process_1 = require("child_process");
const uuid_1 = require("uuid");
/**
 * Create clusters from a set of documents
 */
async function createDocumentClusters(userId) {
    const perfEnd = logger_1.performance.start('document-clustering');
    const config = (0, config_1.loadConfig)();
    const db = (0, connection_1.getConnection)();
    try {
        // Get user's documents
        const documentsQuery = `
      SELECT d.id, d.name, i.text_content, d.uploaded_at
      FROM documents d
      LEFT JOIN document_index i ON d.id = i.document_id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.archived = 0
      ORDER BY d.id
    `;
        const documents = await db.query(documentsQuery, [userId, userId]);
        if (!documents || documents.length < 5) {
            logger_1.logger.info(`Not enough documents (${documents?.length || 0}) for clustering`);
            return [];
        }
        // Prepare document data for clustering algorithm
        const docTexts = {};
        for (const doc of documents) {
            if (doc.text_content) {
                docTexts[doc.id] = doc.text_content.substring(0, 10000); // Limit size for performance
            }
        }
        // Skip if we have too few documents with content
        if (Object.keys(docTexts).length < 5) {
            logger_1.logger.info(`Not enough documents with content for clustering`);
            return [];
        }
        // Use the appropriate clustering method
        let clusters;
        if (config.ai?.clusteringMethod === 'python') {
            clusters = await performPythonClustering(docTexts, documents);
        }
        else {
            clusters = await performJSClustering(docTexts, documents);
        }
        // Save clusters to database for future reference
        await saveClustersToDatabase(clusters, userId);
        logger_1.logger.info(`Document clustering completed in ${perfEnd()}ms, found ${clusters.length} clusters`);
        return clusters;
    }
    catch (error) {
        logger_1.logger.error('Error performing document clustering:', error);
        return [];
    }
}
/**
 * Perform clustering using Python script (better performance and accuracy)
 */
async function performPythonClustering(docTexts, documents) {
    const config = (0, config_1.loadConfig)();
    const pythonPath = config.ai?.localModelConfig?.pythonPath || 'python';
    const scriptPath = path.join(__dirname, '..', 'ai', 'python', 'document_clustering.py');
    try {
        // Create temp files for input/output
        const tempDir = path.join(process.cwd(), 'temp');
        await fs.mkdir(tempDir, { recursive: true });
        const inputFile = path.join(tempDir, `clustering-input-${(0, uuid_1.v4)()}.json`);
        const outputFile = path.join(tempDir, `clustering-output-${(0, uuid_1.v4)()}.json`);
        // Write document texts to input file
        await fs.writeFile(inputFile, JSON.stringify(docTexts));
        // Call Python script for clustering
        const pythonProcess = (0, child_process_1.spawn)(pythonPath, [scriptPath, '--input', inputFile, '--output', outputFile]);
        // Wait for Python script to complete
        await new Promise((resolve, reject) => {
            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`Python clustering script exited with code ${code}`));
                }
            });
            pythonProcess.stderr.on('data', (data) => {
                logger_1.logger.error(`Python clustering error: ${data}`);
            });
        });
        // Read clustering results
        const outputContent = await fs.readFile(outputFile, 'utf8');
        const result = JSON.parse(outputContent);
        // Map results to our interface
        const clusters = result.clusters.map(cluster => {
            // Map document IDs to full document objects
            const clusterDocs = cluster.documents.map(doc => {
                const fullDoc = documents.find(d => d.id === doc.id);
                return {
                    id: doc.id,
                    name: fullDoc?.name || `Document #${doc.id}`,
                    similarity: doc.similarity,
                    uploadDate: fullDoc?.uploaded_at ? new Date(fullDoc.uploaded_at) : new Date()
                };
            });
            return {
                id: cluster.id,
                name: cluster.name,
                description: cluster.description,
                keywords: cluster.keywords,
                documents: clusterDocs,
                created: new Date()
            };
        });
        // Clean up temp files
        await fs.unlink(inputFile).catch(() => { });
        await fs.unlink(outputFile).catch(() => { });
        return clusters;
    }
    catch (error) {
        logger_1.logger.error('Error in Python clustering:', error);
        // Fall back to JS clustering if Python fails
        return performJSClustering(docTexts, documents);
    }
}
/**
 * Perform clustering using JavaScript (fallback method)
 */
async function performJSClustering(docTexts, documents) {
    try {
        // Simple clustering implementation
        const clusters = [];
        const docIds = Object.keys(docTexts).map(id => parseInt(id));
        // Sort documents by similarity of terms
        const termFrequencies = {};
        // Calculate term frequencies
        for (const docId of docIds) {
            const text = docTexts[docId].toLowerCase();
            const terms = text.split(/\W+/).filter(term => term.length > 3);
            termFrequencies[docId] = {};
            for (const term of terms) {
                termFrequencies[docId][term] = (termFrequencies[docId][term] || 0) + 1;
            }
        }
        // Group similar documents
        const processed = new Set();
        for (const docId of docIds) {
            if (processed.has(docId))
                continue;
            const similarDocs = [];
            similarDocs.push({ id: docId, similarity: 1.0 }); // Add the document itself
            processed.add(docId);
            // Find similar documents
            for (const otherId of docIds) {
                if (docId === otherId || processed.has(otherId))
                    continue;
                const similarity = calculateJaccardSimilarity(Object.keys(termFrequencies[docId]), Object.keys(termFrequencies[otherId]));
                if (similarity > 0.25) { // Threshold for similarity
                    similarDocs.push({ id: otherId, similarity });
                    processed.add(otherId);
                }
            }
            // Skip clusters with only one document
            if (similarDocs.length < 2)
                continue;
            // Extract keywords for the cluster
            const allTerms = {};
            for (const doc of similarDocs) {
                for (const [term, freq] of Object.entries(termFrequencies[doc.id])) {
                    allTerms[term] = (allTerms[term] || 0) + freq;
                }
            }
            // Sort terms by frequency and take top ones as keywords
            const keywords = Object.entries(allTerms)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([term]) => term);
            // Map document IDs to full document objects
            const clusterDocs = similarDocs.map(doc => {
                const fullDoc = documents.find(d => d.id === doc.id);
                return {
                    id: doc.id,
                    name: fullDoc?.name || `Document #${doc.id}`,
                    similarity: doc.similarity,
                    uploadDate: fullDoc?.uploaded_at ? new Date(fullDoc.uploaded_at) : new Date()
                };
            });
            // Create cluster
            clusters.push({
                id: (0, uuid_1.v4)(),
                name: `Document Cluster ${clusters.length + 1}`,
                description: `Group of ${similarDocs.length} similar documents`,
                keywords,
                documents: clusterDocs,
                created: new Date()
            });
        }
        return clusters;
    }
    catch (error) {
        logger_1.logger.error('Error in JS clustering:', error);
        return [];
    }
}
/**
 * Calculate Jaccard similarity between two sets of terms
 */
function calculateJaccardSimilarity(terms1, terms2) {
    const set1 = new Set(terms1);
    const set2 = new Set(terms2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
}
/**
 * Save clusters to database for future reference
 */
async function saveClustersToDatabase(clusters, userId) {
    const db = (0, connection_1.getConnection)();
    try {
        // First, remove old clusters for this user
        await db.query('DELETE FROM document_clusters WHERE user_id = ?', [userId]);
        // Insert new clusters
        for (const cluster of clusters) {
            // Insert cluster
            const result = await db.query(`INSERT INTO document_clusters 
        (id, name, description, keywords, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [
                cluster.id,
                cluster.name,
                cluster.description,
                JSON.stringify(cluster.keywords),
                userId,
                cluster.created
            ]);
            // Insert cluster documents
            for (const doc of cluster.documents) {
                await db.query(`INSERT INTO cluster_documents
          (cluster_id, document_id, similarity)
          VALUES (?, ?, ?)`, [
                    cluster.id,
                    doc.id,
                    doc.similarity
                ]);
            }
        }
    }
    catch (error) {
        logger_1.logger.error('Error saving clusters to database:', error);
    }
}
/**
 * Get document clusters for a user
 */
async function getDocumentClusters(userId) {
    const db = (0, connection_1.getConnection)();
    try {
        // Get clusters from database
        const clustersQuery = `
      SELECT c.id, c.name, c.description, c.keywords, c.created_at
      FROM document_clusters c
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `;
        const clusters = await db.query(clustersQuery, [userId]);
        // If no clusters found, create them
        if (!clusters || clusters.length === 0) {
            return await createDocumentClusters(userId);
        }
        // Get documents for each cluster
        const result = [];
        for (const cluster of clusters) {
            const docsQuery = `
        SELECT cd.document_id, cd.similarity, d.name, d.uploaded_at
        FROM cluster_documents cd
        JOIN documents d ON cd.document_id = d.id
        WHERE cd.cluster_id = ?
        ORDER BY cd.similarity DESC
      `;
            const docs = await db.query(docsQuery, [cluster.id]);
            result.push({
                id: cluster.id,
                name: cluster.name,
                description: cluster.description,
                keywords: JSON.parse(cluster.keywords),
                documents: docs.map((doc) => ({
                    id: doc.document_id,
                    name: doc.name,
                    similarity: doc.similarity,
                    uploadDate: new Date(doc.uploaded_at)
                })),
                created: new Date(cluster.created_at)
            });
        }
        return result;
    }
    catch (error) {
        logger_1.logger.error('Error getting document clusters:', error);
        return [];
    }
}
