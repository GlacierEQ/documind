/**
 * Document Clustering Service
 * Groups similar documents using NLP techniques
 */

import { logger, performance } from '../utils/logger';
import { getConnection } from '../database/connection';
import { loadConfig } from '../config/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

// Document cluster interface
export interface DocumentCluster {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    documents: ClusterDocument[];
    created: Date;
}

// Document in cluster interface
export interface ClusterDocument {
    id: number;
    name: string;
    similarity: number;
    uploadDate: Date;
}

// Cluster result from Python
interface ClusteringResult {
    clusters: {
        id: string;
        name: string;
        description: string;
        keywords: string[];
        documents: {
            id: number;
            similarity: number;
        }[];
    }[];
}

/**
 * Create clusters from a set of documents
 */
export async function createDocumentClusters(userId: number): Promise<DocumentCluster[]> {
    const perfEnd = performance.start('document-clustering');
    const config = loadConfig();
    const db = getConnection();

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
            logger.info(`Not enough documents (${documents?.length || 0}) for clustering`);
            return [];
        }

        // Prepare document data for clustering algorithm
        const docTexts: { [key: number]: string } = {};
        for (const doc of documents) {
            if (doc.text_content) {
                docTexts[doc.id] = doc.text_content.substring(0, 10000); // Limit size for performance
            }
        }

        // Skip if we have too few documents with content
        if (Object.keys(docTexts).length < 5) {
            logger.info(`Not enough documents with content for clustering`);
            return [];
        }

        // Use the appropriate clustering method
        let clusters: DocumentCluster[];

        if (config.ai?.clusteringMethod === 'python') {
            clusters = await performPythonClustering(docTexts, documents);
        } else {
            clusters = await performJSClustering(docTexts, documents);
        }

        // Save clusters to database for future reference
        await saveClustersToDatabase(clusters, userId);

        logger.info(`Document clustering completed in ${perfEnd()}ms, found ${clusters.length} clusters`);
        return clusters;

    } catch (error) {
        logger.error('Error performing document clustering:', error);
        return [];
    }
}

/**
 * Perform clustering using Python script (better performance and accuracy)
 */
async function performPythonClustering(
    docTexts: { [key: number]: string },
    documents: any[]
): Promise<DocumentCluster[]> {
    const config = loadConfig();
    const pythonPath = config.ai?.localModelConfig?.pythonPath || 'python';
    const scriptPath = path.join(__dirname, '..', 'ai', 'python', 'document_clustering.py');

    try {
        // Create temp files for input/output
        const tempDir = path.join(process.cwd(), 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        const inputFile = path.join(tempDir, `clustering-input-${uuidv4()}.json`);
        const outputFile = path.join(tempDir, `clustering-output-${uuidv4()}.json`);

        // Write document texts to input file
        await fs.writeFile(inputFile, JSON.stringify(docTexts));

        // Call Python script for clustering
        const pythonProcess = spawn(pythonPath, [scriptPath, '--input', inputFile, '--output', outputFile]);

        // Wait for Python script to complete
        await new Promise<void>((resolve, reject) => {
            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Python clustering script exited with code ${code}`));
                }
            });

            pythonProcess.stderr.on('data', (data) => {
                logger.error(`Python clustering error: ${data}`);
            });
        });

        // Read clustering results
        const outputContent = await fs.readFile(outputFile, 'utf8');
        const result: ClusteringResult = JSON.parse(outputContent);

        // Map results to our interface
        const clusters: DocumentCluster[] = result.clusters.map(cluster => {
            // Map document IDs to full document objects
            const clusterDocs: ClusterDocument[] = cluster.documents.map(doc => {
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

    } catch (error) {
        logger.error('Error in Python clustering:', error);

        // Fall back to JS clustering if Python fails
        return performJSClustering(docTexts, documents);
    }
}

/**
 * Perform clustering using JavaScript (fallback method)
 */
async function performJSClustering(
    docTexts: { [key: number]: string },
    documents: any[]
): Promise<DocumentCluster[]> {
    try {
        // Simple clustering implementation
        const clusters: DocumentCluster[] = [];
        const docIds = Object.keys(docTexts).map(id => parseInt(id));

        // Sort documents by similarity of terms
        const termFrequencies: { [docId: number]: { [term: string]: number } } = {};

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
        const processed = new Set<number>();

        for (const docId of docIds) {
            if (processed.has(docId)) continue;

            const similarDocs: { id: number, similarity: number }[] = [];
            similarDocs.push({ id: docId, similarity: 1.0 }); // Add the document itself
            processed.add(docId);

            // Find similar documents
            for (const otherId of docIds) {
                if (docId === otherId || processed.has(otherId)) continue;

                const similarity = calculateJaccardSimilarity(
                    Object.keys(termFrequencies[docId]),
                    Object.keys(termFrequencies[otherId])
                );

                if (similarity > 0.25) { // Threshold for similarity
                    similarDocs.push({ id: otherId, similarity });
                    processed.add(otherId);
                }
            }

            // Skip clusters with only one document
            if (similarDocs.length < 2) continue;

            // Extract keywords for the cluster
            const allTerms: { [term: string]: number } = {};
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
            const clusterDocs: ClusterDocument[] = similarDocs.map(doc => {
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
                id: uuidv4(),
                name: `Document Cluster ${clusters.length + 1}`,
                description: `Group of ${similarDocs.length} similar documents`,
                keywords,
                documents: clusterDocs,
                created: new Date()
            });
        }

        return clusters;

    } catch (error) {
        logger.error('Error in JS clustering:', error);
        return [];
    }
}

/**
 * Calculate Jaccard similarity between two sets of terms
 */
function calculateJaccardSimilarity(terms1: string[], terms2: string[]): number {
    const set1 = new Set(terms1);
    const set2 = new Set(terms2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
}

/**
 * Save clusters to database for future reference
 */
async function saveClustersToDatabase(clusters: DocumentCluster[], userId: number): Promise<void> {
    const db = getConnection();

    try {
        // First, remove old clusters for this user
        await db.query(
            'DELETE FROM document_clusters WHERE user_id = ?',
            [userId]
        );

        // Insert new clusters
        for (const cluster of clusters) {
            // Insert cluster
            const result = await db.query(
                `INSERT INTO document_clusters 
        (id, name, description, keywords, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    cluster.id,
                    cluster.name,
                    cluster.description,
                    JSON.stringify(cluster.keywords),
                    userId,
                    cluster.created
                ]
            );

            // Insert cluster documents
            for (const doc of cluster.documents) {
                await db.query(
                    `INSERT INTO cluster_documents
          (cluster_id, document_id, similarity)
          VALUES (?, ?, ?)`,
                    [
                        cluster.id,
                        doc.id,
                        doc.similarity
                    ]
                );
            }
        }
    } catch (error) {
        logger.error('Error saving clusters to database:', error);
    }
}

/**
 * Get document clusters for a user
 */
export async function getDocumentClusters(userId: number): Promise<DocumentCluster[]> {
    const db = getConnection();

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
        const result: DocumentCluster[] = [];

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
                documents: docs.map((doc: any) => ({
                    id: doc.document_id,
                    name: doc.name,
                    similarity: doc.similarity,
                    uploadDate: new Date(doc.uploaded_at)
                })),
                created: new Date(cluster.created_at)
            });
        }

        return result;

    } catch (error) {
        logger.error('Error getting document clusters:', error);
        return [];
    }
}
